import { useCallback, useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { Library } from "./components/Library";
import { SafeNoteDetail } from "./components/SafeNoteDetail";
import { Recorder } from "./components/Recorder";
import { Settings } from "./components/Settings";
import { Trash } from "./components/Trash";
import { AskView } from "./components/AskView";
import { Toast, type ToastMessage } from "./components/Toast";
import {
  api,
  fromServerFolder,
  fromServerNote,
  sidecarEventsUrl,
  userMessage,
  type ServerFolder,
  type ServerNote,
} from "./lib/api";
import { writeToClipboard } from "./lib/clipboard";
import { makeLogger } from "./lib/log";
import { removeNote, replaceExistingNote, upsertNote } from "./lib/noteState";
import { useNativeCapture } from "./lib/useNativeCapture";
import { useNoteSearch } from "./lib/useNoteSearch";
import type { Folder, Note, RecordingMode } from "./lib/types";

const log = makeLogger("Yawp.app");

type View = "library" | "settings" | "trash" | "ask";
type FolderFilter = "all" | "uncategorized" | string;

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("library");
  const [selectedFolderId, setSelectedFolderId] = useState<FolderFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState(0);
  const [mode, setMode] = useState<RecordingMode>("notes");
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Convenience helpers — most callers want to set a string with no action.
  const showToast = useCallback(
    (text: string, action?: ToastMessage["action"]) => {
      setToast({ text, action });
    },
    [],
  );
  const [sidecarUp, setSidecarUp] = useState<boolean | null>(null);
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [openRouterConfigured, setOpenRouterConfigured] = useState(false);

  const search = useNoteSearch(notes);
  const capture = useNativeCapture({ sidecarUp, setSidecarUp, showToast });
  const flow = capture.flow;

  // Initial load
  useEffect(() => {
    let cancelled = false;
    log.info("initial load");
    (async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setSidecarUp(true);
        setModelReady(h.model_ready);
        log.info(
          "health ok",
          "model=" + h.default_model,
          "ready=" + h.model_ready,
          "notes=" + h.notes_count,
        );
        const [list, folderList, settings, captureStatus] = await Promise.all([
          api.listNotes(),
          api.listFolders(),
          api.getSettings(),
          api.captureStatus().catch(() => null),
        ]);
        if (!cancelled) {
          setNotes(list);
          setFolders(folderList);
          setOpenRouterConfigured(settings.openrouter_api_key_set);
          if (captureStatus) capture.setNativeRecording(captureStatus.recording);
          log.info("loaded notes", "count=" + list.length);
        }
      } catch (e) {
        log.error("initial load failed", e);
        if (!cancelled) {
          setSidecarUp(false);
          showToast(
            "Couldn't reach the transcription service. Start the sidecar and reload.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Periodic health re-check. Updates BOTH sidecarUp and modelReady so the
  // UI recovers automatically when the sidecar comes back. Without this, a
  // sidecar restart would strand the frontend with stale sidecarUp=false
  // until full page reload.
  useEffect(() => {
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [h, captureStatus] = await Promise.all([
          api.health(),
          api.captureStatus().catch(() => null),
        ]);
        setSidecarUp(true);
        setModelReady(h.model_ready);
        if (captureStatus && !capture.transcribing && !capture.capturePending) {
          capture.setNativeRecording(captureStatus.recording);
        }
      } catch {
        setSidecarUp(false);
      } finally {
        inFlight = false;
      }
    }, 5000);
    return () => clearInterval(id);
  }, [capture.capturePending, capture.transcribing]);

  // SSE: live updates from the sidecar (notes created/updated/deleted by the
  // hotkey daemon, by another window, or by external tooling). The browser
  // auto-reconnects on connection loss.
  useEffect(() => {
    const es = new EventSource(sidecarEventsUrl());

    const upsertFromServerNote = (sn: ServerNote) => {
      const note = fromServerNote(sn);
      setNotes((prev) => upsertNote(prev, note));
      search.setResults((prev) => (prev ? replaceExistingNote(prev, note) : prev));
    };
    const upsertFromServerFolder = (sf: ServerFolder) => {
      const folder = fromServerFolder(sf);
      setFolders((prev) => {
        const without = prev.filter((f) => f.id !== folder.id);
        return [...without, folder].sort((a, b) => a.name.localeCompare(b.name));
      });
    };

    es.onopen = () => setSidecarUp(true);
    es.onerror = () => setSidecarUp(false);

    es.addEventListener("note.created", (e) => {
      try {
        upsertFromServerNote(JSON.parse((e as MessageEvent).data));
      } catch (err) {
        log.warn("event note.created parse failed", err);
      }
    });
    es.addEventListener("folder.created", (e) => {
      try {
        upsertFromServerFolder(JSON.parse((e as MessageEvent).data));
      } catch (err) {
        log.warn("event folder.created parse failed", err);
      }
    });
    es.addEventListener("folder.updated", (e) => {
      try {
        upsertFromServerFolder(JSON.parse((e as MessageEvent).data));
      } catch (err) {
        log.warn("event folder.updated parse failed", err);
      }
    });
    es.addEventListener("folder.deleted", (e) => {
      try {
        const { id } = JSON.parse((e as MessageEvent).data);
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setNotes((prev) => prev.map((n) => (n.folderId === id ? { ...n, folderId: null } : n)));
        setSelectedFolderId((current) => (current === id ? "all" : current));
      } catch (err) {
        log.warn("event folder.deleted parse failed", err);
      }
    });
    es.addEventListener("note.updated", (e) => {
      try {
        upsertFromServerNote(JSON.parse((e as MessageEvent).data));
      } catch (err) {
        log.warn("event note.updated parse failed", err);
      }
    });
    es.addEventListener("note.deleted", (e) => {
      try {
        const { id } = JSON.parse((e as MessageEvent).data);
        setNotes((prev) => removeNote(prev, id));
        search.setResults((prev) => (prev ? removeNote(prev, id) : prev));
      } catch (err) {
        log.warn("event note.deleted parse failed", err);
      }
    });
    es.addEventListener("note.restored", (e) => {
      try {
        upsertFromServerNote(JSON.parse((e as MessageEvent).data));
      } catch (err) {
        log.warn("event note.restored parse failed", err);
      }
    });

    return () => es.close();
  }, []);

  const openNote = useCallback((id: string) => {
    setOpenId(id);
  }, []);

  const editNote = useCallback((id: string) => {
    setOpenId(id);
    setEditRequest((n) => n + 1);
  }, []);

  const onStart = capture.start;

  const onStop = useCallback(async () => {
    const t0 = performance.now();
    const note = await capture.stopAndSave(mode);
    if (!note) return;
    const dt = performance.now() - t0;
    log.info(
      "recording saved",
      "ms=" + dt.toFixed(0),
      "chars=" + note.transcript.length,
      "tags=" + note.tags.length,
      "todos=" + note.todos.length,
    );
    if (!note.transcript.trim()) {
      showToast("Couldn't hear anything in that clip.");
      return;
    }
    setNotes((prev) => upsertNote(prev, note));
    if (mode === "notes") {
      setOpenId(note.id);
      setView("library");
    } else {
      try {
        await writeToClipboard(note.transcript);
        showToast("Transcript copied to clipboard.");
      } catch {
        showToast("Transcribed — couldn't access clipboard.");
      }
    }
  }, [capture, mode, showToast]);

  const onCancel = capture.cancel;

  const onRecordToggle = () => {
    if (capture.capturePending) return;
    if (flow === "idle") onStart();
    else if (flow === "recording") onStop();
  };

  const onNoteDelete = useCallback(
    async (id: string) => {
      // Snapshot for optimistic restore on undo.
      const wasOpen = openId === id;
      try {
        await api.deleteNote(id);
        setNotes((prev) => removeNote(prev, id));
        search.setResults((prev) =>
          prev ? removeNote(prev, id) : prev,
        );
        setOpenId(null);
        setView("library");
        showToast("Note moved to trash.", {
          label: "Undo",
          onClick: async () => {
            try {
              const restored = await api.restoreNote(id);
              setNotes((prev) => upsertNote(prev, restored));
              if (wasOpen) {
                setOpenId(restored.id);
                setView("library");
              }
              showToast("Restored.");
            } catch (e) {
              showToast(userMessage(e, "Couldn't restore note."));
            }
          },
        });
      } catch (e) {
        log.error("delete failed", e);
        showToast(userMessage(e, "Couldn't delete note."));
      }
    },
    [openId, showToast],
  );

  const onNotesDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        const deleted = await api.bulkDeleteNotes(ids);
        if (deleted.length === 0) return;
        const gone = new Set(deleted);
        if (openId && gone.has(openId)) setOpenId(null);
        setNotes((prev) => prev.filter((n) => !gone.has(n.id)));
        search.setResults((prev) =>
          prev ? prev.filter((n) => !gone.has(n.id)) : prev,
        );
        showToast(
          `${deleted.length} note${deleted.length === 1 ? "" : "s"} moved to trash.`,
          {
            label: "Undo",
            onClick: async () => {
              try {
                const restored = await api.bulkRestoreNotes(deleted);
                setNotes((prev) =>
                  restored.reduce((acc, note) => upsertNote(acc, note), prev),
                );
                showToast("Restored.");
              } catch (e) {
                showToast(userMessage(e, "Couldn't restore notes."));
              }
            },
          },
        );
      } catch (e) {
        log.error("bulk delete failed", e);
        showToast(userMessage(e, "Couldn't delete notes."));
      }
    },
    [openId, search, showToast],
  );

  const onFolderCreate = useCallback(
    async (name: string) => {
      try {
        const folder = await api.createFolder(name);
        setFolders((prev) => {
          const without = prev.filter((f) => f.id !== folder.id);
          return [...without, folder].sort((a, b) => a.name.localeCompare(b.name));
        });
        setSelectedFolderId(folder.id);
        showToast("Folder created.");
      } catch (e) {
        showToast(userMessage(e, "Couldn't create folder."));
      }
    },
    [showToast],
  );

  const onFolderRename = useCallback(
    async (id: string, name: string) => {
      try {
        const folder = await api.updateFolder(id, name);
        setFolders((prev) => {
          const without = prev.filter((f) => f.id !== folder.id);
          return [...without, folder].sort((a, b) => a.name.localeCompare(b.name));
        });
        showToast("Folder renamed.");
      } catch (e) {
        showToast(userMessage(e, "Couldn't rename folder."));
      }
    },
    [showToast],
  );

  const onFolderDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteFolder(id);
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setNotes((prev) => prev.map((n) => (n.folderId === id ? { ...n, folderId: null } : n)));
        setSelectedFolderId((current) => (current === id ? "all" : current));
        showToast("Folder removed.");
      } catch (e) {
        showToast(userMessage(e, "Couldn't remove folder."));
      }
    },
    [showToast],
  );

  const onNoteFolderChange = useCallback(
    async (noteId: string, folderId: string | null) => {
      try {
        const note = await api.assignNoteFolder(noteId, folderId);
        setNotes((prev) => upsertNote(prev, note));
        search.setResults((prev) => (prev ? upsertNote(prev, note) : prev));
        showToast(folderId ? "Moved." : "Removed from folder.");
      } catch (e) {
        showToast(userMessage(e, "Couldn't move note."));
      }
    },
    [search, showToast],
  );

  const openNoteObj = notes.find((n) => n.id === openId) ?? null;
  const displayedNotes = filterNotesByFolder(search.displayedNotes, selectedFolderId);
  const folderCounts = countNotesByFolder(notes);

  return (
    <div className="min-h-full">
      <TopBar
        view={view}
        onNavigate={(v) => {
          setView(v);
          setOpenId(null);
          search.reset();
        }}
        onRecord={onRecordToggle}
        recording={flow !== "idle"}
        searchValue={search.value}
        onSearchChange={search.setValue}
        searchActive={search.active}
        onSearchActivate={() => search.setActive(true)}
        onSearchDeactivate={search.reset}
      />

      <main>
        {view === "library" && !loading && (
          <Library
            notes={displayedNotes}
            allNotesCount={notes.length}
            folders={folders}
            selectedFolderId={selectedFolderId}
            folderCounts={folderCounts}
            onFolderSelect={setSelectedFolderId}
            onFolderCreate={onFolderCreate}
            onFolderRename={onFolderRename}
            onFolderDelete={onFolderDelete}
            onOpen={openNote}
            onEdit={editNote}
            onDelete={onNoteDelete}
            onBulkDelete={onNotesDelete}
            onOpenTrash={() => {
              setView("trash");
              setOpenId(null);
              search.reset();
            }}
            onOpenAsk={() => {
              setView("ask");
              setOpenId(null);
              search.reset();
            }}
          />
        )}
        {view === "library" && loading && <LibrarySkeleton />}
        {view === "settings" && (
          <Settings onToast={showToast} />
        )}
        {view === "trash" && (
          <Trash
            onBack={() => setView("library")}
            onToast={showToast}
            onRestored={(note) => setNotes((prev) => upsertNote(prev, note))}
          />
        )}
        {view === "ask" && (
          <AskView
            onBack={() => setView("library")}
            openRouterConfigured={openRouterConfigured}
            onOpenNote={(id) => {
              setView("library");
              setOpenId(id);
            }}
          />
        )}
      </main>

      <Recorder
        open={flow !== "idle"}
        state={flow}
        mode={mode}
        onModeChange={setMode}
        onStop={onStop}
        onCancel={onCancel}
        partial=""
        level={0}
        autoStopEnabled={false}
      />

      {openNoteObj && view === "library" && (
        <div
          className="fixed inset-0 z-40 overflow-auto"
          style={{
            background: "var(--color-paper)",
            borderTop: "1px solid var(--color-rule-soft)",
          }}
        >
          <SafeNoteDetail
            note={openNoteObj}
            folders={folders}
            editRequest={editRequest}
            onBack={() => setOpenId(null)}
            onUpdate={(note) => {
              setNotes((prev) => upsertNote(prev, note));
              search.setResults((prev) => (prev ? upsertNote(prev, note) : prev));
            }}
            onFolderChange={onNoteFolderChange}
            onDelete={onNoteDelete}
            onToast={showToast}
          />
        </div>
      )}

      {modelReady === false && <ModelLoadingBanner />}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="page-in mx-auto max-w-[860px] px-12 pb-32">
      <div className="flex items-center gap-4 pt-6 pb-2">
        <span className="skeleton" style={{ height: 9, width: 78 }} />
        <span className="h-px flex-1 bg-rule-soft" />
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="py-7 border-b border-rule-soft"
          style={{ opacity: 1 - i * 0.18 }}
        >
          <div className="flex items-baseline justify-between gap-6">
            <span
              className="skeleton"
              style={{ height: 22, width: 320 - i * 60, borderRadius: 2 }}
            />
            <span
              className="skeleton"
              style={{ height: 11, width: 52, borderRadius: 2 }}
            />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <span className="skeleton" style={{ height: 14, width: "100%" }} />
            <span className="skeleton" style={{ height: 14, width: "92%" }} />
            <span className="skeleton" style={{ height: 14, width: "68%" }} />
          </div>
          <div className="mt-5 flex items-center gap-3">
            <span className="skeleton" style={{ height: 10, width: 40 }} />
            <span className="skeleton" style={{ height: 10, width: 60 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function filterNotesByFolder(notes: Note[], folderId: FolderFilter): Note[] {
  if (folderId === "all") return notes;
  if (folderId === "uncategorized") return notes.filter((n) => !n.folderId);
  return notes.filter((n) => n.folderId === folderId);
}

function countNotesByFolder(notes: Note[]): Record<string, number> {
  return notes.reduce<Record<string, number>>((acc, note) => {
    const key = note.folderId || "uncategorized";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function ModelLoadingBanner() {
  return (
    <div className="fixed bottom-8 right-8 z-30 pointer-events-none item-in">
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-rule)",
          borderRadius: 999,
          boxShadow:
            "0 8px 28px -10px rgba(40,28,18,0.18), 0 2px 6px -2px rgba(40,28,18,0.06)",
        }}
      >
        <span
          className="pulse-ink"
          style={{
            display: "inline-block",
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--color-accent)",
          }}
        />
        <span
          className="font-serif text-[13.5px] italic"
          style={{ color: "var(--color-ink-soft)" }}
        >
          Downloading the transcription model. Recording will work once this
          finishes.
        </span>
      </div>
    </div>
  );
}

export default App;
