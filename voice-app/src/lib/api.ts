import type { AppSettings, Note, RecordingMode, Todo } from "./types";

const BASE = "http://127.0.0.1:17893";

export const AUDIO_BASE = `${BASE}/audio`;

// User-facing error so UI can show a friendly message while logs keep the raw
// detail. Throw via `failed(...)` from any api method.
export class ApiError extends Error {
  readonly userMessage: string;
  readonly status?: number;
  readonly detail?: string;
  constructor(userMessage: string, status?: number, detail?: string) {
    super(userMessage + (detail ? ` (${detail})` : ""));
    this.name = "ApiError";
    this.userMessage = userMessage;
    this.status = status;
    this.detail = detail;
  }
}

function friendly(action: string, status: number, body: string): string {
  // Map common server signals to Yawp-flavored copy. Anything not covered
  // falls through to a calm generic line — never the raw 502/500 text.
  if (status === 0) return `Couldn't reach the transcription service.`;
  if (status === 404) return `${capitalize(action)} — that note no longer exists.`;
  if (status === 502 && body.includes("openrouter")) {
    return "OpenRouter didn't respond. Try again or pick a different model.";
  }
  if (status === 503 && body.includes("grammar")) {
    return "Grammar service is still warming up. Try again in a moment.";
  }
  if (status === 400 && body.includes("api key")) {
    return "Set an OpenRouter key in Settings first.";
  }
  if (status >= 500) return `${capitalize(action)} — the sidecar hit an error.`;
  if (status === 400) return `${capitalize(action)} — request was rejected.`;
  return `${capitalize(action)} failed.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function failed(action: string, r: Response): Promise<never> {
  const detail = await r.text().catch(() => "");
  throw new ApiError(friendly(action, r.status, detail.toLowerCase()), r.status, detail);
}

async function call<T>(action: string, init: () => Promise<Response>): Promise<T> {
  let r: Response;
  try {
    r = await init();
  } catch (e) {
    // Network-level failure (sidecar down). Status 0 → friendly() will pick the
    // "couldn't reach" copy.
    throw new ApiError(friendly(action, 0, ""), 0, (e as Error)?.message);
  }
  if (!r.ok) {
    await failed(action, r);
  }
  return r.json() as Promise<T>;
}

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
  health: () => call<Health>("Health check", () => fetch(`${BASE}/health`)),

  async listNotes(): Promise<Note[]> {
    const json = await call<{ notes: ServerNote[] }>(
      "Loading notes",
      () => fetch(`${BASE}/notes`),
    );
    return json.notes.map(fromServer);
  },

  async search(q: string): Promise<Note[]> {
    const json = await call<{ notes: ServerNote[] }>(
      "Search",
      () => fetch(`${BASE}/search?q=${encodeURIComponent(q)}`),
    );
    return json.notes.map(fromServer);
  },

  async transcribe(audio: Blob): Promise<TranscribeResult> {
    const fd = new FormData();
    fd.append("audio", audio, "audio.wav");
    return call<TranscribeResult>(
      "Transcription",
      () => fetch(`${BASE}/transcribe`, { method: "POST", body: fd }),
    );
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
    const data = await call<ServerNote>(
      "Saving note",
      () =>
        fetch(`${BASE}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
    );
    return fromServer(data);
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
    const data = await call<ServerNote>(
      "Saving changes",
      () =>
        fetch(`${BASE}/notes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
    );
    return fromServer(data);
  },

  async deleteNote(id: string): Promise<void> {
    let r: Response;
    try {
      r = await fetch(`${BASE}/notes/${id}`, { method: "DELETE" });
    } catch (e) {
      throw new ApiError(friendly("Delete", 0, ""), 0, (e as Error)?.message);
    }
    if (!r.ok && r.status !== 204) {
      await failed("Delete", r);
    }
  },

  async restoreNote(id: string): Promise<Note> {
    const data = await call<ServerNote>(
      "Undo delete",
      () => fetch(`${BASE}/notes/${id}/restore`, { method: "POST" }),
    );
    return fromServer(data);
  },

  polish: (text: string, noteId?: string) =>
    call<{ text: string; source: "openrouter" | "cleanup-only" }>(
      "Polish",
      () =>
        fetch(`${BASE}/polish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, note_id: noteId }),
        }),
    ),

  checkGrammar: (text: string) =>
    call<{ issues: GrammarIssue[] }>(
      "Grammar check",
      () =>
        fetch(`${BASE}/grammar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }),
    ),

  applyGrammar: (text: string, noteId?: string) =>
    call<{ text: string }>(
      "Applying corrections",
      () =>
        fetch(`${BASE}/grammar/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, note_id: noteId }),
        }),
    ),

  async extractTodos(noteId: string): Promise<Note> {
    const data = await call<ServerNote>(
      "Find action items",
      () => fetch(`${BASE}/notes/${noteId}/extract-todos`, { method: "POST" }),
    );
    return fromServer(data);
  },

  exportMarkdown: (dest: string) =>
    call<{ dest: string; count: number }>(
      "Export",
      () =>
        fetch(`${BASE}/export/markdown`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dest }),
        }),
    ),

  getSettings: () =>
    call<AppSettings>("Loading settings", () => fetch(`${BASE}/settings`)),

  updateSettings: (
    patch: Partial<{
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
      auto_stop_ms: number;
      export_path: string;
      auto_export_enabled: boolean;
    }>,
  ) =>
    call<AppSettings>(
      "Saving setting",
      () =>
        fetch(`${BASE}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
    ),
};

// Convert any caught error to a user-facing string. For ApiError we use the
// pre-friendly message; for anything else we fall back to a calm generic line.
export function userMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e instanceof ApiError) return e.userMessage;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
