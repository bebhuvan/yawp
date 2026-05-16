import { useEffect, useRef } from "react";

export function SearchBox({
  value,
  onChange,
  active,
  onActivate,
  onDeactivate,
}: {
  value: string;
  onChange: (v: string) => void;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);

  // Always render the input at the same width to prevent the top-bar from
  // shifting when the user starts typing. The input is invisible-but-present
  // when inactive; clicking the field activates it.
  const showActive = active || value.length > 0;

  return (
    <div
      onClick={() => {
        if (!showActive) onActivate();
      }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors cursor-text"
      style={{
        background: showActive
          ? "var(--color-paper-deep)"
          : "transparent",
        border: showActive
          ? "1px solid var(--color-rule-soft)"
          : "1px solid transparent",
        width: 220,
        boxSizing: "border-box",
      }}
    >
      <SearchIcon dim={!showActive} />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onActivate}
        onBlur={() => {
          if (!value) onDeactivate();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            onDeactivate();
            ref.current?.blur();
          }
        }}
        placeholder="search"
        className="font-serif text-[14px] italic bg-transparent outline-none flex-1 min-w-0"
        style={{
          color: "var(--color-ink)",
        }}
      />
      {value && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
          }}
          aria-label="Clear"
          className="eyebrow cursor-pointer hover:text-ink"
          style={{ color: "var(--color-ink-quiet)" }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function SearchIcon({ dim }: { dim?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <circle
        cx="5"
        cy="5"
        r="3.5"
        stroke={dim ? "var(--color-ink-faint)" : "currentColor"}
        strokeWidth="1.2"
      />
      <path
        d="M7.5 7.5L10 10"
        stroke={dim ? "var(--color-ink-faint)" : "currentColor"}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
