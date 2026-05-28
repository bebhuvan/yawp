import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import {
  api,
  userMessage,
  type AudioInputDevice,
  type CacheItem,
  type CacheUsage,
  type Diagnostics,
} from "../lib/api";

// GitHub repo (owner/name) — used for the update check and project links.
const GITHUB_REPO = "bebhuvan/yawp";
const PROJECT_URL = "https://bebhuvan.github.io/yawp/";
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
import {
  LOCAL_ASR_MODELS,
  localAsrModelOptions,
  type LocalAsrModel,
} from "../lib/local-asr-models";
import { ModelDropdown } from "./ModelDropdown";
import type { AppSettings } from "../lib/types";

const TOGGLE_NOTES_OPTIONS = [
  { value: "<ctrl>+<alt>+n", label: "Ctrl + Alt + N" },
  { value: "<ctrl>+<alt>+m", label: "Ctrl + Alt + M" },
  { value: "<ctrl>+<alt>+<f8>", label: "Ctrl + Alt + F8" },
  { value: "<ctrl>+<alt>+<f9>", label: "Ctrl + Alt + F9" },
  { value: "<ctrl>+<alt>+<f10>", label: "Ctrl + Alt + F10" },
  { value: "<ctrl>+<alt>+<f12>", label: "Ctrl + Alt + F12" },
];

const TOGGLE_PASTE_OPTIONS = [
  { value: "<ctrl>+<alt>+v", label: "Ctrl + Alt + V" },
  { value: "<ctrl>+<alt>+m", label: "Ctrl + Alt + M" },
  { value: "<ctrl>+<alt>+<f8>", label: "Ctrl + Alt + F8" },
  { value: "<ctrl>+<alt>+<f9>", label: "Ctrl + Alt + F9" },
  { value: "<ctrl>+<alt>+<f10>", label: "Ctrl + Alt + F10" },
  { value: "<ctrl>+<alt>+<f12>", label: "Ctrl + Alt + F12" },
];

const HOLD_NOTES_OPTIONS = [
  { value: "<menu>", label: "Menu" },
  { value: "<scroll_lock>", label: "Scroll Lock" },
  { value: "<pause>", label: "Pause" },
  { value: "<insert>", label: "Insert" },
  { value: "<f8>", label: "F8" },
  { value: "<f9>", label: "F9" },
  { value: "<f10>", label: "F10" },
  { value: "<f12>", label: "F12" },
];

const HOLD_PASTE_OPTIONS = [
  { value: "<ctrl_r>", label: "Right Ctrl long-hold" },
  ...HOLD_NOTES_OPTIONS,
];

const DEFAULT_HOTKEYS = {
  hotkey_mode: "toggle" as const,
  hotkey_notes: "<ctrl>+<alt>+n",
  hotkey_paste: "<ctrl>+<alt>+v",
  hold_key_notes: "<menu>",
  hold_key_paste: "<ctrl_r>",
  auto_stop_ms: 1200,
};

