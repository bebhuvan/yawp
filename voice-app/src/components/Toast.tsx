import { useEffect } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  text: string;
  action?: ToastAction;
  duration?: number;
}

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const ms = toast.duration ?? (toast.action ? 6000 : 4000);
    const t = setTimeout(onDismiss, ms);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      className="fixed bottom-10 left-1/2 z-40 toast-in"
      style={{ transform: "translateX(-50%)" }}
      role="status"
      aria-live="polite"
    >
      <div
        className="flex items-center gap-6 px-5 py-3"
        style={{
          background: "var(--color-paper)",
          borderTop: "1px solid var(--color-rule-soft)",
          borderBottom: "1px solid var(--color-rule)",
          borderLeft: "1px solid var(--color-rule-soft)",
          borderRight: "1px solid var(--color-rule-soft)",
          borderRadius: 4,
          boxShadow:
            "0 16px 40px -22px rgba(40,28,18,0.30), 0 2px 6px -2px rgba(40,28,18,0.06)",
          minWidth: 260,
        }}
      >
        <span
          className="font-serif text-[14.5px]"
          style={{ color: "var(--color-ink)", letterSpacing: "-0.005em" }}
        >
          {toast.text}
        </span>

        {toast.action ? (
          <button
            onClick={() => {
              toast.action?.onClick();
              onDismiss();
            }}
            className="font-serif text-[13.5px] text-ink cursor-pointer transition-opacity hover:opacity-70"
            style={{
              fontWeight: 500,
              letterSpacing: "-0.005em",
            }}
          >
            {toast.action.label}
          </button>
        ) : (
          <button
            onClick={onDismiss}
            className="eyebrow cursor-pointer hover:text-ink transition-colors"
            aria-label="Dismiss"
          >
            dismiss
          </button>
        )}
      </div>
    </div>
  );
}
