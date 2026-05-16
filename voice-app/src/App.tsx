import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { Library } from "./components/Library";
import { NoteDetail } from "./components/NoteDetail";
import { Recorder } from "./components/Recorder";
import { Settings } from "./components/Settings";
import { Toast, type ToastMessage } from "./components/Toast";
import { api, userMessage, type ServerNote } from "./lib/api";
import { useRecorder } from "./lib/useRecorder";
import { makeLogger } from "./lib/log";
import type { Note, RecordingMode } from "./lib/types";

const log = makeLogger("Yawp.app");

type View = "library" | "detail" | "settings";
type FlowState = "idle" | "recording" | "transcribing";

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("library");
  const [openId, setOpenId] = useState<string | null>(null);
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
  const [liveTranscriptionEnabled, setLiveTranscriptionEnabled] = useState(true);

  // Search state
  const [searchActive, setSearchActive] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<Note[] | null>(null);
  const searchSeqRef = useRef(0);

  const recorder = useRecorder({ liveTranscription: liveTranscriptionEnabled });
  const [transcribing, setTranscribing] = useState(false);
  const flow: FlowState =
    transcribing
      ? "transcribing"
      : recorder.state === "recording"
        ? "recording"
        : "idle";

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
        const list = await api.listNotes();
        const settings = await api.getSettings();
        if (!cancelled) {
          setNotes(list);
          setLiveTranscriptionEnabled(settings.live_transcription_enabled);
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
    const id = setInterval(async () => {
      try {
        const h = await api.health();
        setSidecarUp(true);
        if (h.model_ready) setModelReady(true);
        else if (modelReady !== false) setModelReady(false);
      } catch {
        setSidecarUp(false);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [modelReady]);

  // SSE: live updates from the sidecar (notes created/updated/deleted by the
  // hotkey daemon, by another window, or by external tooling). The browser
  // auto-reconnects on connection loss.
  useEffect(() => {
    const es = new EventSource("http://127.0.0.1:17893/events");

    const upsertFromServerNote = (sn: ServerNote) => {
      const note: Note = {
        id: sn.id,
        title: sn.title,
        transcript: sn.transcript,
        createdAt: new Date(sn.createdAt),
        durationSec: sn.durationSec,
        model: sn.model,
        mode: sn.mode,
        audioPath: sn.audioPath ?? undefined,
        tags: sn.tags ?? [],
        todos: sn.todos ?? [],
      };
      setNotes((prev) => {
        const idx = prev.findIndex((n) => n.id === note.id);
        if (idx === -1) return [note, ...prev];
        const next = prev.slice();
        next[idx] = note;
        return next;
      });
    };

    es.addEventListener("note.created", (e) => {
      try {
        upsertFromServerNote(JSON.parse((e as MessageEvent).data));
      } catch (err) {
        log.warn("event note.created parse failed", err);
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
        setNotes((prev) => prev.filter((n) => n.id !== id));
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

  // Surface recorder errors as toasts
  useEffect(() => {
    if (recorder.error) showToast(recorder.error);
  }, [recorder.error, showToast]);

  // Search: debounced fetch
  useEffect(() => {
    if (!searchActive) {
      setSearchResults(null);
      return;
    }
    const q = searchValue.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const seq = ++searchSeqRef.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.search(q);
        if (seq === searchSeqRef.current) setSearchResults(r);
      } catch (e) {
        console.error(e);
      }
    }, 140);
    return () => clearTimeout(t);
  }, [searchValue, searchActive]);

  const openNote = (id: string) => {
    setOpenId(id);
    setView("detail");
  };

  const onStart = useCallback(async () => {
    // Try one fresh health check before refusing — sidecarUp may be a stale
    // negative from an earlier transient failure.
    if (sidecarUp === false) {
      try {
        await api.health();
        setSidecarUp(true);
      } catch {
        showToast(
          "Sidecar isn't responding. Start it: " +
            "sidecar/.venv/bin/python sidecar/run.py",
        );
        return;
      }
    }
    await recorder.start();
  }, [recorder, sidecarUp, showToast]);

  const onStop = useCallback(async () => {
    const blob = await recorder.stop();
    if (!blob || blob.size === 0) {
      showToast("Nothing was recorded.");
      return;
    }
    setTranscribing(true);
    log.info("transcribing", "bytes=" + blob.size);
    const t0 = performance.now();
    try {
      const result = await api.transcribe(blob);
      const dt = performance.now() - t0;
      log.info(
        "transcribed",
        "ms=" + dt.toFixed(0),
        "chars=" + result.text.length,
        "tags=" + result.tags.length,
        "todos=" + result.todos.length,
      );
      if (!result.text.trim()) {
        showToast("Couldn't hear anything in that clip.");
        return;
      }
      const note = await api.createNote({
        title: result.title,
        transcript: result.text,
        language: result.language,
        model: result.model,
        mode,
        duration_sec: result.duration,
        audio_path: result.audio_path || null,
        tags: result.tags,
        todos: result.todos,
      });
      setNotes((prev) => [note, ...prev]);
      if (mode === "notes") {
        setOpenId(note.id);
        setView("detail");
      } else {
        try {
          await navigator.clipboard.writeText(result.text);
          showToast("Transcript copied to clipboard.");
        } catch {
          showToast("Transcribed — couldn't access clipboard.");
        }
      }
    } catch (e: unknown) {
      log.error("transcribe failed", e);
      showToast(userMessage(e, "Transcription failed."));
    } finally {
      setTranscribing(false);
    }
  }, [mode, recorder, showToast]);

  const onCancel = useCallback(() => {
    recorder.cancel();
  }, [recorder]);

  const onRecordToggle = () => {
    if (flow === "idle") onStart();
    else if (flow === "recording") onStop();
  };

  const onNoteUpdate = useCallback((updated: Note) => {
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    setSearchResults((prev) =>
      prev ? prev.map((n) => (n.id === updated.id ? updated : n)) : prev,
    );
  }, []);

  const onNoteDelete = useCallback(
    async (id: string) => {
      // Snapshot for optimistic restore on undo.
      const wasOpen = openId === id;
      try {
        await api.deleteNote(id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
        setSearchResults((prev) =>
          prev ? prev.filter((n) => n.id !== id) : prev,
        );
        setOpenId(null);
        setView("library");
        showToast("Note moved to trash.", {
          label: "Undo",
          onClick: async () => {
            try {
              const restored = await api.restoreNote(id);
              setNotes((prev) => {
                if (prev.some((n) => n.id === restored.id)) return prev;
                return [restored, ...prev];
              });
              if (wasOpen) {
                setOpenId(restored.id);
                setView("detail");
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

  const openNoteObj = notes.find((n) => n.id === openId) ?? null;
  const displayedNotes = searchResults ?? notes;

  return (
    <div className="min-h-full">
      <TopBar
        view={view}
        onNavigate={(v) => {
          setView(v);
          setOpenId(null);
          setSearchActive(false);
          setSearchValue("");
        }}
        onRecord={onRecordToggle}
        recording={flow !== "idle"}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchActive={searchActive}
        onSearchActivate={() => setSearchActive(true)}
        onSearchDeactivate={() => {
          setSearchActive(false);
          setSearchValue("");
        }}
      />

      <main>
        {view === "library" && !loading && (
          <Library notes={displayedNotes} onOpen={openNote} />
        )}
        {view === "library" && loading && <LibrarySkeleton />}
        {view === "detail" && openNoteObj && (
          <NoteDetail
            note={openNoteObj}
            onBack={() => {
              setView("library");
              setOpenId(null);
            }}
            onUpdate={onNoteUpdate}
            onDelete={onNoteDelete}
            onToast={showToast}
          />
        )}
        {view === "settings" && (
          <Settings
            onToast={showToast}
            onLiveTranscriptionChange={setLiveTranscriptionEnabled}
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
        partial={recorder.partial}
        level={recorder.level}
      />

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
