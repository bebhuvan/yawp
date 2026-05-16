import { useEffect, useState } from "react";
import { api, userMessage } from "../lib/api";
import { ModelDropdown } from "./ModelDropdown";
import type { AppSettings } from "../lib/types";

export function Settings({
  onToast,
  onLiveTranscriptionChange,
}: {
  onToast: (msg: string) => void;
  onLiveTranscriptionChange?: (enabled: boolean) => void;
}) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [pasteHotkey] = useState("Ctrl + Alt + V");
  const [notesHotkey] = useState("Ctrl + Alt + N");

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((data) => {
        if (!cancelled) setS(data);
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
      if (typeof patch.live_transcription_enabled === "boolean") {
        onLiveTranscriptionChange?.(patch.live_transcription_enabled);
      }
      if (msg) onToast(msg);
    } catch (e) {
      console.error(e);
      onToast("Couldn't save setting.");
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

  if (!s) {
    return (
      <div className="mx-auto max-w-[700px] px-12 pt-12 eyebrow text-ink-quiet">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="page-in mx-auto max-w-[700px] px-12 pb-32">
      <Section
        title="Transcription"
        subtitle="Local faster-whisper model used by the sidecar. Restart the sidecar after changing this."
      >
        <ModeRow
          label="ASR model"
          options={[
            { value: "base.en", label: "Base" },
            { value: "small.en", label: "Small" },
            { value: "medium.en", label: "Medium" },
            { value: "large-v3-turbo", label: "Turbo" },
          ]}
          value={s.asr_model}
          onChange={(v) =>
            update(
              { asr_model: v },
              "Transcription model saved. Restart the sidecar to use it.",
            )
          }
          disabled={saving}
        />
        <Help>
          Base is the current default on this laptop. Larger models may improve
          accuracy but increase latency.
        </Help>
      </Section>

      <Section title="Transcript cleanup" subtitle="Tier 1 — regex-based polish applied to every new transcript.">
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
        <Toggle
          label="Live transcription"
          help="Show partial transcript text while recording. Turn off to reduce CPU use during long recordings."
          value={s.live_transcription_enabled}
          onChange={(v) => update({ live_transcription_enabled: v })}
          disabled={saving}
        />
      </Section>

      <Section title="Note intelligence" subtitle="Layer extra context onto each new note.">
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
      </Section>

      <Section
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
        title="Hotkeys"
        subtitle="Daemon must be restarted to pick up changes here."
      >
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
            <ReadonlyRow label="Notes mode" value={notesHotkey} />
            <ReadonlyRow label="Paste mode" value={pasteHotkey} />
            <Help>
              Tap a hotkey to start recording. It auto-stops after a stretch
              of silence (~1.2 s), or tap again to stop manually.
            </Help>
          </>
        ) : (
          <>
            <ReadonlyRow label="Notes mode" value="F9 (hold)" />
            <ReadonlyRow label="Paste mode" value="F10 (hold)" />
            <Help>
              Press and hold the key to record. Release to stop and transcribe.
              Override with VOICE_HOLD_KEY_NOTES / VOICE_HOLD_KEY_PASTE
              env vars.
            </Help>
          </>
        )}
      </Section>

      <Section
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
      </Section>
    </div>
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

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14 first:mt-6">
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

function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-rule-soft last:border-b-0">
      <p className="display-tight text-[16px] text-ink" style={{ letterSpacing: "-0.018em" }}>
        {label}
      </p>
      <span className="numeric text-[13px] text-ink-soft" style={{ letterSpacing: "0.04em" }}>
        {value}
      </span>
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
