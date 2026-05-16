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

  useEffect(() => {
    if (state !== "recording") return;
    setElapsed(0);
    const start = performance.now();
    const id = setInterval(() => {
      setElapsed((performance.now() - start) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [state]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-30 flex flex-col items-center pointer-events-none"
      style={{ paddingTop: 22 }}
    >
      <div
        className="pointer-events-auto flex items-center gap-5 px-6 py-3.5"
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-rule)",
          borderRadius: 999,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.6) inset, 0 8px 28px -10px rgba(40,28,18,0.18), 0 2px 6px -2px rgba(40,28,18,0.08)",
          /* Lock width so the pill doesn't pulse as label text changes
             between "Listening" / "Transcribing" / "Ready". */
          minWidth: 620,
        }}
      >
        <div
          className="flex items-center gap-2.5 shrink-0"
          style={{ minWidth: 110 }}
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

        <span className="h-4 w-px bg-rule" aria-hidden />
        <Waveform active={state === "recording"} bars={26} level={level} />
        <MicLevel level={level} active={state === "recording"} />
        <span className="h-4 w-px bg-rule" aria-hidden />
        <span className="numeric text-[13px] text-ink-soft tracking-wider">
          {formatDuration(elapsed)}
        </span>
        <span className="h-4 w-px bg-rule" aria-hidden />

        <div className="flex items-center gap-1 p-0.5 rounded-full bg-paper-deep">
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

        <span className="h-4 w-px bg-rule" aria-hidden />

        <button
          onClick={onCancel}
          className="eyebrow cursor-pointer hover:text-ink transition-colors"
          aria-label="Cancel recording"
        >
          Cancel
        </button>
        <button
          onClick={onStop}
          className="font-serif text-[14px] cursor-pointer transition-colors"
          style={{ color: "var(--color-accent)" }}
        >
          {state === "transcribing" ? "…" : "Stop"}
        </button>
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
      {state === "recording" && elapsed > 2 && level < 0.025 && (
        <div
          className="pointer-events-auto mt-3 px-4 py-2 item-in"
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-rule-soft)",
            borderRadius: 999,
            boxShadow: "0 6px 18px -12px rgba(40,28,18,0.2)",
          }}
        >
          <span className="eyebrow text-ink-quiet">
            mic level is very low
          </span>
        </div>
      )}
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
