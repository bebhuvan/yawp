import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { Library } from "./components/Library";
import { NoteDetail } from "./components/NoteDetail";
import { Recorder } from "./components/Recorder";
import { Settings } from "./components/Settings";
import { Toast } from "./components/Toast";
import { api, userMessage } from "./lib/api";
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
  const [toast, setToast] = useState<string | null>(null);
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
          setToast(
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

  // Surface recorder errors as toasts
  useEffect(() => {
    if (recorder.error) setToast(recorder.error);
  }, [recorder.error]);

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
        setToast(
          "Sidecar isn't responding. Start it: " +
            "sidecar/.venv/bin/python sidecar/run.py",
        );
        return;
      }
    }
    await recorder.start();
  }, [recorder, sidecarUp]);

  const onStop = useCallback(async () => {
    const blob = await recorder.stop();
    if (!blob || blob.size === 0) {
      setToast("Nothing was recorded.");
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
        setToast("Couldn't hear anything in that clip.");
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
          setToast("Transcript copied to clipboard.");
        } catch {
          setToast("Transcribed — couldn't access clipboard.");
        }
      }
    } catch (e: unknown) {
      log.error("transcribe failed", e);
      setToast(userMessage(e, "Transcription failed."));
    } finally {
      setTranscribing(false);
    }
  }, [mode, recorder]);

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

  const onNoteDelete = useCallback(async (id: string) => {
    try {
      await api.deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setSearchResults((prev) =>
        prev ? prev.filter((n) => n.id !== id) : prev,
      );
      setOpenId(null);
      setView("library");
      setToast("Note deleted.");
    } catch (e) {
      console.error(e);
      setToast("Couldn't delete note.");
    }
  }, []);

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
        {view === "library" && loading && (
          <div className="mx-auto max-w-[860px] px-12 pt-12 eyebrow text-ink-quiet">
            Loading notes…
          </div>
        )}
        {view === "detail" && openNoteObj && (
          <NoteDetail
            note={openNoteObj}
            onBack={() => {
              setView("library");
              setOpenId(null);
            }}
            onUpdate={onNoteUpdate}
            onDelete={onNoteDelete}
            onToast={setToast}
          />
        )}
        {view === "settings" && (
          <Settings
            onToast={setToast}
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

      <Toast message={toast} onDismiss={() => setToast(null)} />
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
