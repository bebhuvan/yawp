import { useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import type { Note } from "../lib/types";
import { formatDuration, formatTime } from "../lib/utils";

const EXCERPT_MAX = 240;

export function NoteRow({
  note,
  folderName,
  dayLabel,
  firstOfDay,
  firstOverall,
  onOpen,
  onEdit,
  onDelete,
  selecting = false,
  selected = false,
  onToggleSelect,
}: {
  note: Note;
  folderName?: string;
  dayLabel: string | null;
  firstOfDay: boolean;
  firstOverall: boolean;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const transcriptExcerpt = note.transcript
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EXCERPT_MAX);
  const summary = note.smartMetadata?.summary?.trim();
  const excerpt = note.searchSnippet
    ? note.searchSnippet
    : summary || transcriptExcerpt;
  const showEllipsis =
    !note.searchSnippet && !summary && note.transcript.length > EXCERPT_MAX;
  const kindCollection = [
    note.smartMetadata?.kind,
    folderName || note.smartMetadata?.collection,
  ]
    .filter(Boolean)
    .join(" / ");

  const deleteFromRow = async () => {
    setDeleting(true);
    try {
      await onDelete(note.id);
    } finally {
      setDeleting(false);
    }
  };

  const topClass = firstOverall ? "pt-6" : firstOfDay ? "pt-16" : "pt-9";

  const handleClick = () => {
    if (selecting) onToggleSelect?.(note.id);
    else onOpen(note.id);
  };

  return (
    <article
      onClick={handleClick}
      aria-selected={selecting ? selected : undefined}
      className={`row-hover-zone grid grid-cols-[120px_1fr] gap-x-10 ${topClass} pb-9`}
      style={{
        borderTop:
          firstOfDay && !firstOverall
            ? "1px solid var(--color-rule-soft)"
            : "none",
        background: selecting && selected ? "var(--color-paper-deep)" : undefined,
      }}
    >
      {/* Marginalia: day label on first row of a day, then time below. */}
      <aside className="select-none pt-[6px]">
        {selecting && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.(note.id);
            }}
            className="mb-3 cursor-pointer"
            aria-label={selected ? "Deselect note" : "Select note"}
            style={{
              width: 17,
              height: 17,
              borderRadius: 4,
              border: `1.5px solid ${selected ? "var(--color-ink)" : "var(--color-rule)"}`,
              background: selected ? "var(--color-ink)" : "transparent",
              display: "grid",
              placeItems: "center",
              transition: "background 140ms, border-color 140ms",
            }}
          >
            {selected && (
              <Check size={11} strokeWidth={3} color="var(--color-paper)" aria-hidden />
            )}
          </button>
        )}
        {dayLabel && (
          <div
            className="marginalia mb-2"
            style={{ color: "var(--color-ink-soft)" }}
          >
            {dayLabel}
          </div>
        )}
        <div className="marginalia-num">{formatTime(note.createdAt)}</div>
      </aside>

      {/* Content column */}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-6">
          <h2
            className="row-title display-tight text-[22px] leading-[1.2] flex-1 min-w-0"
            style={{ letterSpacing: "-0.022em" }}
          >
            {note.title || "Untitled"}
          </h2>
          <div
            className="row-actions flex shrink-0 items-center gap-1 pt-1"
            style={selecting ? { display: "none" } : undefined}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(note.id);
              }}
              className="icon-action cursor-pointer"
              aria-label={`Edit ${note.title || "note"}`}
              title="Edit"
            >
              <Pencil size={12} strokeWidth={1.6} aria-hidden />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteFromRow();
              }}
              disabled={deleting}
              className="icon-action cursor-pointer disabled:opacity-60"
              aria-label={`Delete ${note.title || "note"}`}
              title="Delete"
            >
              <Trash2 size={12} strokeWidth={1.6} aria-hidden />
            </button>
          </div>
        </div>

        <p
          className="mt-3 font-serif text-[15.5px] text-ink-soft"
          style={{ lineHeight: 1.65, overflowWrap: "anywhere" }}
        >
          <SnippetText text={excerpt} />
          {showEllipsis ? "…" : ""}
        </p>

        <div
          className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 eyebrow"
          style={{ minHeight: 16 }}
        >
          <span className="numeric shrink-0">
            {formatDuration(note.durationSec)}
          </span>
          <span className="text-ink-faint shrink-0">·</span>
          <span className="shrink-0">{displayModel(note.model)}</span>
          {note.mode === "paste" && (
            <>
              <span className="text-ink-faint shrink-0">·</span>
              <span className="shrink-0">auto-paste</span>
            </>
          )}
          {kindCollection && (
            <>
              <span className="text-ink-faint shrink-0">·</span>
              <span className="shrink-0">{kindCollection}</span>
            </>
          )}
          {note.tags.length > 0 && (
            <>
              <span className="text-ink-faint shrink-0">·</span>
              <div className="flex items-center gap-3 min-w-0 overflow-hidden">
                {note.tags.slice(0, 5).map((t, i) => (
                  <span key={t} className="flex items-center gap-3 shrink-0">
                    {i > 0 && <span className="text-ink-faint">·</span>}
                    <span style={{ color: "var(--color-ink-soft)" }}>{t}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function SnippetText({ text }: { text: string }) {
  const parts = text.split(/(\[\[.*?\]\])/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("[[") && part.endsWith("]]")) {
          // Search-hit highlight — ink, not accent. Red is reserved for
          // the live recording state.
          return (
            <mark
              key={i}
              style={{
                background: "transparent",
                color: "var(--color-ink)",
                fontWeight: 600,
                textDecoration: "underline",
                textDecorationColor: "var(--color-ink-faint)",
                textDecorationThickness: "1px",
                textUnderlineOffset: "3px",
                padding: 0,
              }}
            >
              {part.slice(2, -2)}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function displayModel(model: string): string {
  return model
    .replace("faster-whisper:", "")
    .replace("parakeet-onnx:parakeet-tdt-0.6b-v3-int8", "parakeet v3");
}
