import type { AppSettings, Folder, Note, RecordingMode, SmartMetadata, Todo } from "./types";

const DEFAULT_BASE = "http://127.0.0.1:17893";
const configuredBase = import.meta.env.VITE_YAWP_SIDECAR_URL;
export const SIDECAR_BASE = (configuredBase || DEFAULT_BASE).replace(/\/+$/, "");

const TIMEOUT_MS = 8_000;
const LONG_TIMEOUT_MS = 120_000;

export const AUDIO_BASE = `${SIDECAR_BASE}/audio`;

export function sidecarUrl(path: string): string {
  return `${SIDECAR_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function sidecarEventsUrl(): string {
  return sidecarUrl("/events");
}

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
  try {
    return (await r.json()) as T;
  } catch (e) {
    throw new ApiError(
      `${capitalize(action)} — invalid response from the sidecar.`,
      r.status,
      (e as Error)?.message,
    );
  }
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
  smartMetadata?: SmartMetadata;
  folderId?: string | null;
  searchSnippet?: string;
}

export interface ServerFolder {
  id: string;
  name: string;
  createdAt: string;
  noteCount: number;
}

export interface TranscribeResult {
  request_id: string;
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
  smart_metadata: SmartMetadata;
  enrichment_status: {
    requested: boolean;
    ok: boolean;
    code?: string | null;
    message?: string | null;
  };
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

export interface Diagnostics {
  host: string;
  port: number;
  data_dir: string;
  audio_dir: string;
  db_path: string;
  imports: Record<string, boolean>;
  tools: Record<string, boolean>;
  paste: {
    session: string;
    selected_tool: string | null;
    ready: boolean;
  };
  daemon: {
    running: boolean;
    socket: string;
    status: string;
    error?: string;
    detail?: {
      state: string;
      recording_mode: string | null;
      hotkey_mode: "toggle" | "hold" | null;
      auto_stop_ms: number;
      bindings: {
        hotkey_notes: string | null;
        hotkey_paste: string | null;
        hold_key_notes: string | null;
        hold_key_paste: string | null;
      };
      paste_tool: string | null;
      audio_feedback_enabled?: boolean;
    } | null;
  };
  database: {
    ready: boolean;
    path: string;
    notes_count?: number;
    error?: string;
  };
  settings: {
    asr_model: string;
    input_device: number | null;
    hotkey_mode: "toggle" | "hold";
    hotkey_notes: string;
    hotkey_paste: string;
    hold_key_notes: string;
    hold_key_paste: string;
    auto_stop_ms: number;
    audio_feedback_enabled: boolean;
    auto_organize_enabled: boolean;
    auto_organize_min_confidence: number;
    openrouter_configured: boolean;
  };
  model: {
    configured: string;
    active_backend: string;
    active_model?: string;
    loaded: boolean;
    restart_required: boolean;
    device?: string;
    compute_type?: string;
    parakeet_ready?: boolean;
    parakeet_path?: string;
    error?: string;
  };
  microphone: {
    available: boolean;
    name?: string;
    channels?: number;
    default_samplerate?: number;
    selected_index?: number | null;
    error?: string;
  };
  port_available: boolean;
}

export interface AudioInputDevice {
  index: number;
  name: string;
  channels: number;
  defaultSamplerate?: number;
  isDefault: boolean;
  selected: boolean;
}

export interface CacheItem {
  id: string;
  label: string;
  description: string;
  bytes: number;
  count?: number;
  path?: string;
  destructive: boolean;
}

export interface CacheUsage {
  audio_total_bytes: number;
  items: CacheItem[];
}

export interface AskAnswer {
  answer: string;
  sources: { id: string; title: string }[];
  answered: boolean;
}

export function fromServerNote(n: ServerNote): Note {
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
    smartMetadata: n.smartMetadata ?? {},
    folderId: n.folderId ?? null,
    searchSnippet: n.searchSnippet,
  };
}

export function fromServerFolder(f: ServerFolder): Folder {
  return {
    id: f.id,
    name: f.name,
    createdAt: new Date(f.createdAt),
    noteCount: f.noteCount,
  };
}

export function audioUrl(audioPath?: string | null): string | null {
  if (!audioPath) return null;
  const filename = audioPath.split("/").pop();
  if (!filename) return null;
  return `${AUDIO_BASE}/${filename}`;
}

export const api = {
  health: () => call<Health>("Health check", () => fetch(sidecarUrl("/health"), { signal: AbortSignal.timeout(TIMEOUT_MS) })),

  diagnostics: () =>
    call<Diagnostics>("Diagnostics", () => fetch(sidecarUrl("/diagnostics"), { signal: AbortSignal.timeout(TIMEOUT_MS) })),

  cacheUsage: () =>
    call<CacheUsage>("Cache usage", () => fetch(sidecarUrl("/cache"), { signal: AbortSignal.timeout(TIMEOUT_MS) })),

  clearCache: (target: string) =>
    call<{ cleared: string; freed_bytes?: number; count?: number }>(
      "Clear cache",
      () =>
        fetch(sidecarUrl("/cache/clear"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    ),

  async listNotes(): Promise<Note[]> {
    const json = await call<{ notes: ServerNote[] }>(
      "Loading notes",
      () => fetch(sidecarUrl("/notes"), { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
    return json.notes.map(fromServerNote);
  },

  async listFolders(): Promise<Folder[]> {
    const json = await call<{ folders: ServerFolder[] }>(
      "Loading folders",
      () => fetch(sidecarUrl("/folders"), { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
    return json.folders.map(fromServerFolder);
  },

  async createFolder(name: string): Promise<Folder> {
    const data = await call<ServerFolder>(
      "Creating folder",
      () =>
        fetch(sidecarUrl("/folders"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    );
    return fromServerFolder(data);
  },

  async updateFolder(id: string, name: string): Promise<Folder> {
    const data = await call<ServerFolder>(
      "Renaming folder",
      () =>
        fetch(sidecarUrl(`/folders/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    );
    return fromServerFolder(data);
  },

  async deleteFolder(id: string): Promise<void> {
    let r: Response;
    try {
      r = await fetch(sidecarUrl(`/folders/${id}`), { method: "DELETE", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new ApiError(friendly("Delete folder", 0, ""), 0, (e as Error)?.message);
    }
    if (!r.ok && r.status !== 204) {
      await failed("Delete folder", r);
    }
  },

  async search(q: string): Promise<Note[]> {
    const json = await call<{ notes: ServerNote[] }>(
      "Search",
      () => fetch(sidecarUrl(`/search?q=${encodeURIComponent(q)}`), { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
    return json.notes.map(fromServerNote);
  },

  async transcribe(audio: Blob): Promise<TranscribeResult> {
    const fd = new FormData();
    fd.append("audio", audio, "audio.wav");
    return call<TranscribeResult>(
      "Transcription",
      () => fetch(sidecarUrl("/transcribe"), { method: "POST", body: fd, signal: AbortSignal.timeout(LONG_TIMEOUT_MS) }),
    );
  },

  captureStatus: () =>
    call<{ recording: boolean }>(
      "Recorder status",
      () => fetch(sidecarUrl("/capture/status"), { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ),

  captureStart: () =>
    call<{ recording: boolean }>(
      "Starting recorder",
      () => fetch(sidecarUrl("/capture/start"), { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ),

  captureCancel: () =>
    call<{ recording: boolean }>(
      "Cancel recording",
      () => fetch(sidecarUrl("/capture/cancel"), { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ),

  captureStop: () =>
    call<TranscribeResult>(
      "Transcription",
      () => fetch(sidecarUrl("/capture/stop"), { method: "POST", signal: AbortSignal.timeout(LONG_TIMEOUT_MS) }),
    ),

  async captureStopAndSave(mode: RecordingMode): Promise<Note> {
    const data = await call<ServerNote>(
      "Saving recording",
      () =>
        fetch(sidecarUrl("/capture/stop-and-save"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
          signal: AbortSignal.timeout(LONG_TIMEOUT_MS),
        }),
    );
    return fromServerNote(data);
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
    smart_metadata?: SmartMetadata;
    folder_id?: string | null;
  }): Promise<Note> {
    const data = await call<ServerNote>(
      "Saving note",
      () =>
        fetch(sidecarUrl("/notes"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    );
    return fromServerNote(data);
  },

  async updateNote(
    id: string,
    patch: {
      title?: string;
      transcript?: string;
      tags?: string[];
      todos?: Todo[];
      smart_metadata?: SmartMetadata;
    },
  ): Promise<Note> {
    const data = await call<ServerNote>(
      "Saving changes",
      () =>
        fetch(sidecarUrl(`/notes/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    );
    return fromServerNote(data);
  },

  async assignNoteFolder(noteId: string, folderId: string | null): Promise<Note> {
    const data = await call<ServerNote>(
      "Moving note",
      () =>
        fetch(sidecarUrl(`/notes/${noteId}/folder`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_id: folderId }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    );
    return fromServerNote(data);
  },

  async deleteNote(id: string): Promise<void> {
    let r: Response;
    try {
      r = await fetch(sidecarUrl(`/notes/${id}`), { method: "DELETE", signal: AbortSignal.timeout(TIMEOUT_MS) });
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
      () => fetch(sidecarUrl(`/notes/${id}/restore`), { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
    return fromServerNote(data);
  },

  async bulkDeleteNotes(ids: string[]): Promise<string[]> {
    const data = await call<{ deleted: string[] }>(
      "Delete notes",
      () =>
        fetch(sidecarUrl("/notes/bulk-delete"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    );
    return data.deleted;
  },

  async bulkRestoreNotes(ids: string[]): Promise<Note[]> {
    const data = await call<{ notes: ServerNote[] }>(
      "Undo delete",
      () =>
        fetch(sidecarUrl("/notes/bulk-restore"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    );
    return data.notes.map(fromServerNote);
  },

  async listTrash(): Promise<Note[]> {
    const data = await call<{ notes: ServerNote[] }>(
      "Loading trash",
      () => fetch(sidecarUrl("/notes/trash"), { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
    return data.notes.map(fromServerNote);
  },

  async purgeNote(id: string): Promise<void> {
    let r: Response;
    try {
      r = await fetch(sidecarUrl(`/notes/${id}/purge`), { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new ApiError(friendly("Delete forever", 0, ""), 0, (e as Error)?.message);
    }
    if (!r.ok && r.status !== 204) {
      await failed("Delete forever", r);
    }
  },

  emptyTrash: () =>
    call<{ purged: number }>(
      "Empty trash",
      () => fetch(sidecarUrl("/notes/empty-trash"), { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ),

  polish: (text: string, noteId?: string) =>
    call<{ text: string; source: "openrouter" | "cleanup-only" }>(
      "Polish",
      () =>
        fetch(sidecarUrl("/polish"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, note_id: noteId }),
          signal: AbortSignal.timeout(LONG_TIMEOUT_MS),
        }),
    ),

  checkGrammar: (text: string) =>
    call<{ issues: GrammarIssue[] }>(
      "Grammar check",
      () =>
        fetch(sidecarUrl("/grammar"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(LONG_TIMEOUT_MS),
        }),
    ),

  applyGrammar: (text: string, noteId?: string) =>
    call<{ text: string }>(
      "Applying corrections",
      () =>
        fetch(sidecarUrl("/grammar/apply"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, note_id: noteId }),
          signal: AbortSignal.timeout(LONG_TIMEOUT_MS),
        }),
    ),

  async extractTodos(noteId: string): Promise<Note> {
    const data = await call<ServerNote>(
      "Find action items",
      () => fetch(sidecarUrl(`/notes/${noteId}/extract-todos`), { method: "POST", signal: AbortSignal.timeout(LONG_TIMEOUT_MS) }),
    );
    return fromServerNote(data);
  },

  async organizeNote(noteId: string): Promise<Note> {
    const data = await call<ServerNote>(
      "Organizing note",
      () => fetch(sidecarUrl(`/notes/${noteId}/organize`), { method: "POST", signal: AbortSignal.timeout(LONG_TIMEOUT_MS) }),
    );
    return fromServerNote(data);
  },

  exportMarkdown: (dest: string) =>
    call<{ dest: string; count: number }>(
      "Export",
      () =>
        fetch(sidecarUrl("/export/markdown"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dest }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    ),

  getSettings: () =>
    call<AppSettings>("Loading settings", () => fetch(sidecarUrl("/settings"), { signal: AbortSignal.timeout(TIMEOUT_MS) })),

  inputDevices: () =>
    call<{ devices: AudioInputDevice[]; selected: number | null }>(
      "Loading microphones",
      () => fetch(sidecarUrl("/audio/input-devices"), { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ),

  updateSettings: (
    patch: Partial<{
      asr_model: string;
      input_device: number | null;
      cleanup_enabled: boolean;
      voice_commands_enabled: boolean;
      auto_tag_enabled: boolean;
      extract_todos_enabled: boolean;
      auto_organize_enabled: boolean;
      auto_organize_min_confidence: number;
      categorization_prompt: string;
      openrouter_api_key: string;
      openrouter_model: string;
      max_tags: number;
      hotkey_mode: "toggle" | "hold";
      hotkey_notes: string;
      hotkey_paste: string;
      hold_key_notes: string;
      hold_key_paste: string;
      auto_stop_ms: number;
      audio_feedback_enabled: boolean;
      paste_use_clipboard: boolean;
      export_path: string;
      auto_export_enabled: boolean;
    }>,
  ) =>
    call<AppSettings>(
      "Saving setting",
      () =>
        fetch(sidecarUrl("/settings"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    ),

  reorganizeNotes: () =>
    call<{ organized: number }>(
      "Reorganize notes",
      () => fetch(sidecarUrl("/notes/reorganize"), { method: "POST", signal: AbortSignal.timeout(LONG_TIMEOUT_MS) }),
    ),

  askNotes: (question: string) =>
    call<AskAnswer>(
      "Ask your notes",
      () =>
        fetch(sidecarUrl("/ask"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
          signal: AbortSignal.timeout(LONG_TIMEOUT_MS),
        }),
    ),

  testOpenRouter: (input: { api_key?: string; model?: string }) =>
    call<{ ok: boolean; model: string; response: string }>(
      "Testing OpenRouter",
      () =>
        fetch(sidecarUrl("/settings/openrouter/test"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(LONG_TIMEOUT_MS),
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
