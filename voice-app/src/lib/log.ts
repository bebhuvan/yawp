// Structured frontend logger. Outputs to console with:
//   HH:MM:SS.ms  LEVEL  module  message
// Each logger is namespaced so it's easy to filter in DevTools (e.g. "Yawp.recorder").
//
// In production you can swap the sink to also POST to /log on the sidecar.

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MIN_LEVEL: Level = "debug";

function ts(): string {
  const d = new Date();
  return (
    d.toTimeString().slice(0, 8) +
    "." +
    d.getMilliseconds().toString().padStart(3, "0")
  );
}

function emit(level: Level, mod: string, args: unknown[]): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;
  const prefix = `${ts()} ${level.toUpperCase().padEnd(5)} ${mod.padEnd(16)}`;
  // Use the native console methods so DevTools' filtering still works.
  const fn: Record<Level, (...a: unknown[]) => void> = {
    debug: console.debug.bind(console),
    info: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  fn[level](prefix, ...args);
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (suffix: string) => Logger;
}

export function makeLogger(mod: string): Logger {
  return {
    debug: (...a) => emit("debug", mod, a),
    info: (...a) => emit("info", mod, a),
    warn: (...a) => emit("warn", mod, a),
    error: (...a) => emit("error", mod, a),
    child: (suffix: string) => makeLogger(`${mod}.${suffix}`),
  };
}

// Banner so users opening DevTools immediately see the logger is active.
emit("info", "Yawp.boot", [
  "frontend logger active — filter DevTools console by 'Yawp.' to scope",
]);
