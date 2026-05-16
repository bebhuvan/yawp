import { useMemo } from "react";
import type { Note } from "../lib/types";
import { groupByDay } from "../lib/utils";
import { NoteRow } from "./NoteRow";

export function Library({
  notes,
  onOpen,
}: {
  notes: Note[];
  onOpen: (id: string) => void;
}) {
  const groups = useMemo(() => groupByDay(notes), [notes]);
  let runningIndex = 0;

  if (notes.length === 0) {
    return (
      <div className="page-in mx-auto max-w-[660px] px-12 pt-24 pb-32 text-center">
        <p className="display text-[42px] text-ink leading-tight">
          Nothing yet.
        </p>
        <p
          className="mt-6 font-serif text-[17px] text-ink-soft italic"
          style={{ lineHeight: 1.7 }}
        >
          Press <span className="numeric">Record</span> — or the global hotkey —
          and your first note will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="page-in mx-auto max-w-[860px] px-12 pb-32">
      {groups.map((group, gi) => (
        <section key={group.day} className={gi === 0 ? "pt-6" : "pt-14"}>
          <div className="flex items-center gap-4 pb-2">
            <h3 className="eyebrow text-ink-soft">{group.day}</h3>
            <span className="h-px flex-1 bg-rule-soft" />
          </div>

          <div className="divide-y divide-rule-soft">
            {group.items.map((note) => {
              const i = runningIndex++;
              return (
                <NoteRow
                  key={note.id}
                  note={note}
                  onOpen={onOpen}
                  index={i}
                />
              );
            })}
          </div>
        </section>
      ))}

      <footer className="mt-24 pt-8 border-t border-rule-soft text-center">
        <p className="eyebrow">
          {notes.length} {notes.length === 1 ? "note" : "notes"} · stored
          locally
        </p>
      </footer>
    </div>
  );
}
