import { useEffect, useRef, useState } from "react";
import { api, audioUrl, userMessage, type GrammarIssue } from "../lib/api";
import { writeToClipboard } from "../lib/clipboard";
import type { Folder, Note, Todo } from "../lib/types";
import { formatDuration, formatTime, longDate } from "../lib/utils";
import { Tag } from "./Tag";


const MAX_DETAIL_CHARS = 18_000;

export function SafeNoteDetail({
  note,
  folders,
  editRequest,
  onBack,
  onUpdate,
  onFolderChange,
  onDelete,
  onToast,
}: {
  note: Note;
  folders: Folder[];
  editRequest?: number;
  onBack: () => void;
  onUpdate: (note: Note) => void;
  onFolderChange: (noteId: string, folderId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(note.title);
  const [editTranscript, setEditTranscript] = useState(note.transcript);
  const [editTags, setEditTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [preview, setPreview] = useState<{ kind: "polish" | "grammar"; text: string } | null>(
    null,
  );
  const [applyingPreview, setApplyingPreview] = useState(false);
  const [grammar, setGrammar] = useState<GrammarIssue[] | null>(null);
  const [grammarChecking, setGrammarChecking] = useState(false);
  const [grammarApplying, setGrammarApplying] = useState(false);
  const [extractingTodos, setExtractingTodos] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audio = audioUrl(note.audioPath);
  const text = note.transcript || "";
  const truncated = text.length > MAX_DETAIL_CHARS;
  const visible = truncated ? text.slice(0, MAX_DETAIL_CHARS) : text;

  useEffect(() => {
    setEditing(false);
    setEditTitle(note.title);
    setEditTranscript(note.transcript);
    setEditTags(note.tags);
    setGrammar(null);
  }, [note.id, note.title, note.transcript, note.tags]);

  useEffect(() => {
    if (!editRequest) return;
    setEditTitle(note.title);
    setEditTranscript(note.transcript);
    setEditTags(note.tags);
    setEditing(true);
  }, [editRequest, note.title, note.transcript, note.tags]);

  const copy = async () => {
    try {
      await writeToClipboard(text);
      onToast("Copied.");
    } catch {
      onToast("Couldn't copy note.");
    }
  };

  const startEdit = () => {
    setEditTitle(note.title);
    setEditTranscript(note.transcript);
    setEditTags(note.tags);
    setTagInput("");
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditTitle(note.title);
    setEditTranscript(note.transcript);
    setEditTags(note.tags);
    setTagInput("");
    setEditing(false);
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || editTags.includes(t) || editTags.length >= 8) {
      setTagInput("");
      return;
    }
    setEditTags([...editTags, t]);
    setTagInput("");
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const updated = await api.updateNote(note.id, {
        title: editTitle.trim() || "Untitled",
        transcript: editTranscript.trim(),
        tags: editTags,
      });
      onUpdate(updated);
      setEditing(false);
      onToast("Saved.");
    } catch (e) {
      onToast(userMessage(e, "Couldn't save changes."));
    } finally {
      setSaving(false);
    }
  };

  const polish = async () => {
    setPolishing(true);
    try {
      const r = await api.polish(note.transcript);
      setPreview({ kind: "polish", text: r.text });
    } catch (e) {
      onToast(userMessage(e, "Polish failed."));
    } finally {
      setPolishing(false);
    }
  };

  const checkGrammar = async () => {
    setGrammarChecking(true);
    try {
      const r = await api.checkGrammar(note.transcript);
      setGrammar(r.issues);
      if (r.issues.length === 0) onToast("No grammar issues found.");
    } catch (e) {
      onToast(userMessage(e, "Grammar check failed."));
    } finally {
      setGrammarChecking(false);
    }
  };

  const applyGrammar = async () => {
    setGrammarApplying(true);
    try {
      const r = await api.applyGrammar(note.transcript);
      setPreview({ kind: "grammar", text: r.text });
    } catch (e) {
      onToast(userMessage(e, "Couldn't apply corrections."));
    } finally {
      setGrammarApplying(false);
    }
  };

  const extractTodos = async () => {
    setExtractingTodos(true);
    try {
      const updated = await api.extractTodos(note.id);
      onUpdate(updated);
      onToast(
        updated.todos.length === 0
          ? "No action items found in this note."
          : `Found ${updated.todos.length} action item${updated.todos.length === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      onToast(userMessage(e, "Couldn't extract action items."));
    } finally {
      setExtractingTodos(false);
    }
  };

  const toggleTodo = async (todoId: string) => {
    const next = note.todos.map((t: Todo) =>
      t.id === todoId ? { ...t, done: !t.done } : t,
    );
    onUpdate({ ...note, todos: next });
    try {
      await api.updateNote(note.id, { todos: next });
    } catch {
      onToast("Couldn't save action item.");
    }
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (audioPlaying) {
      el.pause();
      el.currentTime = 0;
    } else {
      el.play().catch(() => onToast("Couldn't play audio."));
    }
  };

  // Click-to-seek. Per-segment timestamps aren't stored, so we seek by the
  // clicked paragraph's position in the transcript, scaled to the clip length.
  const pendingRatio = useRef<number | null>(null);

  const applyRatio = (ratio: number) => {
    const el = audioRef.current;
    if (!el) return;
    const dur = Number.isFinite(el.duration) ? el.duration : note.durationSec;
    if (dur && dur > 0) {
      el.currentTime = Math.min(dur - 0.05, Math.max(0, ratio * dur));
    }
  };

  const seekToOffset = (offset: number) => {
    const el = audioRef.current;
    if (!el || !text.length) return;
    // A click that's really the end of a text selection shouldn't seek.
    if ((window.getSelection()?.toString() || "").length > 0) return;
    const ratio = Math.min(1, Math.max(0, offset / text.length));
    if (el.readyState >= 1) applyRatio(ratio);
    else pendingRatio.current = ratio;
    el.play().catch(() => onToast("Couldn't play audio."));
  };

  const seekParagraphs = (() => {
    const out: { text: string; offset: number }[] = [];
    let idx = 0;
    for (const part of visible.split(/(\n{2,})/)) {
      if (/^\n{2,}$/.test(part)) {
        idx += part.length;
        continue;
      }
      if (part.length) out.push({ text: part, offset: idx });
      idx += part.length;
    }
    return out;
  })();

  const applyPreview = async () => {
    if (!preview) return;
    setApplyingPreview(true);
    try {
      const updated = await api.updateNote(note.id, { transcript: preview.text });
      onUpdate(updated);
      const kind = preview.kind;
      setPreview(null);
      if (kind === "grammar") {
        setGrammar(null);
        onToast("Grammar corrections applied.");
      } else {
        onToast("Polished.");
      }
    } catch (e) {
      onToast(userMessage(e, "Couldn't apply changes."));
    } finally {
      setApplyingPreview(false);
    }
  };

  const organize = async () => {
    setOrganizing(true);
    try {
      const updated = await api.organizeNote(note.id);
      onUpdate(updated);
      onToast(
        updated.smartMetadata.source === "openrouter"
          ? "Organized with AI."
          : "Organized locally.",
      );
    } catch (e) {
      onToast(userMessage(e, "Couldn't organize note."));
    } finally {
      setOrganizing(false);
    }
  };

  const moveToFolder = async (folderId: string) => {
    setMoving(true);
    try {
      await onFolderChange(note.id, folderId || null);
    } finally {
      setMoving(false);
    }
  };

  const meta = note.smartMetadata || {};
  const metaSummary = (meta.summary || "").trim();
  const hasMetaTags = Boolean(meta.kind || meta.collection || meta.source);

  return (
    <div className="mx-auto max-w-[680px] px-12 pt-2 pb-32">
      <button
        onClick={onBack}
        className="eyebrow mb-16 cursor-pointer hover:text-ink-soft transition-colors"
      >
        ← Back to notes
      </button>

      {/* Quiet metadata strip — date, time, duration, model.
          No dots between every fragment; use thin spaces and small caps. */}
      <div className="mb-10 flex items-center gap-3 eyebrow flex-wrap">
        <span>{safeLongDate(note.createdAt)}</span>
        <span className="text-ink-faint">·</span>
        <span className="numeric">{safeFormatTime(note.createdAt)}</span>
        <span className="text-ink-faint">·</span>
        <span className="numeric">{formatDuration(note.durationSec)}</span>
        <span className="text-ink-faint">·</span>
        <span>{displayModel(note.model)}</span>
      </div>

      {editing ? (
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="display text-[52px] text-ink leading-[1.05] mb-10 w-full bg-transparent border-0 outline-none focus:bg-paper-deep px-2 -mx-2 rounded"
          style={{
            fontVariationSettings: '"opsz" 144, "SOFT" 30, "wght" 380',
            letterSpacing: "-0.030em",
            overflowWrap: "anywhere",
          }}
          autoFocus
        />
      ) : (
        <h1
          className="display text-[52px] text-ink leading-[1.05] mb-10"
          style={{
            fontVariationSettings: '"opsz" 144, "SOFT" 30, "wght" 380',
            letterSpacing: "-0.030em",
            overflowWrap: "anywhere",
          }}
        >
          {note.title || "Untitled"}
        </h1>
      )}

      {editing ? (
        <div className="mb-10 flex flex-wrap items-center gap-1.5">
          {editTags.map((t) => (
            <Tag
              key={t}
              label={t}
              onRemove={() => setEditTags(editTags.filter((x) => x !== t))}
            />
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            placeholder="add tag"
            className="numeric text-[11px] outline-none bg-transparent border-b border-rule-soft pb-0.5 w-[80px] focus:border-rule"
            style={{ letterSpacing: "0.04em" }}
          />
        </div>
      ) : (
        note.tags.length > 0 && (
          <div className="mb-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 eyebrow">
            {note.tags.slice(0, 12).map((tag, i) => (
              <span key={tag} className="flex items-center gap-3">
                {i > 0 && <span className="text-ink-faint">·</span>}
                <span style={{ color: "var(--color-ink-soft)" }}>{tag}</span>
              </span>
            ))}
          </div>
        )
      )}

      <div className="mb-10 flex flex-wrap items-center gap-4 border-y border-rule-soft py-3">
        <span className="eyebrow">Folder</span>
        <select
          value={note.folderId || ""}
          disabled={moving}
          onChange={(e) => moveToFolder(e.target.value)}
          className="min-w-[180px] border-0 bg-transparent font-serif text-[15px] text-ink outline-none disabled:opacity-60"
          aria-label="Move note to folder"
        >
          <option value="">Unfiled</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        {moving && <span className="eyebrow">Moving…</span>}
      </div>

      {(metaSummary || hasMetaTags) && (
        <aside className="mb-12 pl-5 border-l border-rule-soft">
          {metaSummary && (
            <p
              className="font-serif text-[16.5px] italic text-ink-soft"
              style={{ lineHeight: 1.65, overflowWrap: "anywhere" }}
            >
              {metaSummary}
            </p>
          )}
          {hasMetaTags && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 eyebrow text-ink-quiet">
              {meta.kind && <span>{meta.kind}</span>}
              {meta.collection && (
                <>
                  <span className="text-ink-faint">·</span>
                  <span>{meta.collection}</span>
                </>
              )}
              {meta.source && (
                <>
                  <span className="text-ink-faint">·</span>
                  <span>{meta.source}</span>
                </>
              )}
            </div>
          )}
        </aside>
      )}

      {editing ? (
        <textarea
          value={editTranscript}
          onChange={(e) => setEditTranscript(e.target.value)}
          className="font-serif text-[19px] text-ink w-full bg-transparent border-0 outline-none focus:bg-paper-deep px-3 -mx-3 py-2 rounded resize-none"
          style={{
            lineHeight: 1.75,
            minHeight: "36vh",
            overflowWrap: "anywhere",
          }}
          rows={Math.max(8, Math.min(28, editTranscript.split("\n").length + 2))}
        />
      ) : audio ? (
        <>
          <p className="eyebrow text-ink-quiet mb-4">
            Click a line to play the audio from there
          </p>
          <article
            className="selectable font-serif text-[19px] text-ink"
            style={{ lineHeight: 1.78, overflowWrap: "anywhere" }}
          >
            {seekParagraphs.map((p, i) => (
              <p
                key={i}
                onClick={() => seekToOffset(p.offset)}
                className={`whitespace-pre-wrap rounded px-2 -mx-2 transition-colors hover:bg-paper-deep ${
                  i > 0 ? "mt-5" : ""
                }`}
                title="Play audio from here"
              >
                {p.text}
              </p>
            ))}
          </article>
        </>
      ) : (
        <article
          className="selectable font-serif text-[19px] text-ink whitespace-pre-wrap"
          style={{ lineHeight: 1.78, overflowWrap: "anywhere" }}
        >
          {visible}
        </article>
      )}

      {!editing && truncated && (
        <p className="mt-8 font-serif text-[14px] text-ink-quiet italic">
          Showing the first {MAX_DETAIL_CHARS.toLocaleString()} characters to
          keep the app responsive.
        </p>
      )}

      {audio && (
        <audio
          ref={audioRef}
          src={audio}
          onPlay={() => setAudioPlaying(true)}
          onPause={() => setAudioPlaying(false)}
          onEnded={() => setAudioPlaying(false)}
          onLoadedMetadata={() => {
            if (pendingRatio.current != null) {
              applyRatio(pendingRatio.current);
              pendingRatio.current = null;
            }
          }}
          preload="metadata"
        />
      )}

      {note.todos.length > 0 && !editing && (
        <div
          className="mt-12 px-6 py-5"
          style={{
            background: "var(--color-paper-deep)",
            border: "1px solid var(--color-rule-soft)",
            borderRadius: 6,
          }}
        >
          <p className="eyebrow text-ink-soft mb-3">Action items</p>
          <ul className="space-y-2">
            {note.todos.map((t: Todo) => (
              <li
                key={t.id}
                className="flex items-start gap-3 cursor-pointer"
                onClick={() => toggleTodo(t.id)}
              >
                <span
                  aria-hidden
                  className="shrink-0 mt-1.5"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: "1.5px solid var(--color-rule)",
                    background: t.done ? "var(--color-accent)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {t.done && (
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6.5L5 9L9.5 3.5"
                        stroke="var(--color-paper)"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span
                  className="font-serif text-[15px] flex-1"
                  style={{
                    lineHeight: 1.6,
                    color: t.done ? "var(--color-ink-quiet)" : "var(--color-ink)",
                    textDecoration: t.done ? "line-through" : "none",
                  }}
                >
                  {t.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {grammar && grammar.length > 0 && !editing && (
        <div
          className="mt-12 px-6 py-5"
          style={{
            background: "var(--color-paper-deep)",
            border: "1px solid var(--color-rule-soft)",
            borderRadius: 6,
          }}
        >
          <div className="flex items-baseline justify-between mb-4">
            <p className="eyebrow text-ink-soft">
              {grammar.length} grammar issue{grammar.length === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-5">
              <button
                onClick={() => setGrammar(null)}
                className="eyebrow cursor-pointer hover:text-ink transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={applyGrammar}
                disabled={grammarApplying}
                className="font-serif text-[13px] cursor-pointer disabled:opacity-60"
                style={{ color: "var(--color-accent)" }}
              >
                {grammarApplying ? "Applying…" : "Apply all"}
              </button>
            </div>
          </div>
          <ul className="space-y-3">
            {grammar.slice(0, 6).map((iss, i) => (
              <li
                key={i}
                className="font-serif text-[14px] text-ink-soft"
                style={{ lineHeight: 1.55 }}
              >
                <span className="text-ink">{iss.message}</span>
                {iss.replacements.length > 0 && (
                  <span className="ml-2 numeric text-[11.5px] text-ink-quiet">
                    →{" "}
                    {iss.replacements.slice(0, 3).map((r, j) => (
                      <span key={j}>
                        {j > 0 && ", "}
                        <span style={{ color: "var(--color-accent)" }}>{r}</span>
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
            {grammar.length > 6 && (
              <li className="eyebrow text-ink-faint">
                +{grammar.length - 6} more — apply all to fix every issue
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="mt-20 pt-7 border-t border-rule-soft flex items-center">
        {editing ? (
          <div className="flex items-center gap-7">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="font-serif text-[14.5px] text-ink cursor-pointer transition-opacity hover:opacity-70 disabled:opacity-50"
              style={{ fontWeight: 500 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-7">
              <button
                onClick={copy}
                className="eyebrow cursor-pointer hover:text-ink transition-colors"
              >
                Copy
              </button>
              <button
                onClick={polish}
                disabled={polishing}
                className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
              >
                {polishing ? "Polishing…" : "Polish"}
              </button>
              <button
                onClick={checkGrammar}
                disabled={grammarChecking}
                className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
              >
                {grammarChecking ? "Checking…" : "Check grammar"}
              </button>
              <button
                onClick={organize}
                disabled={organizing}
                className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
              >
                {organizing ? "Organizing…" : "Organize"}
              </button>
              {note.todos.length === 0 && (
                <button
                  onClick={extractTodos}
                  disabled={extractingTodos}
                  className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
                >
                  {extractingTodos ? "Extracting…" : "Find action items"}
                </button>
              )}
              {audio && (
                <button
                  onClick={togglePlay}
                  className="eyebrow cursor-pointer hover:text-ink transition-colors"
                  style={{ color: audioPlaying ? "var(--color-accent)" : undefined }}
                >
                  {audioPlaying ? "Stop" : "Replay audio"}
                </button>
              )}
              <button
                onClick={startEdit}
                className="eyebrow cursor-pointer hover:text-ink transition-colors"
              >
                Edit
              </button>
            </div>
            <span className="flex-1" aria-hidden />
            <button
              onClick={() => onDelete(note.id)}
              className="eyebrow cursor-pointer transition-colors hover:text-ink-soft"
              style={{ color: "var(--color-ink-faint)" }}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {preview && (
        <TextPreviewDialog
          title={
            preview.kind === "grammar"
              ? "Review grammar corrections"
              : "Review polished transcript"
          }
          before={note.transcript}
          after={preview.text}
          applying={applyingPreview}
          onCancel={() => setPreview(null)}
          onApply={applyPreview}
        />
      )}
    </div>
  );
}

function TextPreviewDialog({
  title,
  before,
  after,
  applying,
  onCancel,
  onApply,
}: {
  title: string;
  before: string;
  after: string;
  applying: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!applying) onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applying, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(20, 20, 18, 0.30)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="polish-preview-title"
    >
      <div
        className="surface-raised w-full max-w-[820px] px-8 py-7 item-in"
        style={{ borderRadius: 6 }}
      >
        <h2
          id="polish-preview-title"
          className="display-tight text-[24px] text-ink leading-tight"
          style={{ letterSpacing: "-0.022em" }}
        >
          {title}
        </h2>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <PreviewPane label="Current" text={before} />
          <PreviewPane label="Proposed" text={after} />
        </div>
        <div className="mt-7 flex items-center justify-end gap-7">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={applying}
            className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            disabled={applying || before === after}
            className="font-serif text-[14.5px] text-ink cursor-pointer transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ fontWeight: 500 }}
          >
            {applying
              ? "Applying…"
              : before === after
                ? "No changes"
                : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewPane({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="eyebrow text-ink-quiet mb-2">{label}</p>
      <div
        className="font-serif text-[15px] text-ink-soft p-4 overflow-auto"
        style={{
          maxHeight: "46vh",
          lineHeight: 1.65,
          background: "var(--color-paper-deep)",
          border: "1px solid var(--color-rule-soft)",
          borderRadius: 4,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function safeLongDate(date: Date): string {
  return Number.isNaN(date.getTime()) ? "Unknown date" : longDate(date);
}

function safeFormatTime(date: Date): string {
  return Number.isNaN(date.getTime()) ? "--:--" : formatTime(date);
}

function displayModel(model: string): string {
  return model
    .replace("faster-whisper:", "")
    .replace("parakeet-onnx:parakeet-tdt-0.6b-v3-int8", "parakeet v3");
}
