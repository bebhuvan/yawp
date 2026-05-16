import { useEffect, useState } from "react";
import { formatDuration } from "../lib/utils";
import { Waveform } from "./Waveform";
import { DotIndicator } from "./DotIndicator";
import type { RecordingMode } from "../lib/types";

interface RecorderProps {
  open: boolean;
  state: "idle" | "recording" | "transcribing";
  mode: RecordingMode;
  onModeChange: (m: RecordingMode) => void;
  onStop: () => void;
  onCancel: () => void;
  partial: string;
  level: number;
}

// Silence threshold + window are the same heuristics the in-browser recorder
// uses for its "mic level is low" hint. When level stays below SILENCE_LEVEL
// for longer than SILENCE_COUNTDOWN_MS, show a faint countdown so the user
// understands *why* the daemon's auto-stop might be about to fire.
const SILENCE_LEVEL = 0.025;
const SILENCE_COUNTDOWN_MS = 1200;

export function Recorder({
  open,
  state,
  mode,
  onModeChange,
  onStop,
  onCancel,
  partial,
  level,
}: RecorderProps) {
  const [elapsed, setElapsed] = useState(0);
  // Track when silence started so we can show a countdown to auto-stop.
  const [silenceSince, setSilenceSince] = useState<number | null>(null);

  useEffect(() => {
    if (state !== "recording") return;
    setElapsed(0);
    const start = performance.now();
    const id = setInterval(() => {
      setElapsed((performance.now() - start) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (state !== "recording") {
      setSilenceSince(null);
      return;
    }
    // First 1.5s of recording — ignore silence so the countdown doesn't fire
    // before the user even starts speaking.
    if (elapsed < 1.5) {
      setSilenceSince(null);
      return;
    }
    if (level < SILENCE_LEVEL) {
      setSilenceSince((prev) => prev ?? performance.now());
    } else {
      setSilenceSince(null);
    }
  }, [state, level, elapsed]);

  if (!open) return null;

  const silenceMs = silenceSince ? performance.now() - silenceSince : 0;
  const showCountdown =
    state === "recording" && silenceSince !== null && silenceMs > 200;

  return (
    <div
      className="fixed inset-x-0 top-0 z-30 flex flex-col items-center pointer-events-none"
      style={{ paddingTop: 22 }}
    >
      <div
        className="pointer-events-auto flex items-center gap-6 px-6 py-3.5"
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-rule-soft)",
          borderRadius: 999,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.6) inset, 0 10px 32px -14px rgba(40,28,18,0.22), 0 2px 6px -2px rgba(40,28,18,0.06)",
          // Lock width so the pill doesn't pulse as the status label changes.
          minWidth: 600,
        }}
      >
        <div
          className="flex items-center gap-2.5 shrink-0"
          style={{ minWidth: 108 }}
        >
          <DotIndicator
            active={state === "recording"}
            color={
              state === "transcribing"
                ? "var(--color-ink-quiet)"
                : "var(--color-accent)"
            }
            size={8}
          />
          <span
            className="font-serif text-[14px] italic"
            style={{
              color:
                state === "transcribing"
                  ? "var(--color-ink-soft)"
                  : "var(--color-ink)",
            }}
          >
            {state === "recording"
              ? "Listening"
              : state === "transcribing"
                ? "Transcribing"
                : "Ready"}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-1">
          <Waveform active={state === "recording"} bars={28} level={level} />
          <MicLevel level={level} active={state === "recording"} />
        </div>

        <span className="numeric text-[12.5px] tabular-nums shrink-0" style={{ color: "var(--color-ink-quiet)", letterSpacing: "0.04em" }}>
          {formatDuration(elapsed)}
        </span>

        <div className="flex items-center gap-1 p-0.5 rounded-full bg-paper-deep shrink-0">
          <ModeChip
            label="notes"
            active={mode === "notes"}
            onClick={() => onModeChange("notes")}
          />
          <ModeChip
            label="paste"
            active={mode === "paste"}
            onClick={() => onModeChange("paste")}
          />
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <button
            onClick={onCancel}
            className="eyebrow cursor-pointer hover:text-ink transition-colors"
            aria-label="Cancel recording"
          >
            Cancel
          </button>
          <button
            onClick={onStop}
            className="font-serif text-[14px] cursor-pointer transition-colors hover:opacity-80"
            style={{ color: "var(--color-accent)" }}
          >
            {state === "transcribing" ? "…" : "Stop"}
          </button>
        </div>
      </div>

      {partial && (
        <div
          className="pointer-events-auto mt-4 max-w-[680px] px-7 py-4 item-in"
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-rule-soft)",
            borderRadius: 6,
            boxShadow:
              "0 8px 28px -12px rgba(40,28,18,0.14), 0 2px 6px -2px rgba(40,28,18,0.05)",
          }}
        >
          <p
            className="eyebrow mb-2"
            style={{ color: "var(--color-ink-quiet)" }}
          >
            transcribing live
          </p>
          <p
            className="font-serif text-[16px] text-ink"
            style={{ lineHeight: 1.6 }}
          >
            {partial}
            <span
              className="pulse-ink ml-0.5"
              style={{
                display: "inline-block",
                width: 7,
                height: 14,
                background: "var(--color-ink-faint)",
                verticalAlign: "text-bottom",
              }}
            />
          </p>
        </div>
      )}
      {showCountdown && <SilenceCountdown silenceMs={silenceMs} />}
    </div>
  );
}

function SilenceCountdown({ silenceMs }: { silenceMs: number }) {
  const remaining = Math.max(0, SILENCE_COUNTDOWN_MS - silenceMs);
  const seconds = (remaining / 1000).toFixed(1);
  const progress = Math.max(0, Math.min(1, remaining / SILENCE_COUNTDOWN_MS));

  return (
    <div
      className="pointer-events-auto mt-3 px-4 py-2 flex items-center gap-3 item-in"
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-rule-soft)",
        borderRadius: 999,
        boxShadow: "0 6px 18px -12px rgba(40,28,18,0.18)",
        minWidth: 220,
      }}
    >
      <span
        className="eyebrow shrink-0"
        style={{ color: "var(--color-ink-quiet)" }}
      >
        silence — stopping in
      </span>
      <span
        className="numeric tabular-nums text-[11.5px] shrink-0"
        style={{ color: "var(--color-ink-soft)", letterSpacing: "0.04em" }}
      >
        {seconds}s
      </span>
      <div
        className="flex-1 h-[2px] rounded-full overflow-hidden"
        style={{ background: "var(--color-rule-soft)" }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: "var(--color-ink-faint)",
            transition: "width 80ms linear",
          }}
        />
      </div>
    </div>
  );
}

function MicLevel({ level, active }: { level: number; active: boolean }) {
  return (
    <div
      className="h-[18px] w-[46px] overflow-hidden"
      style={{
        border: "1px solid var(--color-rule-soft)",
        borderRadius: 999,
        background: "var(--color-paper-deep)",
      }}
      aria-label="Microphone level"
    >
      <div
        style={{
          width: `${Math.round((active ? level : 0) * 100)}%`,
          height: "100%",
          background: "var(--color-accent)",
          transition: "width 90ms ease-out",
        }}
      />
    </div>
  );
}

function ModeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="eyebrow rounded-full px-2.5 py-1 cursor-pointer transition-all"
      style={{
        background: active ? "var(--color-paper)" : "transparent",
        color: active ? "var(--color-ink)" : "var(--color-ink-quiet)",
        boxShadow: active ? "0 1px 2px rgba(40,28,18,0.06)" : "none",
      }}
    >
      {label}
    </button>
  );
}
