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
# sudo is intentionally not required here — it's only used for the optional
# .deb install path, which is gated on `command -v sudo` below. Systems with
# large uids (and anyone without sudo) install via the AppImage + --user
# systemd path, which needs no root at all.
for cmd in cargo node npm python3 systemctl; do
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

# Clipboard tool — optional, makes paste mode deliver long dictations instantly
# (instead of typing them out). Paste mode still works without it (it types).
if [[ "$session" == "wayland" ]]; then
  command -v wl-copy >/dev/null || \
    warn "wl-clipboard not found — paste mode will type instead of paste. Install: sudo apt install wl-clipboard"
else
  command -v xclip >/dev/null || \
    warn "xclip not found — paste mode will type long text out slowly. For instant paste: sudo apt install xclip"
fi

# --- 2. Sidecar venv ------------------------------------------------------
# Prefer uv (much faster resolution + install of the heavy ML deps) when it is
# available; otherwise fall back to the stdlib venv + pip. Either path yields
# the same $SIDECAR/.venv/bin/python that the systemd units below point at.
if command -v uv >/dev/null 2>&1; then
  if [[ ! -x "$SIDECAR/.venv/bin/python" ]]; then
    step "Creating sidecar Python venv (uv)"
    uv venv "$SIDECAR/.venv"
  else
    step "Sidecar venv already present"
  fi
  step "Installing sidecar Python requirements (uv)"
  uv pip install --python "$SIDECAR/.venv/bin/python" -r "$SIDECAR/requirements.txt"
else
  if [[ ! -x "$SIDECAR/.venv/bin/python" ]]; then
    step "Creating sidecar Python venv"
    python3 -m venv "$SIDECAR/.venv"
    "$SIDECAR/.venv/bin/pip" install --upgrade pip
  else
    step "Sidecar venv already present"
  fi
  step "Installing sidecar Python requirements"
  "$SIDECAR/.venv/bin/pip" install -r "$SIDECAR/requirements.txt"
fi

# --- 3. Frontend deps -----------------------------------------------------
if [[ ! -d "$APP/node_modules" ]]; then
  step "Installing frontend deps"
  (cd "$APP" && npm install)
else
  step "Frontend deps already installed (skipping)"
fi

# --- 4. Build Tauri bundle -----------------------------------------------
step "Building Yawp (first Rust compile takes 3–5 minutes)"
(cd "$APP" && npm run tauri build)

DEB=$(ls -t "$APP/src-tauri/target/release/bundle/deb/"*.deb 2>/dev/null | head -1)
APPIMAGE=$(ls -t "$APP/src-tauri/target/release/bundle/appimage/"*.AppImage 2>/dev/null | head -1)

# Prefer the .deb when it works, but the .deb format's 6-byte uid/gid fields
# overflow on systems where the user's uid is more than 6 digits (corporate
# LDAP-style ids). Detect that and fall back to the AppImage.
USE_APPIMAGE=0
if [[ -n "$DEB" ]] && command -v sudo >/dev/null && (( $(id -u) <= 999999 )) && (( $(id -g) <= 999999 )); then
  step "Installing $DEB (sudo)"
  if ! sudo dpkg -i "$DEB"; then
    sudo apt-get install -fy || true
    if ! dpkg -s yawp >/dev/null 2>&1; then
      warn ".deb install failed — falling back to AppImage."
      USE_APPIMAGE=1
    fi
  fi
else
  if [[ -z "$DEB" ]]; then
    warn "No .deb produced — using AppImage."
  elif ! command -v sudo >/dev/null; then
    warn "sudo not available — using AppImage (no root needed)."
  else
    warn "Your uid/gid is too large for the .deb format — using AppImage."
  fi
  USE_APPIMAGE=1
fi

if (( USE_APPIMAGE )); then
  if [[ -z "$APPIMAGE" ]]; then
    fail "Build produced no AppImage either — check the output above."
  fi
  step "Installing $APPIMAGE → ~/.local/bin/Yawp.AppImage"
  mkdir -p "$HOME/.local/bin" \
           "$HOME/.local/share/applications" \
           "$HOME/.local/share/icons/hicolor/256x256/apps"
  # Atomic replace via a temp file + rename, so a re-install succeeds even while
  # the current Yawp is running (a plain `cp` over a running AppImage fails with
  # "Text file busy"). The live process keeps its old copy until relaunch.
  cp "$APPIMAGE" "$HOME/.local/bin/Yawp.AppImage.new"
  chmod +x "$HOME/.local/bin/Yawp.AppImage.new"
  mv -f "$HOME/.local/bin/Yawp.AppImage.new" "$HOME/.local/bin/Yawp.AppImage"
  cp "$APP/src-tauri/icons/128x128@2x.png" \
     "$HOME/.local/share/icons/hicolor/256x256/apps/yawp.png"
  cat > "$HOME/.local/share/applications/yawp.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Yawp
Comment=Local-first voice dictation
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 $HOME/.local/bin/Yawp.AppImage %U
Icon=yawp
Terminal=false
Categories=Utility;AudioVideo;
StartupNotify=true
StartupWMClass=Yawp
DESKTOP
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
fi

# Install the operational CLI regardless of bundle type. It points back to this
# checkout, matching the sidecar service units below.
step "Installing yawp CLI → ~/.local/bin/yawp"
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/yawp" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export YAWP_ROOT="$ROOT"
exec "$ROOT/scripts/yawp" "\$@"
EOF
chmod +x "$HOME/.local/bin/yawp"

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
ExecStart="$SIDECAR_PY" "$SIDECAR/run.py"
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
ExecStart="$SIDECAR_PY" "$SIDECAR/daemon.py"
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical-session.target
EOF

# --- 6. Enable + start ----------------------------------------------------
# `enable` sets autostart on login; `restart` (rather than `start`) ensures a
# re-install actually picks up updated sidecar/daemon code instead of leaving
# the previously-running processes in place.
step "Enabling and (re)starting services"
systemctl --user daemon-reload
systemctl --user enable yawp-sidecar.service yawp-daemon.service
systemctl --user restart yawp-sidecar.service
systemctl --user restart yawp-daemon.service

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
