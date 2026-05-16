export type RecordingMode = "paste" | "notes";

export interface Todo {
  id: string;
  text: string;
  done: boolean;
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
}

export interface AppSettings {
  asr_model: string;
  cleanup_enabled: boolean;
  voice_commands_enabled: boolean;
  live_transcription_enabled: boolean;
  auto_tag_enabled: boolean;
  extract_todos_enabled: boolean;
  openrouter_model: string;
  openrouter_api_key_set: boolean;
  max_tags: number;
  hotkey_mode: "toggle" | "hold";
  auto_stop_ms: number;
  export_path: string;
  auto_export_enabled: boolean;
}
