#!/usr/bin/env bash
# install.sh — install Yawp as a real app + autostart sidecar/daemon.
#
# Run once:
#     ./install.sh
#
# After this, Yawp is in your launcher, the sidecar + global hotkey daemon
# start automatically on login, and Ctrl+Alt+V types your speech wherever
# your cursor is.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SIDECAR="$ROOT/sidecar"
APP="$ROOT/voice-app"

step() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- 1. Prereq check ------------------------------------------------------
step "Checking prerequisites"
missing=()
for cmd in cargo node npm python3 sudo systemctl; do
  command -v "$cmd" >/dev/null || missing+=("$cmd")
done
if (( ${#missing[@]} )); then
  fail "Missing: ${missing[*]} — install them, then re-run this script."
fi

# Paste tool — at least one must exist for paste mode to work.
session="${XDG_SESSION_TYPE:-x11}"
if [[ "$session" == "wayland" ]]; then
  command -v wtype >/dev/null || command -v dotool >/dev/null || \
    warn "Wayland session detected but neither wtype nor dotool found. Paste mode will fall back to xdotool (may misbehave). Install: sudo apt install wtype"
else
  command -v xdotool >/dev/null || \
    warn "xdotool not found. Paste mode won't work. Install: sudo apt install xdotool"
fi

# --- 2. Sidecar venv ------------------------------------------------------
if [[ ! -x "$SIDECAR/.venv/bin/python" ]]; then
  step "Creating sidecar Python venv"
  python3 -m venv "$SIDECAR/.venv"
  "$SIDECAR/.venv/bin/pip" install --upgrade pip
  "$SIDECAR/.venv/bin/pip" install -r "$SIDECAR/requirements.txt"
else
  step "Sidecar venv already present (skipping)"
fi

# --- 3. Frontend deps -----------------------------------------------------
if [[ ! -d "$APP/node_modules" ]]; then
  step "Installing frontend deps"
  (cd "$APP" && npm install)
else
  step "Frontend deps already installed (skipping)"
fi

# --- 4. Build + install .deb ----------------------------------------------
step "Building Yawp.deb (first Rust compile takes 3–5 minutes)"
(cd "$APP" && npm run tauri build)

DEB=$(ls -t "$APP/src-tauri/target/release/bundle/deb/"*.deb 2>/dev/null | head -1)
if [[ -z "$DEB" ]]; then
  fail "Build produced no .deb — check the output above."
fi

step "Installing $DEB (sudo)"
sudo dpkg -i "$DEB" || sudo apt-get install -fy

# --- 5. systemd user services --------------------------------------------
step "Writing systemd user units"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

SIDECAR_PY="$SIDECAR/.venv/bin/python"

cat > "$UNIT_DIR/yawp-sidecar.service" <<EOF
[Unit]
Description=Yawp ASR sidecar (FastAPI on :17893)
After=default.target

[Service]
Type=simple
WorkingDirectory=$SIDECAR
ExecStart=$SIDECAR_PY $SIDECAR/run.py
Restart=on-failure
RestartSec=3
# Keep the model loaded across restarts — only one writer per SQLite db.
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/yawp-daemon.service" <<EOF
[Unit]
Description=Yawp global hotkey daemon
After=yawp-sidecar.service
Requires=yawp-sidecar.service
PartOf=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$SIDECAR
# Give the sidecar a moment to bind :17893 before the first hotkey fires.
ExecStartPre=/bin/sleep 2
ExecStart=$SIDECAR_PY $SIDECAR/daemon.py
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical-session.target
EOF

# --- 6. Enable + start ----------------------------------------------------
step "Enabling and starting services"
systemctl --user daemon-reload
systemctl --user enable --now yawp-sidecar.service
systemctl --user enable --now yawp-daemon.service

# --- 7. Verify ------------------------------------------------------------
sleep 2
step "Status"
systemctl --user --no-pager status yawp-sidecar.service | head -6 || true
echo
systemctl --user --no-pager status yawp-daemon.service | head -6 || true

cat <<'EOF'

Done.

  App icon:       search "Yawp" in your launcher
  Dictate notes:  Ctrl + Alt + N   (saves to library)
  Dictate paste:  Ctrl + Alt + V   (types at your cursor)
  Logs:           journalctl --user -u yawp-sidecar -f
                  journalctl --user -u yawp-daemon  -f
  Stop / start:   systemctl --user {stop,start,restart} yawp-{sidecar,daemon}

First Ctrl+Alt+V will trigger a ~150 MB model download (one-time).
EOF
