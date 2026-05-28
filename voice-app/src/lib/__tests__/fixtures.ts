import type { Note, RecordingMode } from "../types";


export function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Test note",
    transcript: "hello world",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    durationSec: 1.2,
    model: "test-model",
    mode: "notes" as RecordingMode,
    audioPath: undefined,
    tags: [],
    todos: [],
    smartMetadata: {},
    folderId: null,
    searchSnippet: undefined,
    ...overrides,
  };
}
