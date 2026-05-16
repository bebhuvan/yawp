import { useEffect } from "react";

export function Toast({
  message,
  onDismiss,
  duration = 4000,
}: {
  message: string | null;
  onDismiss: () => void;
  duration?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [message, onDismiss, duration]);

  if (!message) return null;

  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 pointer-events-auto item-in"
      role="status"
      aria-live="polite"
    >
      <div
        className="flex items-center gap-3 px-5 py-3"
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-rule)",
          borderRadius: 8,
          boxShadow:
            "0 8px 28px -10px rgba(40,28,18,0.22), 0 2px 6px -2px rgba(40,28,18,0.08)",
        }}
      >
        <span
          className="font-serif text-[14px] italic"
          style={{ color: "var(--color-ink)" }}
        >
          {message}
        </span>
        <button
          onClick={onDismiss}
          className="eyebrow cursor-pointer hover:text-ink transition-colors"
          aria-label="Dismiss"
        >
          dismiss
        </button>
      </div>
    </div>
  );
}
