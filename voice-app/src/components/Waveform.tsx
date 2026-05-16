import { useEffect, useRef, useState } from "react";

export function Waveform({
  active,
  bars = 28,
  className = "",
  level,
}: {
  active: boolean;
  bars?: number;
  className?: string;
  level?: number;
}) {
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: bars }, () => 0.2),
  );
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setLevels((prev) => prev.map(() => 0.15));
      return;
    }
    if (typeof level === "number") {
      setLevels((prev) =>
        prev.map((_, i) => {
          const ripple = Math.sin(i * 0.9 + performance.now() / 120) * 0.18;
          return Math.max(0.12, Math.min(1, level + ripple + 0.12));
        }),
      );
      return;
    }
    let t = 0;
    const tick = () => {
      t += 0.08;
      setLevels((prev) =>
        prev.map((_, i) => {
          // multi-frequency layered noise, gentle envelope
          const a = Math.sin(t * 1.7 + i * 0.45) * 0.45;
          const b = Math.sin(t * 2.6 + i * 0.21) * 0.3;
          const c = Math.sin(t * 4.1 + i * 0.13) * 0.2;
          const noise = (Math.random() - 0.5) * 0.18;
          return Math.max(0.12, Math.min(1, 0.5 + a + b + c + noise));
        }),
      );
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [active, level]);

  return (
    <div
      className={`flex items-center gap-[3px] ${className}`}
      style={{ height: 22 }}
    >
      {levels.map((v, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 2,
            height: `${Math.round(v * 22)}px`,
            background: "var(--color-ink)",
            borderRadius: 1,
            opacity: 0.55 + v * 0.45,
            transition: "height 90ms ease-out",
          }}
        />
      ))}
    </div>
  );
}
