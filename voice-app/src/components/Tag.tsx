export function Tag({
  label,
  onRemove,
  onClick,
}: {
  label: string;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  return (
    <span
      onClick={onClick}
      className="inline-flex items-center gap-1.5 numeric text-[11px] py-0.5 px-2 rounded-full transition-colors cursor-default"
      style={{
        background: "var(--color-paper-deep)",
        color: "var(--color-ink-soft)",
        border: "1px solid var(--color-rule-soft)",
        letterSpacing: "0.04em",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <span>{label}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${label}`}
          className="cursor-pointer hover:text-ink"
          style={{ color: "var(--color-ink-quiet)", lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </span>
  );
}
