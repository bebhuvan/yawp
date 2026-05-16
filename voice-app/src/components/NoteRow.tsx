import type { Note } from "../lib/types";
import { formatDuration, formatTime } from "../lib/utils";
import { Tag } from "./Tag";

export function NoteRow({
  note,
  onOpen,
  index,
}: {
  note: Note;
  onOpen: (id: string) => void;
  index: number;
}) {
  const excerpt = note.transcript
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);

  return (
    <article
      onClick={() => onOpen(note.id)}
      className="row-hover item-in group cursor-pointer py-7 px-6 -mx-6 rounded-[2px]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-baseline justify-between gap-6">
        <h2
          className="display-tight text-[22px] text-ink leading-snug"
          style={{ letterSpacing: "-0.018em" }}
        >
          {note.title}
        </h2>
        <span className="numeric text-[12.5px] text-ink-quiet shrink-0 tracking-wider">
          {formatTime(note.createdAt)}
        </span>
      </div>

      <p
        className="mt-3 text-[15.5px] text-ink-soft font-serif"
        style={{ lineHeight: 1.7 }}
      >
        {excerpt}
        {note.transcript.length > 260 ? "…" : ""}
      </p>

      {/* Footer: locked-height single line that overflows-hidden so adding
          tags doesn't cause row height jumps. */}
      <div
        className="mt-4 flex items-center gap-3"
        style={{ minHeight: 18, overflow: "hidden" }}
      >
        <span className="eyebrow numeric shrink-0">
          {formatDuration(note.durationSec)}
        </span>
        <span className="eyebrow text-ink-faint shrink-0">·</span>
        <span className="eyebrow shrink-0">
          {note.model.replace("faster-whisper:", "")}
        </span>
        {note.mode === "paste" && (
          <>
            <span className="eyebrow text-ink-faint shrink-0">·</span>
            <span
              className="eyebrow shrink-0"
              style={{ color: "var(--color-accent)" }}
            >
              auto-pasted
            </span>
          </>
        )}
        {note.tags.length > 0 && (
          <>
            <span className="eyebrow text-ink-faint shrink-0">·</span>
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              {note.tags.slice(0, 5).map((t) => (
                <Tag key={t} label={t} />
              ))}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
