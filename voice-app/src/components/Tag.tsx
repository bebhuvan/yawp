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
      className="inline-flex items-center gap-1.5 numeric text-[10.5px] py-[3px] px-2 transition-colors"
      style={{
        background: "transparent",
        color: "var(--color-ink-quiet)",
        border: "1px solid var(--color-rule-soft)",
        borderRadius: 2,
        letterSpacing: "0.06em",
        textTransform: "lowercase",
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
          className="cursor-pointer hover:text-accent"
          style={{
            color: "var(--color-ink-faint)",
            lineHeight: 1,
            fontSize: 12,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
