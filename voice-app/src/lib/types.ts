export type RecordingMode = "paste" | "notes";

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export interface SmartMetadata {
  summary?: string;
  kind?: string;
  collection?: string;
  people?: string[];
  projects?: string[];
  keywords?: string[];
  confidence?: number;
  source?: string;
}

export interface Note {
  id: string;
  title: string;
  transcript: string;
  createdAt: Date;
  durationSec: number;
  model: string;
  mode: RecordingMode;
  audioPath?: string;
  tags: string[];
  todos: Todo[];
  smartMetadata: SmartMetadata;
  folderId?: string | null;
  searchSnippet?: string;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: Date;
  noteCount: number;
}

export interface AppSettings {
  asr_model: string;
  input_device: number | null;
  cleanup_enabled: boolean;
  voice_commands_enabled: boolean;
  auto_tag_enabled: boolean;
  extract_todos_enabled: boolean;
  auto_organize_enabled: boolean;
  auto_organize_min_confidence: number;
  categorization_prompt: string;
  openrouter_model: string;
  openrouter_api_key_set: boolean;
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
}
