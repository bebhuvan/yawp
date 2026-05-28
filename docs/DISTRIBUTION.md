# Distribution And Operations

This document covers install, uninstall, runtime operations, release checks,
and support diagnostics.

## Install

The supported installer is:

```bash
./install.sh
```

It performs these actions:

1. Checks for Rust, Node, npm, Python, sudo, and systemd.
2. Warns when required paste tools are missing.
3. Creates or reuses `sidecar/.venv`.
4. Installs sidecar Python dependencies.
5. Installs frontend dependencies.
6. Builds the Tauri app.
7. Installs either the `.deb` or AppImage.
8. Writes user systemd units:
   - `yawp-sidecar.service`
   - `yawp-daemon.service`
9. Enables and starts both services.

## Uninstall

Preview:

```bash
./scripts/uninstall
```

Remove the app and services:

```bash
./scripts/uninstall --yes
```

The uninstall script intentionally keeps user data:

```text
~/.voice/
```

To remove notes, audio, and settings as well:

```bash
rm -rf ~/.voice
```

## Runtime Control

App binary flags:

```bash
Yawp.AppImage --help
Yawp.AppImage --start-hidden
Yawp.AppImage --no-tray
Yawp.AppImage --debug
```

The app itself owns window startup and tray behavior. With the tray enabled,
closing the window hides it and the tray menu exposes show/hide/quit actions.
`--no-tray` disables that behavior; if it is combined with `--start-hidden`,
the app shows the window so the user is not left with an invisible process.
The installed `yawp` CLI controls the sidecar and daemon.

Systemd:

```bash
systemctl --user status yawp-sidecar
systemctl --user status yawp-daemon
systemctl --user restart yawp-sidecar
systemctl --user restart yawp-daemon
systemctl --user stop yawp-daemon
```

Daemon command socket:

```bash
sidecar/.venv/bin/python sidecar/daemon.py --status
sidecar/.venv/bin/python sidecar/daemon.py --status-json
sidecar/.venv/bin/python sidecar/daemon.py --toggle-notes
sidecar/.venv/bin/python sidecar/daemon.py --toggle-paste
sidecar/.venv/bin/python sidecar/daemon.py --cancel
sidecar/.venv/bin/python sidecar/daemon.py --reload-settings
```

Installed CLI wrapper:

```bash
yawp status
yawp status-json
yawp doctor
yawp toggle-notes
yawp toggle-paste
yawp cancel
yawp reload
yawp restart
yawp logs
yawp debug-bundle
```

Diagnostics:

```bash
./scripts/doctor
```

Logs:

```bash
journalctl --user -u yawp-sidecar -f
journalctl --user -u yawp-daemon -f
```

## Linux Paste Tools

Yawp uses external tools to type text into arbitrary apps.

| Session | Preferred tool | Notes |
|---|---|---|
| X11 | `xdotool` | Best supported on X11. |
| Wayland | `wtype` | Preferred where compositor permits it. |
| Wayland/Both | `dotool` | May require `input` group membership. |

Install examples:

```bash
sudo apt install xdotool
sudo apt install wtype
sudo apt install dotool
```

## Release Gate

Before shipping:

```bash
./scripts/check
```

This runs:

- backend tests through the sidecar virtualenv;
- frontend unit tests;
- frontend Playwright smoke tests;
- frontend production build;
- Tauri Rust compile check.

Do not use plain system `pytest` as a release signal. It can skip route tests
when system Python lacks sidecar dependencies.

## Manual Release Smoke Test

Run this on each supported Linux target:

1. Fresh install.
2. Launch app from desktop.
3. Confirm `./scripts/doctor` reports sidecar, DB, paste tool, and daemon.
4. Record to note.
5. Record to paste.
6. Search the note and confirm highlighted snippets.
7. Edit the note.
8. Polish without OpenRouter key and review/apply the preview.
9. Configure OpenRouter and run the Settings test.
10. Delete and restore a note.
11. Export Markdown.
12. Restart sidecar and daemon.
13. Uninstall with `./scripts/uninstall --yes`.

## Support Bundle

For user support, ask for:

```bash
./scripts/debug-bundle
./scripts/doctor
journalctl --user -u yawp-sidecar --since "20 minutes ago"
journalctl --user -u yawp-daemon --since "20 minutes ago"
```

Users should redact paths or model/provider details if they consider them
private. The OpenRouter API key is never returned by `/settings` or
`/diagnostics`.
