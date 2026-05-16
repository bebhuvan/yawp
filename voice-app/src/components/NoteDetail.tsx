import { useEffect, useRef, useState } from "react";
import type { Note, Todo } from "../lib/types";
import { api, audioUrl, type GrammarIssue } from "../lib/api";
import { formatDuration, longDate, formatTime } from "../lib/utils";
import { Tag } from "./Tag";

export function NoteDetail({
  note,
  onBack,
  onUpdate,
  onDelete,
  onToast,
}: {
  note: Note;
  onBack: () => void;
  onUpdate: (note: Note) => void;
  onDelete: (id: string) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(note.title);
  const [editTranscript, setEditTranscript] = useState(note.transcript);
  const [editTags, setEditTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [grammar, setGrammar] = useState<GrammarIssue[] | null>(null);
  const [grammarChecking, setGrammarChecking] = useState(false);
  const [grammarApplying, setGrammarApplying] = useState(false);
  const [extractingTodos, setExtractingTodos] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setEditTitle(note.title);
    setEditTranscript(note.transcript);
    setEditTags(note.tags);
    setEditing(false);
  }, [note.id, note.title, note.transcript, note.tags]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note.transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      console.error(e);
    }
  };

  const startEdit = () => {
    setEditing(true);
    setEditTitle(note.title);
    setEditTranscript(note.transcript);
    setEditTags(note.tags);
    setTagInput("");
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditTitle(note.title);
    setEditTranscript(note.transcript);
    setEditTags(note.tags);
    setTagInput("");
  };

  const saveEdit = async () => {
    try {
      const updated = await api.updateNote(note.id, {
        title: editTitle.trim() || "Untitled",
        transcript: editTranscript.trim(),
        tags: editTags,
      });
      onUpdate(updated);
      setEditing(false);
    } catch (e) {
      console.error(e);
      onToast("Couldn't save changes.");
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || editTags.includes(t) || editTags.length >= 8) return;
    setEditTags([...editTags, t]);
    setTagInput("");
  };

  const polish = async () => {
    setPolishing(true);
    try {
      const r = await api.polish(note.transcript, note.id);
      const updated = { ...note, transcript: r.text };
      onUpdate(updated);
      if (r.source === "cleanup-only") {
        onToast("Polished with local cleanup (set an OpenRouter key for better results).");
      } else {
        onToast("Polished with Nemotron.");
      }
    } catch (e) {
      console.error(e);
      onToast((e as Error).message || "Polish failed.");
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
      console.error(e);
      onToast((e as Error).message || "Grammar check failed.");
    } finally {
      setGrammarChecking(false);
    }
  };

  const applyGrammar = async () => {
    setGrammarApplying(true);
    try {
      const r = await api.applyGrammar(note.transcript, note.id);
      onUpdate({ ...note, transcript: r.text });
      setGrammar(null);
      onToast("Grammar corrections applied.");
    } catch (e) {
      console.error(e);
      onToast((e as Error).message || "Couldn't apply corrections.");
    } finally {
      setGrammarApplying(false);
    }
  };

  const extractTodos = async () => {
    setExtractingTodos(true);
    try {
      const updated = await api.extractTodos(note.id);
      onUpdate(updated);
      if (updated.todos.length === 0) {
        onToast("No action items found in this note.");
      } else {
        onToast(
          `Found ${updated.todos.length} action item${updated.todos.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (e) {
      console.error(e);
      onToast((e as Error).message || "Couldn't extract action items.");
    } finally {
      setExtractingTodos(false);
    }
  };

  const toggleTodo = async (todoId: string) => {
    const next = note.todos.map((t: Todo) =>
      t.id === todoId ? { ...t, done: !t.done } : t,
    );
    // Optimistic update + persist
    onUpdate({ ...note, todos: next });
    try {
      await api.updateNote(note.id, { todos: next });
    } catch (e) {
      console.error(e);
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
      el.play().catch((e) => {
        console.error(e);
        onToast("Couldn't play audio.");
      });
    }
  };

  const deleteNote = async () => {
    setDeleting(true);
    try {
      await onDelete(note.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const audio = audioUrl(note.audioPath);

  return (
    <div className="page-in mx-auto max-w-[660px] px-12 pt-2 pb-32">
      <button
        onClick={onBack}
        className="eyebrow flex items-center gap-2 mb-14 cursor-pointer hover:text-ink-soft transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path
            d="M7 1.5L2.5 5.5L7 9.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        Back to notes
      </button>

      <div className="mb-8 flex items-center gap-3 eyebrow flex-wrap">
        <span>{longDate(note.createdAt)}</span>
        <span className="text-ink-faint">·</span>
        <span className="numeric">{formatTime(note.createdAt)}</span>
        <span className="text-ink-faint">·</span>
        <span className="numeric">{formatDuration(note.durationSec)}</span>
        <span className="text-ink-faint">·</span>
        <span>{note.model.replace("faster-whisper:", "")}</span>
      </div>

      {editing ? (
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="display text-[52px] text-ink leading-[1.05] mb-10 w-full bg-transparent border-0 outline-none focus:bg-paper-deep px-2 -mx-2 rounded transition-colors"
          style={{
            fontVariationSettings: '"opsz" 144, "SOFT" 30, "wght" 400',
            letterSpacing: "-0.028em",
          }}
          autoFocus
        />
      ) : (
        <h1
          className="display text-[52px] text-ink leading-[1.05] mb-10"
          style={{
            fontVariationSettings: '"opsz" 144, "SOFT" 30, "wght" 400',
            letterSpacing: "-0.028em",
          }}
        >
          {note.title}
        </h1>
      )}

      {/* Tags */}
      <div className="mb-10 flex items-center gap-1.5 flex-wrap">
        {(editing ? editTags : note.tags).map((t) => (
          <Tag
            key={t}
            label={t}
            onRemove={
              editing ? () => setEditTags(editTags.filter((x) => x !== t)) : undefined
            }
          />
        ))}
        {editing && (
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
        )}
      </div>

      {editing ? (
        <textarea
          value={editTranscript}
          onChange={(e) => setEditTranscript(e.target.value)}
          className="font-serif text-[19px] text-ink w-full bg-transparent border-0 outline-none focus:bg-paper-deep px-3 -mx-3 py-2 rounded transition-colors resize-none"
          style={{
            lineHeight: 1.75,
            fontVariationSettings: '"opsz" 14',
            minHeight: "30vh",
          }}
          rows={Math.max(6, editTranscript.split("\n").length + 2)}
        />
      ) : (
        <article
          className="font-serif text-[19px] text-ink"
          style={{ lineHeight: 1.75, fontVariationSettings: '"opsz" 14' }}
        >
          {note.transcript.split(/\n\n+/).map((para, i) => (
            <p key={i} className={i > 0 ? "mt-6" : ""}>
              {para}
            </p>
          ))}
        </article>
      )}

      {audio && (
        <audio
          ref={audioRef}
          src={audio}
          onPlay={() => setAudioPlaying(true)}
          onPause={() => setAudioPlaying(false)}
          onEnded={() => setAudioPlaying(false)}
          preload="none"
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
                className="flex items-start gap-3 cursor-pointer group"
                onClick={() => toggleTodo(t.id)}
              >
                <button
                  aria-label={t.done ? "Mark undone" : "Mark done"}
                  className="shrink-0 mt-1.5 cursor-pointer"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: "1.5px solid var(--color-rule)",
                    background: t.done ? "var(--color-accent)" : "transparent",
                    transition: "background 180ms",
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
                </button>
                <span
                  className="font-serif text-[15px] flex-1"
                  style={{
                    lineHeight: 1.6,
                    color: t.done
                      ? "var(--color-ink-quiet)"
                      : "var(--color-ink)",
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
              <li key={i} className="font-serif text-[14px] text-ink-soft" style={{ lineHeight: 1.55 }}>
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

      <div className="mt-16 pt-8 border-t border-rule-soft flex items-center gap-6 flex-wrap">
        {!editing && (
          <>
            <button
              onClick={copy}
              className="eyebrow flex items-center gap-2 cursor-pointer hover:text-ink transition-colors"
              style={{ color: copied ? "var(--color-accent)" : undefined }}
            >
              <CopyIcon /> {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={polish}
              disabled={polishing}
              className="eyebrow flex items-center gap-2 cursor-pointer hover:text-ink transition-colors disabled:opacity-60"
            >
              <SparkleIcon /> {polishing ? "Polishing…" : "Polish"}
            </button>
            <button
              onClick={checkGrammar}
              disabled={grammarChecking}
              className="eyebrow flex items-center gap-2 cursor-pointer hover:text-ink transition-colors disabled:opacity-60"
            >
              <CheckIcon /> {grammarChecking ? "Checking…" : "Check grammar"}
            </button>
            {note.todos.length === 0 && (
              <button
                onClick={extractTodos}
                disabled={extractingTodos}
                className="eyebrow flex items-center gap-2 cursor-pointer hover:text-ink transition-colors disabled:opacity-60"
              >
                <TasksIcon /> {extractingTodos ? "Extracting…" : "Find action items"}
              </button>
            )}
            <button
              onClick={startEdit}
              className="eyebrow flex items-center gap-2 cursor-pointer hover:text-ink transition-colors"
            >
              <EditIcon /> Edit
            </button>
            {audio && (
              <button
                onClick={togglePlay}
                className="eyebrow flex items-center gap-2 cursor-pointer hover:text-ink transition-colors"
                style={{ color: audioPlaying ? "var(--color-accent)" : undefined }}
              >
                {audioPlaying ? <StopIcon /> : <PlayIcon />}{" "}
                {audioPlaying ? "Stop" : "Replay audio"}
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="eyebrow flex items-center gap-2 cursor-pointer hover:text-ink transition-colors disabled:opacity-60"
              style={{ color: "var(--color-ink-quiet)" }}
            >
              <TrashIcon /> {deleting ? "Deleting…" : "Delete"}
            </button>
          </>
        )}
        {editing && (
          <>
            <button
              onClick={saveEdit}
              className="font-serif text-[14px] cursor-pointer transition-colors"
              style={{ color: "var(--color-accent)" }}
            >
              Save
            </button>
            <button
              onClick={cancelEdit}
              className="eyebrow cursor-pointer hover:text-ink transition-colors"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {confirmDelete && (
        <DeleteConfirmDialog
          title={note.title}
          deleting={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={deleteNote}
        />
      )}
    </div>
  );
}

function DeleteConfirmDialog({
  title,
  deleting,
  onCancel,
  onConfirm,
}: {
  title: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!deleting) onCancel();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (!deleting) onConfirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleting, onCancel, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(30, 24, 18, 0.22)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-note-title"
    >
      <div
        className="w-full max-w-[380px] px-7 py-6 item-in"
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-rule)",
          borderRadius: 6,
          boxShadow:
            "0 24px 60px -28px rgba(40,28,18,0.45), 0 8px 20px -12px rgba(40,28,18,0.18)",
        }}
      >
        <h2
          id="delete-note-title"
          className="display-tight text-[22px] text-ink leading-tight"
          style={{ letterSpacing: "-0.018em" }}
        >
          Delete note?
        </h2>
        <p
          className="mt-3 font-serif text-[15px] text-ink-soft"
          style={{ lineHeight: 1.6 }}
        >
          <span className="text-ink">{title}</span> will be removed from the
          library. This cannot be undone.
        </p>
        <div className="mt-7 flex items-center justify-end gap-5">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={deleting}
            className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="font-serif text-[14px] cursor-pointer transition-colors disabled:opacity-60"
            style={{ color: "var(--color-accent)" }}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="6.5" height="7" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <path
        d="M4.5 2V1.5C4.5 1.224 4.724 1 5 1H9.5C9.776 1 10 1.224 10 1.5V8C10 8.276 9.776 8.5 9.5 8.5H9"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M3 2.5L9 6L3 9.5V2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="3" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 3.5H9.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M4.5 3.5V2.5H7.5V3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 4.5L4 10H8L8.5 4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 6V8.5M6.75 6V8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2 9V10H3L9 4L8 3L2 9Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2.5 6.5L5 9L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="2" y="2.5" width="2" height="2" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <rect x="2" y="7" width="2" height="2" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <path d="M5.5 3.5H10M5.5 8H10" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M6 1.5V4M6 8V10.5M1.5 6H4M8 6H10.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
