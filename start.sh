#!/usr/bin/env bash
# Start the Voice app in dev mode.
#
# Always launches:
#   - The Python ASR sidecar (FastAPI on :17893)
#   - The Vite dev server (:1420)
#
# Optional flags:
#   --daemon   also launch the global hotkey daemon
#   --tauri    also launch the Tauri desktop window (compiles Rust the first time)
#
# Examples:
#   ./start.sh                       # web preview at http://localhost:1420
#   ./start.sh --daemon              # + global hotkeys (Ctrl+Alt+N / Ctrl+Alt+V)
#   ./start.sh --daemon --tauri      # everything

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SIDECAR="$ROOT/sidecar"
APP="$ROOT/voice-app"

WANT_DAEMON=0
WANT_TAURI=0
for arg in "$@"; do
  case "$arg" in
    --daemon) WANT_DAEMON=1 ;;
    --tauri)  WANT_TAURI=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "→ starting Python sidecar on :17893"
(
  cd "$SIDECAR"
  ./.venv/bin/python run.py
) &
PIDS+=("$!")

echo "→ starting Vite dev server on :1420"
(
  cd "$APP"
  npm run dev
) &
PIDS+=("$!")

if (( WANT_DAEMON )); then
  echo "→ starting global hotkey daemon"
  (
    sleep 2  # give the sidecar a moment to bind :17893
    cd "$SIDECAR"
    ./.venv/bin/python daemon.py
  ) &
  PIDS+=("$!")
fi

if (( WANT_TAURI )); then
  echo "→ launching Tauri window (first build compiles Rust — be patient)"
  (
    cd "$APP"
    npm run tauri dev
  ) &
  PIDS+=("$!")
fi

echo ""
echo "Voice is starting up."
echo "  · Web preview:    http://localhost:1420"
echo "  · Sidecar API:    http://127.0.0.1:17893/health"
if (( WANT_DAEMON )); then
  echo "  · Hotkey notes:   Ctrl+Alt+N"
  echo "  · Hotkey paste:   Ctrl+Alt+V"
fi
echo ""
echo "On the first transcription, the model (~1.5 GB) will download."
echo "Press Ctrl+C to stop everything."
echo ""

wait
