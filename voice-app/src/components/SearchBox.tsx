import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

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
      className="search-rail flex items-center gap-2 px-2.5 py-1.5 text-action cursor-text"
      style={{
        opacity: showActive ? 1 : 0.74,
        width: 220,
        boxSizing: "border-box",
      }}
    >
      <Search
        size={13}
        strokeWidth={1.7}
        color={showActive ? "var(--color-ink-soft)" : "var(--color-ink-faint)"}
        aria-hidden
      />
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
        className="font-serif text-[14px] italic bg-transparent outline-none flex-1 min-w-0 placeholder:text-ink-faint"
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
          className="text-action grid place-items-center cursor-pointer hover:text-ink"
          style={{ color: "var(--color-ink-quiet)" }}
        >
          <X size={13} strokeWidth={1.8} aria-hidden />
        </button>
      )}
    </div>
  );
}