export function Settings({
  onToast,
  onAutoStopMsChange,
}: {
  onToast: (msg: string) => void;
  onAutoStopMsChange?: (ms: number) => void;
}) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [inputDevices, setInputDevices] = useState<AudioInputDevice[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingOpenRouter, setTestingOpenRouter] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<{
    status: "checking" | "current" | "available" | "error";
    latest?: string;
  }>({ status: "checking" });
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const checkUpdate = async () => {
    setUpdateInfo({ status: "checking" });
    try {
      let current = appVersion;
      if (!current) {
        current = await getVersion();
        setAppVersion(current);
      }
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const latest = String(data.tag_name || "").replace(/^v/, "");
      if (latest && isNewerVersion(latest, current)) {
        setUpdateInfo({ status: "available", latest });
        setUpdateDismissed(false);
      } else {
        setUpdateInfo({ status: "current" });
      }
    } catch {
      setUpdateInfo({ status: "error" });
    }
  };

  useEffect(() => {
    void checkUpdate();
  }, []);

  const refreshDiagnostics = async () => {
    try {
      setDiagnostics(await api.diagnostics());
    } catch (e) {
      console.error(e);
      setDiagnostics(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getSettings(),
      api.diagnostics().catch(() => null),
      api.inputDevices().catch(() => null),
    ])
      .then(([settings, diag, devices]) => {
        if (!cancelled) {
          setS(settings);
          setDiagnostics(diag);
          setInputDevices(devices?.devices ?? []);
        }
      })
      .catch((e) => {
        console.error(e);
        onToast("Couldn't load settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [onToast]);

  const update = async (
    patch: Parameters<typeof api.updateSettings>[0],
    msg?: string,
  ) => {
    setSaving(true);
    try {
      const next = await api.updateSettings(patch);
      setS(next);
      if (typeof patch.auto_stop_ms === "number") {
        onAutoStopMsChange?.(patch.auto_stop_ms);
      }
      if (isHotkeyPatch(patch)) {
        refreshDiagnostics();
      }
      if (msg) onToast(msg);
    } catch (e) {
      console.error(e);
      onToast(userMessage(e, "Couldn't save setting."));
    } finally {
      setSaving(false);
    }
  };

  const saveApiKey = () => {
    if (!apiKeyInput.trim()) return;
    update({ openrouter_api_key: apiKeyInput.trim() }, "OpenRouter key saved.");
    setApiKeyInput("");
  };

  const clearApiKey = () => {
    update({ openrouter_api_key: "" }, "OpenRouter key cleared.");
  };

  const testOpenRouter = async () => {
    setTestingOpenRouter(true);
    try {
      const result = await api.testOpenRouter({
        api_key: apiKeyInput.trim() || undefined,
        model: s?.openrouter_model,
      });
      onToast(`OpenRouter responded from ${result.model}.`);
      refreshDiagnostics();
    } catch (e) {
      console.error(e);
      onToast(userMessage(e, "OpenRouter test failed."));
    } finally {
      setTestingOpenRouter(false);
    }
  };

  const refreshInputDevices = async () => {
    try {
      const result = await api.inputDevices();
      setInputDevices(result.devices);
    } catch (e) {
      console.error(e);
      onToast(userMessage(e, "Couldn't load microphones."));
    }
  };

  if (!s) {
    return (
      <div className="mx-auto max-w-[700px] px-12 pt-12 eyebrow text-ink-quiet">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="page-in mx-auto max-w-[700px] px-12 pb-32">
      {updateInfo.status === "available" && !updateDismissed && (
        <div
          className="item-in mt-2 mb-12 flex items-center gap-4 rounded-lg px-5 py-4"
          style={{
            background: "var(--color-accent-soft)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <span
            className="pulse-ink shrink-0"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--color-accent)",
            }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p
              className="display-tight text-[16px]"
              style={{ letterSpacing: "-0.018em", color: "var(--color-accent-ink)" }}
            >
              Yawp {updateInfo.latest} is available
            </p>
            <p
              className="mt-0.5 font-serif text-[13.5px] italic"
              style={{ lineHeight: 1.5, color: "var(--color-ink-soft)" }}
            >
              You're on {appVersion || "an older version"}. See what's changed and grab the update.
            </p>
          </div>
          <button
            onClick={() => void openUrl(RELEASES_URL)}
            className="eyebrow shrink-0 cursor-pointer transition-opacity hover:opacity-70"
            style={{ color: "var(--color-accent-ink)" }}
          >
            View release ↗
          </button>
          <button
            onClick={() => setUpdateDismissed(true)}
            aria-label="Dismiss update notice"
            className="shrink-0 cursor-pointer text-[18px] leading-none transition-opacity hover:opacity-70"
            style={{ color: "var(--color-ink-quiet)" }}
          >
            ×
          </button>
        </div>
      )}

      <Section
        index={1}
        title="Transcription"
        subtitle="Local ASR model used by the sidecar. Restart the sidecar after changing this."
      >
        <ModeRow
          label="ASR model"
          options={localAsrModelOptions}
          value={s.asr_model}
          onChange={(v) =>
            update(
              { asr_model: v },
              "Transcription model saved. Restart the sidecar to use it.",
            )
          }
          disabled={saving}
        />
        <LocalAsrModelList
          selected={s.asr_model}
          disabled={saving}
          onSelect={(modelId) =>
            update(
              { asr_model: modelId },
              "Transcription model saved. Restart the sidecar to use it.",
            )
          }
        />
        <MicrophoneRow
          value={s.input_device}
          devices={inputDevices}
          disabled={saving}
          onRefresh={refreshInputDevices}
          onChange={(value) =>
            update(
              { input_device: value },
              value === null ? "Using the system microphone." : "Microphone saved.",
            )
          }
        />
        <Help>
          Faster Whisper models download from Hugging Face the first time the
          sidecar loads them. Parakeet v3 requires a compatible ONNX model
          directory. Restart the sidecar after changing models.
        </Help>
      </Section>

      <Section index={2} title="Transcript cleanup" subtitle="Tier 1 — regex-based polish applied to every new transcript.">
        <Toggle
          label="Auto-clean transcripts"
          help="Remove fillers (uh, um, you know), fix capitalization, dedupe stutters."
          value={s.cleanup_enabled}
          onChange={(v) => update({ cleanup_enabled: v })}
          disabled={saving}
        />
        <Toggle
          label="Voice commands"
          help={`Interpret spoken phrases as control: "period" → ., "new paragraph" → ¶, "question mark" → ?, "open/close quote" → " ".`}
          value={s.voice_commands_enabled}
          onChange={(v) => update({ voice_commands_enabled: v })}
          disabled={saving}
        />
      </Section>

      <Section index={3} title="Note intelligence" subtitle="Layer extra context onto each new note.">
        <Toggle
          label="Auto-tag transcripts"
          help="Rule-based by default. Uses the selected OpenRouter model when a key is set (better tags)."
          value={s.auto_tag_enabled}
          onChange={(v) => update({ auto_tag_enabled: v })}
          disabled={saving}
        />
        <Toggle
          label="Auto-extract action items"
          help="Run the transcript through your OpenRouter model and surface a checklist. Requires API key. You can also run this manually per-note."
          value={s.extract_todos_enabled}
          onChange={(v) => update({ extract_todos_enabled: v })}
          disabled={saving || !s.openrouter_api_key_set}
        />
        <Toggle
          label="Auto-organize into folders"
          help="Use smart metadata to create or reuse folders for new notes. Manual folder moves are never overwritten."
          value={s.auto_organize_enabled}
          onChange={(v) => update({ auto_organize_enabled: v })}
          disabled={saving}
        />
        <ModeRow
          label="Folder confidence"
          options={[
            { value: "0.55", label: "Loose" },
            { value: "0.65", label: "Balanced" },
            { value: "0.80", label: "Strict" },
          ]}
          value={String(s.auto_organize_min_confidence)}
          onChange={(v) => update({ auto_organize_min_confidence: Number(v) })}
          disabled={saving || !s.auto_organize_enabled}
        />
        <CategorizationPrompt
          value={s.categorization_prompt}
          disabled={saving}
          onSave={(text) =>
            update({ categorization_prompt: text }, "Categorization prompt saved.")
          }
          onReorganize={async () => {
            try {
              const r = await api.reorganizeNotes();
              onToast(
                r.organized > 0
                  ? `Filed ${r.organized} note${r.organized === 1 ? "" : "s"} into folders.`
                  : "No unfiled notes to organize.",
              );
            } catch (e) {
              onToast(userMessage(e, "Reorganize failed."));
            }
          }}
        />
      </Section>

      <Section
        index={4}
        title="OpenRouter"
        subtitle="Optional. When set, used for conservative note polish and higher-quality tags. Free models cost nothing."
      >
        <div className="space-y-4">
          <Row label="Status">
            {s.openrouter_api_key_set ? (
              <span style={{ color: "var(--color-accent)" }} className="eyebrow">
                connected · key hidden
              </span>
            ) : (
              <span className="eyebrow text-ink-quiet">not configured</span>
            )}
          </Row>

          <Row label={s.openrouter_api_key_set ? "Replace key" : "API key"}>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-or-v1-…"
              className="numeric text-[12px] text-ink bg-paper-deep px-3 py-2 rounded border border-rule-soft min-w-[280px] outline-none focus:border-rule text-right"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveApiKey();
              }}
            />
          </Row>

          <div className="flex justify-end gap-5">
            {s.openrouter_api_key_set && (
              <button
                onClick={clearApiKey}
                className="eyebrow cursor-pointer hover:text-ink transition-colors"
                disabled={saving}
              >
                Clear key
              </button>
            )}
            <button
              onClick={testOpenRouter}
              disabled={testingOpenRouter || saving || (!apiKeyInput.trim() && !s.openrouter_api_key_set)}
              className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
            >
              {testingOpenRouter ? "Testing" : "Test"}
            </button>
            <button
              onClick={saveApiKey}
              disabled={!apiKeyInput.trim() || saving}
              className="font-serif text-[14px] cursor-pointer transition-colors disabled:opacity-50"
              style={{ color: "var(--color-accent)" }}
            >
              Save key
            </button>
          </div>

          <p
            className="font-serif text-[13.5px] text-ink-soft italic"
            style={{ lineHeight: 1.6 }}
          >
            Get a free key at{" "}
            <span className="numeric not-italic">openrouter.ai/keys</span>. Pick
            any of the curated free models below — all are zero-cost on
            OpenRouter.
          </p>
        </div>
      </Section>

      <Section
        index={5}
        title="Polish model"
        subtitle="Pick a free OpenRouter model — all are zero-cost. Curated from openrouter.ai/collections/free-models."
      >
        <div className="flex items-start justify-between gap-6 py-2">
          <p
            className="display-tight text-[16px] text-ink pt-3"
            style={{ letterSpacing: "-0.018em" }}
          >
            Active OpenRouter model
          </p>
          <ModelDropdown
            value={s.openrouter_model}
            onChange={(id) => update({ openrouter_model: id })}
            disabled={saving}
          />
        </div>

        <div className="mt-2 pt-5 border-t border-rule-soft flex items-start justify-between gap-6">
          <div>
            <p
              className="display-tight text-[15px] text-ink"
              style={{ letterSpacing: "-0.018em" }}
            >
              Custom model ID
            </p>
            <p
              className="mt-1 font-serif text-[13.5px] text-ink-soft italic"
              style={{ lineHeight: 1.55 }}
            >
              Override with any OpenRouter model ID (paid models work too if
              your key has credits).
            </p>
          </div>
          <input
            value={s.openrouter_model}
            onChange={(e) => setS({ ...s, openrouter_model: e.target.value })}
            onBlur={() => update({ openrouter_model: s.openrouter_model })}
            className="numeric text-[12px] text-ink bg-paper-deep px-3 py-2 rounded border border-rule-soft min-w-[280px] outline-none focus:border-rule text-right shrink-0"
            placeholder="provider/model-id:free"
            style={{ letterSpacing: "0.04em" }}
          />
        </div>
      </Section>

      <Section
        index={6}
        title="Hotkeys"
        subtitle="Activation-mode changes apply live — no daemon restart needed."
      >
        <HotkeyDiagnostics
          diagnostics={diagnostics}
          onRefresh={refreshDiagnostics}
          disabled={saving}
        />
        <ModeRow
          label="Activation"
          options={[
            { value: "toggle", label: "Toggle" },
            { value: "hold", label: "Hold-to-talk" },
          ]}
          value={s.hotkey_mode}
          onChange={(v) => update({ hotkey_mode: v as "toggle" | "hold" })}
          disabled={saving}
        />
        {s.hotkey_mode === "toggle" ? (
          <>
            <SelectRow
              label="Notes mode"
              options={withoutSelected(
                TOGGLE_NOTES_OPTIONS,
                s.hotkey_paste,
                s.hotkey_notes,
              )}
              value={s.hotkey_notes}
              onChange={(v) => update({ hotkey_notes: v })}
              disabled={saving}
            />
            <SelectRow
              label="Paste mode"
              options={withoutSelected(
                TOGGLE_PASTE_OPTIONS,
                s.hotkey_notes,
                s.hotkey_paste,
              )}
              value={s.hotkey_paste}
              onChange={(v) => update({ hotkey_paste: v })}
              disabled={saving}
            />
          </>
        ) : (
          <>
            <SelectRow
              label="Notes mode"
              options={withoutSelected(
                HOLD_NOTES_OPTIONS,
                s.hold_key_paste,
                s.hold_key_notes,
              )}
              value={s.hold_key_notes}
              onChange={(v) => update({ hold_key_notes: v })}
              disabled={saving}
            />
            <SelectRow
              label="Paste mode"
              options={withoutSelected(
                HOLD_PASTE_OPTIONS,
                s.hold_key_notes,
                s.hold_key_paste,
              )}
              value={s.hold_key_paste}
              onChange={(v) => update({ hold_key_paste: v })}
              disabled={saving}
            />
            <Help>
              Press and hold the key to record. Release to stop and transcribe.
              Ctrl shortcuts are ignored unless you hold Right Ctrl by itself.
            </Help>
          </>
        )}
        <ModeRow
          label="Stop on silence"
          options={[
            { value: "1200", label: "1.2 s" },
            { value: "2500", label: "2.5 s" },
            { value: "4000", label: "4 s" },
            { value: "0", label: "Off" },
          ]}
          value={String(s.auto_stop_ms)}
          onChange={(v) => update({ auto_stop_ms: parseInt(v, 10) })}
          disabled={saving}
        />
        <Toggle
          label="Audio cue"
          help="Play short local sounds for recording start, stop, cancel, and error events. Uses the desktop sound theme when available."
          value={s.audio_feedback_enabled}
          onChange={(v) => update({ audio_feedback_enabled: v })}
          disabled={saving}
        />
        <Toggle
          label="Paste via clipboard"
          help="Paste mode delivers text instantly by copying it and pasting (best for long dictations). Turn off to type it character by character. Falls back to typing if no clipboard tool is installed."
          value={s.paste_use_clipboard}
          onChange={(v) => update({ paste_use_clipboard: v })}
          disabled={saving}
        />
        <Help>
          How long Yawp waits before deciding you've finished a thought.
          Pick a longer window if you pause mid-narration to think.
          <span className="ml-1" style={{ color: "var(--color-ink-quiet)" }}>
            Off
          </span>{" "}
          means recording continues until you stop manually.
        </Help>
        <div className="mt-5 flex justify-end">
          <button
            onClick={() => update(DEFAULT_HOTKEYS, "Hotkeys reset to defaults.")}
            disabled={saving}
            className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
          >
            Reset hotkeys
          </button>
        </div>
      </Section>

      <Section
        index={7}
        title="Markdown export"
        subtitle="Mirror every note as a .md file in a folder you choose. Compatible with Obsidian, Bear, iA Writer."
      >
        <div className="space-y-4">
          <Row label="Folder">
            <input
              value={s.export_path}
              onChange={(e) => setS({ ...s, export_path: e.target.value })}
              onBlur={() => update({ export_path: s.export_path })}
              placeholder="~/Notes/yawp"
              className="numeric text-[12px] text-ink bg-paper-deep px-3 py-2 rounded border border-rule-soft min-w-[280px] outline-none focus:border-rule text-right"
              style={{ letterSpacing: "0.04em" }}
            />
          </Row>
          <Toggle
            label="Auto-export"
            help="Refresh the Markdown folder whenever notes are created, edited, polished, or deleted."
            value={s.auto_export_enabled}
            onChange={(v) => update({ auto_export_enabled: v })}
            disabled={saving || !s.export_path.trim()}
          />
          <div className="flex justify-end">
            <ExportButton path={s.export_path} onToast={onToast} disabled={saving} />
          </div>
        </div>
      </Section>

      <Section
        index={8}
        title="System status"
        subtitle="A compact runtime check for support and troubleshooting."
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-rule-soft pb-5">
          <div>
            <p
              className="display-tight text-[16px] text-ink"
              style={{ letterSpacing: "-0.018em" }}
            >
              Software update
            </p>
            <p
              className="mt-1 font-serif text-[14px] text-ink-soft italic"
              style={{ lineHeight: 1.55 }}
            >
              {appVersion ? `Yawp v${appVersion} — ` : ""}
              {updateInfo.status === "checking"
                ? "checking…"
                : updateInfo.status === "available"
                  ? `version ${updateInfo.latest} is available.`
                  : updateInfo.status === "error"
                    ? "couldn't reach GitHub to check."
                    : "you're up to date."}
            </p>
          </div>
          <button
            onClick={() =>
              updateInfo.status === "available"
                ? void openUrl(RELEASES_URL)
                : void checkUpdate()
            }
            disabled={updateInfo.status === "checking"}
            className="pill-control eyebrow cursor-pointer px-4 transition-colors hover:text-ink disabled:opacity-50"
            style={
              updateInfo.status === "available"
                ? { color: "var(--color-accent)", borderColor: "var(--color-accent)" }
                : undefined
            }
          >
            {updateInfo.status === "available"
              ? "Get the update ↗"
              : updateInfo.status === "checking"
                ? "Checking…"
                : "Check for updates"}
          </button>
        </div>
        <RuntimeDiagnostics
          diagnostics={diagnostics}
          onRefresh={refreshDiagnostics}
          disabled={saving}
        />
      </Section>

      <Section
        index={9}
        title="Storage"
        subtitle="Everything is stored on this machine only."
      >
        <div className="space-y-3 font-serif text-[15px] text-ink-soft italic">
          <p>
            Notes database:{" "}
            <span className="numeric not-italic text-ink-soft">~/.voice/notes.db</span>
          </p>
          <p>
            Audio files:{" "}
            <span className="numeric not-italic text-ink-soft">~/.voice/audio/</span>
          </p>
          <p>
            Settings file:{" "}
            <span className="numeric not-italic text-ink-soft">~/.voice/settings.json</span>
          </p>
        </div>
        <StorageCleanup onToast={onToast} />
      </Section>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-rule-soft pt-6">
        <button
          onClick={() => {
            void openUrl(PROJECT_URL);
          }}
          className="eyebrow cursor-pointer transition-colors hover:text-ink"
        >
          Project website ↗
        </button>
        <span className="eyebrow text-ink-faint">
          Yawp{appVersion ? ` v${appVersion}` : ""} · built by Claude
        </span>
      </footer>
    </div>
  );
}

function LocalAsrModelList({
  selected,
  disabled,
  onSelect,
}: {
  selected: string;
  disabled?: boolean;
  onSelect: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedModel = LOCAL_ASR_MODELS.find((model) => model.id === selected);

  return (
    <div className="my-5 border-y border-rule-soft">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center justify-between gap-4 py-3 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Chevron open={open} />
          <span className="eyebrow text-ink-quiet transition-colors group-hover:text-ink">
            {open ? "Reliable downloadable models" : "Compare downloadable models"}
          </span>
        </span>
        <span className="numeric text-[11px] text-ink-quiet">
          {open
            ? `${LOCAL_ASR_MODELS.length} curated`
            : selectedModel?.label ?? `${LOCAL_ASR_MODELS.length} curated`}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-rule-soft pb-1">
          {LOCAL_ASR_MODELS.map((model) => (
            <LocalAsrModelRow
              key={model.id}
              model={model}
              active={model.id === selected}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 180ms var(--ease-precise)",
        color: "var(--color-ink-quiet)",
      }}
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LocalAsrModelRow({
  model,
  active,
  disabled,
  onSelect,
}: {
  model: LocalAsrModel;
  active: boolean;
  disabled?: boolean;
  onSelect: (modelId: string) => void;
}) {
  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className="display-tight text-[15.5px] text-ink"
              style={{ letterSpacing: "-0.018em" }}
            >
              {model.label}
            </p>
            <span
              className="eyebrow px-2 py-0.5"
              style={{
                border: "1px solid var(--color-rule-soft)",
                borderRadius: 999,
                color: "var(--color-ink-quiet)",
              }}
            >
              {model.badge}
            </span>
          </div>
          <p
            className="mt-1 font-serif text-[13.5px] text-ink-soft italic"
            style={{ lineHeight: 1.55 }}
          >
            {model.recommendedFor}
          </p>
        </div>
        <button
          onClick={() => onSelect(model.id)}
          disabled={disabled || active}
          className="eyebrow shrink-0 cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
          style={active ? { color: "var(--color-accent)" } : undefined}
        >
          {active ? "Selected" : "Use"}
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 md:grid-cols-4">
        <ModelFact label="Download" value={model.download} />
        <ModelFact label="Size" value={model.disk} />
        <ModelFact label="Speed" value={model.speed} />
        <ModelFact label="Quality" value={model.quality} />
        <ModelFact label="Backend" value={model.backend} />
        <ModelFact label="Language" value={model.languages} />
        <ModelFact label="Memory" value={model.memory} />
        <ModelFact label="Source" value={model.source} />
      </dl>
      <p
        className="mt-3 font-serif text-[13px] text-ink-quiet"
        style={{ lineHeight: 1.55 }}
      >
        {model.notes}
        <a
          href={model.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-2 numeric text-[11px] not-italic hover:text-ink"
          style={{ letterSpacing: "0.02em" }}
        >
          Source
        </a>
      </p>
    </div>
  );
}

function ModelFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow text-ink-quiet">{label}</dt>
      <dd className="mt-0.5 font-serif text-[13px] text-ink-soft truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

function MicrophoneRow({
  value,
  devices,
  disabled,
  onChange,
  onRefresh,
}: {
  value: number | null;
  devices: AudioInputDevice[];
  disabled?: boolean;
  onChange: (value: number | null) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-rule-soft last:border-b-0">
      <div>
        <p className="display-tight text-[16px] text-ink" style={{ letterSpacing: "-0.018em" }}>
          Microphone
        </p>
        <button
          onClick={onRefresh}
          disabled={disabled}
          className="eyebrow mt-1 cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
        >
          Refresh devices
        </button>
      </div>
      <select
        value={value === null ? "default" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "default" ? null : Number(e.target.value))
        }
        disabled={disabled || devices.length === 0}
        className="numeric text-[12px] text-ink bg-paper-deep px-3 py-2 rounded border border-rule-soft min-w-[260px] max-w-[360px] outline-none focus:border-rule text-right disabled:opacity-60"
        style={{ letterSpacing: "0.02em" }}
      >
        <option value="default">System default</option>
        {devices.map((device) => (
          <option key={device.index} value={device.index}>
            {device.name}
            {device.isDefault ? " · default" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function RuntimeDiagnostics({
  diagnostics,
  onRefresh,
  disabled,
}: {
  diagnostics: Diagnostics | null;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const missingImports = diagnostics
    ? Object.entries(diagnostics.imports)
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
    : [];
  const mic = diagnostics?.microphone;
  const db = diagnostics?.database;
  const model = diagnostics?.model;
  const modelStatus = model
    ? model.restart_required
      ? `${model.configured} · restart sidecar`
      : `${model.configured} · ${model.loaded ? "loaded" : "warming"}`
    : "unknown";

  return (
    <div className="surface px-5 py-4" style={{ borderRadius: 4 }}>
      <div className="grid gap-3 md:grid-cols-2">
        <DiagnosticLine
          label="Sidecar"
          ok={Boolean(diagnostics)}
          value={diagnostics ? `${diagnostics.host}:${diagnostics.port}` : "unreachable"}
        />
        <DiagnosticLine
          label="Database"
          ok={db?.ready === true}
          value={
            db?.ready
              ? `${db.notes_count ?? 0} note${db.notes_count === 1 ? "" : "s"}`
              : db?.error || "unknown"
          }
        />
        <DiagnosticLine
          label="Microphone"
          ok={mic?.available === true}
          value={mic?.available ? mic.name || "available" : mic?.error || "unknown"}
        />
        <DiagnosticLine
          label="Model"
          ok={Boolean(model) && !model?.restart_required && !model?.error}
          value={model?.error || modelStatus}
        />
        <DiagnosticLine
          label="OpenRouter"
          ok={diagnostics?.settings.openrouter_configured === true}
          value={
            diagnostics?.settings.openrouter_configured
              ? "configured"
              : "not configured"
          }
        />
        <DiagnosticLine
          label="Runtime imports"
          ok={missingImports.length === 0}
          value={
            !diagnostics
              ? "unknown"
              : missingImports.length === 0
                ? "complete"
                : missingImports.join(", ")
          }
        />
      </div>
      <div className="mt-5 flex items-center justify-between gap-4 border-t border-rule-soft pt-4">
        <code
          className="numeric text-[11.5px] text-ink-quiet"
          style={{ letterSpacing: "0.02em" }}
        >
          ./scripts/doctor
        </code>
        <button
          onClick={onRefresh}
          disabled={disabled}
          className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

function DiagnosticLine({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow text-ink-quiet">{label}</p>
      <div className="mt-1 flex items-baseline gap-2 min-w-0">
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ok ? "var(--color-accent)" : "var(--color-ink-faint)",
            flex: "0 0 auto",
          }}
        />
        <p
          className="font-serif text-[14.5px] text-ink-soft truncate"
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function isHotkeyPatch(patch: Parameters<typeof api.updateSettings>[0]): boolean {
  return [
    "hotkey_mode",
    "hotkey_notes",
    "hotkey_paste",
    "hold_key_notes",
    "hold_key_paste",
    "auto_stop_ms",
    "audio_feedback_enabled",
  ].some((key) => key in patch);
}

function HotkeyDiagnostics({
  diagnostics,
  onRefresh,
  disabled,
}: {
  diagnostics: Diagnostics | null;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const daemon = diagnostics?.daemon;
  const paste = diagnostics?.paste;
  const status = daemon
    ? daemon.running
      ? daemon.status
      : daemon.status || "not-running"
    : "unknown";
  const pasteStatus = paste
    ? paste.ready
      ? `${paste.selected_tool} on ${paste.session}`
      : `missing paste tool on ${paste.session}`
    : "unknown";
  const audioCue = diagnostics
    ? diagnostics.settings.audio_feedback_enabled
      ? diagnostics.daemon.detail?.audio_feedback_enabled === false
        ? "saved · reload pending"
        : "on"
      : "off"
    : "unknown";
  const loadedMode = daemon?.detail?.hotkey_mode;
  const loadedBindings = daemon?.detail?.bindings;
  const bindingSummary =
    loadedMode === "hold"
      ? `notes ${loadedBindings?.hold_key_notes ?? "unknown"} · paste ${
          loadedBindings?.hold_key_paste ?? "unknown"
        }`
      : loadedMode === "toggle"
        ? `notes ${loadedBindings?.hotkey_notes ?? "unknown"} · paste ${
            loadedBindings?.hotkey_paste ?? "unknown"
          }`
        : "unknown";

  return (
    <div className="mb-4 border-b border-rule-soft pb-4">
      <Row label="Daemon">
        <StatusText ok={daemon?.running === true}>{status}</StatusText>
      </Row>
      <Row label="Loaded mode">
        <StatusText ok={daemon?.running === true}>
          {loadedMode ? `${loadedMode} · ${bindingSummary}` : "unknown"}
        </StatusText>
      </Row>
      <Row label="Paste tool">
        <StatusText ok={paste?.ready === true}>{pasteStatus}</StatusText>
      </Row>
      <Row label="Audio cue">
        <StatusText ok={diagnostics?.settings.audio_feedback_enabled === true}>
          {audioCue}
        </StatusText>
      </Row>
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          disabled={disabled}
          className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
        >
          Refresh status
        </button>
      </div>
    </div>
  );
}

function StatusText({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className="numeric text-[12px]"
      style={{ color: ok ? "var(--color-accent)" : "var(--color-ink-quiet)" }}
    >
      {children}
    </span>
  );
}

function ExportButton({
  path,
  onToast,
  disabled,
}: {
  path: string;
  onToast: (msg: string) => void;
  disabled?: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const run = async () => {
    if (!path.trim()) {
      onToast("Set an export folder first.");
      return;
    }
    setExporting(true);
    try {
      const r = await api.exportMarkdown(path);
      onToast(`Exported ${r.count} note${r.count === 1 ? "" : "s"} to ${r.dest}.`);
    } catch (e) {
      console.error(e);
      onToast(userMessage(e, "Export failed."));
    } finally {
      setExporting(false);
    }
  };
  return (
    <button
      onClick={run}
      disabled={exporting || disabled || !path.trim()}
      className="font-serif text-[14px] cursor-pointer transition-colors disabled:opacity-50"
      style={{ color: "var(--color-accent)" }}
    >
      {exporting ? "Exporting…" : "Export now"}
    </button>
  );
}

function CategorizationPrompt({
  value,
  onSave,
  onReorganize,
  disabled,
}: {
  value: string;
  onSave: (text: string) => void;
  onReorganize: () => Promise<void>;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [reorganizing, setReorganizing] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const run = async () => {
    setReorganizing(true);
    try {
      await onReorganize();
    } finally {
      setReorganizing(false);
    }
  };

  return (
    <div className="py-4 border-b border-rule-soft last:border-b-0">
      <p
        className="display-tight text-[16px] text-ink"
        style={{ letterSpacing: "-0.018em" }}
      >
        Categorization prompt
      </p>
      <p
        className="mt-1 font-serif text-[14px] text-ink-soft italic"
        style={{ lineHeight: 1.55 }}
      >
        Tell the model how to choose folders — e.g. “Group by client name; put
        journal entries in Personal.” Requires an OpenRouter key. Leave blank to
        let Yawp decide.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        placeholder="Group notes by project or client. Keep folder names short."
        rows={3}
        disabled={disabled}
        className="selectable mt-3 w-full resize-none rounded border border-rule-soft bg-paper-deep px-3 py-2 font-serif text-[14px] text-ink outline-none focus:border-rule disabled:opacity-60"
        style={{ lineHeight: 1.55 }}
      />
      <div className="mt-3 flex justify-end">
        <button
          onClick={run}
          disabled={disabled || reorganizing}
          className="eyebrow cursor-pointer transition-colors hover:text-ink disabled:opacity-50"
        >
          {reorganizing ? "Reorganizing…" : "Reorganize existing notes"}
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function StorageCleanup({ onToast }: { onToast: (msg: string) => void }) {
  const [usage, setUsage] = useState<CacheUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setUsage(await api.cacheUsage());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const clear = async (item: CacheItem) => {
    if (
      item.destructive &&
      !window.confirm(
        `Permanently clear ${item.label.toLowerCase()}? This can't be undone.`,
      )
    ) {
      return;
    }
    setBusyId(item.id);
    try {
      const r = await api.clearCache(item.id);
      const freed = r.freed_bytes ? ` · freed ${formatBytes(r.freed_bytes)}` : "";
      onToast(`Cleared ${item.label.toLowerCase()}${freed}.`);
      await load();
    } catch (e) {
      console.error(e);
      onToast(userMessage(e, "Couldn't clear that cache."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-8 border-t border-rule-soft pt-6">
      <div className="flex items-center justify-between gap-4">
        <p className="eyebrow text-ink-quiet">Reclaim disk space</p>
        <button
          onClick={load}
          className="eyebrow cursor-pointer hover:text-ink transition-colors"
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="mt-4 eyebrow text-ink-quiet">Measuring…</p>
      ) : (
        <div className="mt-3 divide-y divide-rule-soft">
          {(usage?.items ?? []).map((item) => {
            const empty = item.bytes === 0 && (item.count ?? 0) === 0;
            return (
              <div
                key={item.id}
                className="flex items-start justify-between gap-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className="display-tight text-[15.5px] text-ink"
                      style={{ letterSpacing: "-0.018em" }}
                    >
                      {item.label}
                    </p>
                    <span className="numeric text-[11px] text-ink-quiet">
                      {formatBytes(item.bytes)}
                      {item.count !== undefined && item.count > 0
                        ? ` · ${item.count}`
                        : ""}
                    </span>
                  </div>
                  <p
                    className="mt-1 font-serif text-[13.5px] text-ink-soft italic"
                    style={{ lineHeight: 1.55 }}
                  >
                    {item.description}
                  </p>
                </div>
                <button
                  onClick={() => clear(item)}
                  disabled={busyId !== null || empty}
                  className="eyebrow shrink-0 cursor-pointer transition-colors hover:text-ink disabled:opacity-40"
                  style={
                    item.destructive && !empty
                      ? { color: "var(--color-accent)" }
                      : undefined
                  }
                >
                  {busyId === item.id ? "Clearing…" : empty ? "Empty" : "Clear"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Section({
  index,
  title,
  subtitle,
  children,
}: {
  index?: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14 first:mt-6 relative">
      {index !== undefined && (
        <span
          className="numeral absolute hidden md:block"
          style={{
            left: -52,
            top: 6,
            fontSize: 14,
            letterSpacing: "0.15em",
          }}
          aria-hidden
        >
          {toRoman(index)}
        </span>
      )}
      <div className="mb-6">
        <h2
          className="display-tight text-[26px] text-ink leading-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            className="mt-1.5 font-serif text-[15px] text-ink-soft italic"
            style={{ lineHeight: 1.6 }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, sym] of map) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

function withoutSelected(
  options: { value: string; label: string }[],
  unavailable: string,
  current: string,
) {
  return options.filter((opt) => opt.value !== unavailable || opt.value === current);
}

function Toggle({
  label,
  help,
  value,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-rule-soft last:border-b-0">
      <div>
        <p className="display-tight text-[16px] text-ink" style={{ letterSpacing: "-0.018em" }}>
          {label}
        </p>
        <p className="mt-1 font-serif text-[14px] text-ink-soft italic" style={{ lineHeight: 1.55 }}>
          {help}
        </p>
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className="shrink-0 cursor-pointer disabled:cursor-default"
        aria-label={`Toggle ${label}`}
        style={{
          width: 36,
          height: 20,
          borderRadius: 999,
          background: value ? "var(--color-accent)" : "var(--color-rule)",
          position: "relative",
          transition: "background 200ms",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: value ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "var(--color-paper)",
            transition: "left 200ms cubic-bezier(0.2, 0.7, 0.2, 1)",
            boxShadow: "0 1px 2px rgba(40,28,18,0.15)",
          }}
        />
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <p className="display-tight text-[15px] text-ink pt-2" style={{ letterSpacing: "-0.018em" }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function SelectRow({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-rule-soft last:border-b-0">
      <p className="display-tight text-[16px] text-ink" style={{ letterSpacing: "-0.018em" }}>
        {label}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="numeric text-[12px] text-ink bg-paper-deep px-3 py-2 rounded border border-rule-soft min-w-[220px] outline-none focus:border-rule text-right disabled:opacity-60"
        style={{ letterSpacing: "0.04em" }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModeRow({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-rule-soft last:border-b-0">
      <p className="display-tight text-[16px] text-ink" style={{ letterSpacing: "-0.018em" }}>
        {label}
      </p>
      <div className="flex items-center gap-1 p-0.5 rounded-full bg-paper-deep">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            className="eyebrow rounded-full px-3 py-1.5 cursor-pointer transition-all disabled:cursor-default"
            style={{
              background:
                opt.value === value ? "var(--color-paper)" : "transparent",
              color:
                opt.value === value
                  ? "var(--color-ink)"
                  : "var(--color-ink-quiet)",
              boxShadow:
                opt.value === value
                  ? "0 1px 2px rgba(40,28,18,0.06)"
                  : "none",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-3 font-serif text-[13.5px] text-ink-soft italic"
      style={{ lineHeight: 1.6 }}
    >
      {children}
    </p>
  );
}
