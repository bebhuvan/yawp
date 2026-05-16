export function DotIndicator({
  active = false,
  color = "var(--color-accent)",
  size = 7,
}: {
  active?: boolean;
  color?: string;
  size?: number;
}) {
  return (
    <span
      className={active ? "pulse-ink" : ""}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        boxShadow: active
          ? `0 0 0 4px color-mix(in oklab, ${color} 18%, transparent)`
          : "none",
      }}
    />
  );
}
