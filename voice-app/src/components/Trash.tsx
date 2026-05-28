import { useEffect, useState } from "react";
import { api, userMessage } from "../lib/api";
import type { Note } from "../lib/types";
import { longDate } from "../lib/utils";

export function Trash({
  onBack,
  onToast,
  onRestored,
}: {
  onBack: () => void;
  onToast: (msg: string) => void;
  onRestored: (note: Note) => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  const load = async () => {
    try {
      setNotes(await api.listTrash());
    } catch (e) {
      onToast(userMessage(e, "Couldn't load trash."));
      setNotes([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const restore = async (note: Note) => {
    setBusyId(note.id);
    try {
      const restored = await api.restoreNote(note.id);
      setNotes((prev) => prev?.filter((n) => n.id !== note.id) ?? null);
      onRestored(restored);
      onToast("Restored.");
    } catch (e) {
      onToast(userMessage(e, "Couldn't restore note."));
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (note: Note) => {
    if (
      !window.confirm(
        `Permanently delete “${note.title || "Untitled"}”? This can't be undone.`,
      )
    ) {
      return;
    }
    setBusyId(note.id);
    try {
      await api.purgeNote(note.id);
      setNotes((prev) => prev?.filter((n) => n.id !== note.id) ?? null);
      onToast("Deleted forever.");
    } catch (e) {
      onToast(userMessage(e, "Couldn't delete note."));
    } finally {
      setBusyId(null);
    }
  };

  const emptyAll = async () => {
    if (!notes?.length) return;
    if (
      !window.confirm(
        `Permanently delete all ${notes.length} note${notes.length === 1 ? "" : "s"} in trash? This can't be undone.`,
      )
    ) {
      return;
    }
    setEmptying(true);
    try {
      const r = await api.emptyTrash();
      setNotes([]);
      onToast(
        `Emptied trash · ${r.purged} note${r.purged === 1 ? "" : "s"} removed.`,
      );
    } catch (e) {
      onToast(userMessage(e, "Couldn't empty trash."));
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div className="page-in mx-auto max-w-[860px] px-12 pb-32">
      <button
        onClick={onBack}
        className="eyebrow mt-2 mb-12 cursor-pointer hover:text-ink-soft transition-colors"
      >
        ← Back to notes
      </button>

      <div className="flex items-end justify-between gap-6 border-b border-rule-soft pb-5">
        <div>
          <h1
            className="display-tight text-[34px] text-ink leading-tight"
            style={{ letterSpacing: "-0.022em" }}
          >
            Trash
          </h1>
          <p
            className="mt-1.5 font-serif text-[15px] text-ink-soft italic"
            style={{ lineHeight: 1.6 }}
          >
            Deleted notes are kept here until you remove them for good.
          </p>
        </div>
        {notes && notes.length > 0 && (
          <button
            onClick={emptyAll}
            disabled={emptying}
            className="eyebrow shrink-0 cursor-pointer transition-colors disabled:opacity-50"
            style={{ color: "var(--color-accent)" }}
          >
            {emptying ? "Emptying…" : "Empty trash"}
          </button>
        )}
      </div>

      {notes === null ? (
        <p className="mt-10 eyebrow text-ink-quiet">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="mt-20 text-center font-serif text-[17px] text-ink-quiet italic">
          Trash is empty.
        </p>
      ) : (
        <div className="divide-y divide-rule-soft">
          {notes.map((note) => (
            <div
              key={note.id}
              className="flex items-start justify-between gap-8 py-6"
            >
              <div className="min-w-0">
                <h2
                  className="display-tight text-[19px] text-ink leading-snug"
                  style={{ letterSpacing: "-0.018em" }}
                >
                  {note.title || "Untitled"}
                </h2>
                <p
                  className="mt-2 font-serif text-[14.5px] text-ink-soft"
                  style={{
                    lineHeight: 1.6,
                    overflowWrap: "anywhere",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {note.transcript.replace(/\s+/g, " ").trim().slice(0, 200)}
                </p>
                <p className="mt-2 eyebrow text-ink-faint">
                  {Number.isNaN(note.createdAt.getTime())
                    ? "Unknown date"
                    : longDate(note.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-5 pt-1">
                <button
                  onClick={() => restore(note)}
                  disabled={busyId === note.id}
                  className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
                >
                  {busyId === note.id ? "…" : "Restore"}
                </button>
                <button
                  onClick={() => purge(note)}
                  disabled={busyId === note.id}
                  className="eyebrow cursor-pointer transition-colors hover:text-ink-soft disabled:opacity-50"
                  style={{ color: "var(--color-ink-faint)" }}
                >
                  Delete forever
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
