import { useEffect, useRef, useState } from "react";
import { FREE_MODELS } from "../lib/free-models";

export function ModelDropdown({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = FREE_MODELS.find((m) => m.id === value);
  const label = selected?.name ?? value;
  const customLabel = !selected && value ? value : null;

  return (
    <div ref={ref} className="relative" style={{ minWidth: 340 }}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded border transition-colors cursor-pointer disabled:cursor-default"
        style={{
          background: "var(--color-paper-deep)",
          borderColor: open ? "var(--color-rule)" : "var(--color-rule-soft)",
          textAlign: "left",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div
            className="display-tight text-[15px] text-ink truncate"
            style={{ letterSpacing: "-0.018em" }}
          >
            {customLabel ? "Custom" : label}
          </div>
          <div className="eyebrow numeric mt-0.5 truncate">
            {customLabel ?? value}
          </div>
        </div>
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 180ms",
            flexShrink: 0,
          }}
          aria-hidden
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-2 z-40 item-in"
          style={{
            width: 460,
            maxHeight: 420,
            overflowY: "auto",
            background: "var(--color-paper)",
            border: "1px solid var(--color-rule)",
            borderRadius: 8,
            boxShadow:
              "0 12px 32px -10px rgba(40,28,18,0.18), 0 4px 10px -3px rgba(40,28,18,0.08)",
          }}
        >
          {FREE_MODELS.map((m) => {
            const active = m.id === value;
            return (
              <button
                key={m.id}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className="w-full text-left px-5 py-4 row-hover cursor-pointer border-b border-rule-soft last:border-b-0"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span
                    className="display-tight text-[15px] text-ink"
                    style={{ letterSpacing: "-0.018em" }}
                  >
                    {m.name}
                  </span>
                  {active && (
                    <span
                      className="eyebrow shrink-0"
                      style={{ color: "var(--color-accent)" }}
                    >
                      active
                    </span>
                  )}
                </div>
                <p
                  className="mt-1 font-serif text-[13.5px] text-ink-soft italic"
                  style={{ lineHeight: 1.55 }}
                >
                  {m.description}
                </p>
                <p className="mt-1 eyebrow numeric">{m.id}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
