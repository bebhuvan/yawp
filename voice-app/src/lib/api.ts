import type { AppSettings, Note, RecordingMode, Todo } from "./types";

const BASE = "http://127.0.0.1:17893";

export const AUDIO_BASE = `${BASE}/audio`;

export interface ServerNote {
  id: string;
  title: string;
  transcript: string;
  language: string | null;
  model: string;
  mode: RecordingMode;
  durationSec: number;
  audioPath: string | null;
  createdAt: string;
  tags?: string[];
  todos?: Todo[];
}

export interface TranscribeResult {
  text: string;
  text_raw: string;
  title: string;
  language: string;
  duration: number;
  model: string;
  segments: { start: number; end: number; text: string }[];
  audio_path: string;
  tags: string[];
  todos: Todo[];
}

export interface GrammarIssue {
  message: string;
  offset: number;
  length: number;
  context: string;
  replacements: string[];
  rule: string;
  category: string;
}

export interface Health {
  ok: boolean;
  backends: string[];
  default_model: string;
  model_ready: boolean;
  db_path: string;
  notes_count: number;
  openrouter_configured: boolean;
}

function fromServer(n: ServerNote): Note {
  return {
    id: n.id,
    title: n.title,
    transcript: n.transcript,
    createdAt: new Date(n.createdAt),
    durationSec: n.durationSec,
    model: n.model,
    mode: n.mode,
    audioPath: n.audioPath ?? undefined,
    tags: n.tags ?? [],
    todos: n.todos ?? [],
  };
}

export function audioUrl(audioPath?: string | null): string | null {
  if (!audioPath) return null;
  const filename = audioPath.split("/").pop();
  if (!filename) return null;
  return `${AUDIO_BASE}/${filename}`;
}

export const api = {
  async health(): Promise<Health> {
    const r = await fetch(`${BASE}/health`);
    if (!r.ok) throw new Error(`health failed: ${r.status}`);
    return r.json();
  },

  async listNotes(): Promise<Note[]> {
    const r = await fetch(`${BASE}/notes`);
    if (!r.ok) throw new Error(`listNotes failed: ${r.status}`);
    const json = (await r.json()) as { notes: ServerNote[] };
    return json.notes.map(fromServer);
  },

  async search(q: string): Promise<Note[]> {
    const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(`search failed: ${r.status}`);
    const json = (await r.json()) as { notes: ServerNote[] };
    return json.notes.map(fromServer);
  },

  async transcribe(audio: Blob): Promise<TranscribeResult> {
    const fd = new FormData();
    fd.append("audio", audio, "audio.wav");
    const r = await fetch(`${BASE}/transcribe`, { method: "POST", body: fd });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`transcribe failed: ${r.status} ${detail}`);
    }
    return r.json();
  },

  async createNote(input: {
    title: string;
    transcript: string;
    language?: string | null;
    model: string;
    mode: RecordingMode;
    duration_sec: number;
    audio_path?: string | null;
    tags?: string[];
    todos?: Todo[];
  }): Promise<Note> {
    const r = await fetch(`${BASE}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`createNote failed: ${r.status} ${detail}`);
    }
    return fromServer(await r.json());
  },

  async updateNote(
    id: string,
    patch: {
      title?: string;
      transcript?: string;
      tags?: string[];
      todos?: Todo[];
    },
  ): Promise<Note> {
    const r = await fetch(`${BASE}/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`updateNote failed: ${r.status}`);
    return fromServer(await r.json());
  },

  async deleteNote(id: string): Promise<void> {
    const r = await fetch(`${BASE}/notes/${id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 204)
      throw new Error(`deleteNote failed: ${r.status}`);
  },

  async polish(
    text: string,
    noteId?: string,
  ): Promise<{ text: string; source: "openrouter" | "cleanup-only" }> {
    const r = await fetch(`${BASE}/polish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, note_id: noteId }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`polish failed: ${r.status} ${detail}`);
    }
    return r.json();
  },

  async checkGrammar(
    text: string,
  ): Promise<{ issues: GrammarIssue[] }> {
    const r = await fetch(`${BASE}/grammar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`grammar check failed: ${r.status} ${detail}`);
    }
    return r.json();
  },

  async applyGrammar(
    text: string,
    noteId?: string,
  ): Promise<{ text: string }> {
    const r = await fetch(`${BASE}/grammar/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, note_id: noteId }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`apply grammar failed: ${r.status} ${detail}`);
    }
    return r.json();
  },

  async extractTodos(noteId: string): Promise<Note> {
    const r = await fetch(`${BASE}/notes/${noteId}/extract-todos`, {
      method: "POST",
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`extract todos failed: ${r.status} ${detail}`);
    }
    return fromServer(await r.json());
  },

  async exportMarkdown(dest: string): Promise<{ dest: string; count: number }> {
    const r = await fetch(`${BASE}/export/markdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dest }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`export failed: ${r.status} ${detail}`);
    }
    return r.json();
  },

  async getSettings(): Promise<AppSettings> {
    const r = await fetch(`${BASE}/settings`);
    if (!r.ok) throw new Error(`getSettings failed: ${r.status}`);
    return r.json();
  },

  async updateSettings(patch: Partial<{
    asr_model: string;
    cleanup_enabled: boolean;
    voice_commands_enabled: boolean;
    live_transcription_enabled: boolean;
    auto_tag_enabled: boolean;
    extract_todos_enabled: boolean;
    openrouter_api_key: string;
    openrouter_model: string;
    max_tags: number;
    hotkey_mode: "toggle" | "hold";
    export_path: string;
    auto_export_enabled: boolean;
  }>): Promise<AppSettings> {
    const r = await fetch(`${BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`updateSettings failed: ${r.status}`);
    return r.json();
  },
};
