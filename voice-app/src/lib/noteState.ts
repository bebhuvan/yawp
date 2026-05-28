import type { Note } from "./types";


export function upsertNote(notes: Note[], note: Note): Note[] {
  const idx = notes.findIndex((n) => n.id === note.id);
  if (idx === -1) return [note, ...notes];
  const next = notes.slice();
  next[idx] = note;
  return next;
}


export function replaceExistingNote(notes: Note[], note: Note): Note[] {
  const idx = notes.findIndex((n) => n.id === note.id);
  if (idx === -1) return notes;
  const next = notes.slice();
  next[idx] = note;
  return next;
}


export function removeNote(notes: Note[], id: string): Note[] {
  return notes.filter((n) => n.id !== id);
}
