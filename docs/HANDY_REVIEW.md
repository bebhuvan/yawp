# Handy Review

Handy was reviewed as a comparable local-first dictation product.

Sources inspected:

- GitHub repository: `https://github.com/cjpais/Handy`
- Local install: `~/.local/opt/handy/Handy.AppImage --help`

## What Handy Does Better

### Release And Distribution

Handy has a more mature release posture:

- GitHub Actions for build, tests, code quality, Playwright, and release.
- AppImage packaging plus Homebrew/winget ecosystem references.
- Clear platform support claims.
- Dedicated build documentation.
- Issue and PR templates.

Yawp should adopt the discipline, not the exact implementation.

### Runtime Control

Handy exposes useful CLI control:

```bash
handy --start-hidden
handy --no-tray
handy --toggle-transcription
handy --toggle-post-process
handy --cancel
handy --debug
```

Yawp already has daemon command-socket control, but the product should expose
equally clear user-facing commands:

```bash
Yawp.AppImage --start-hidden
Yawp.AppImage --no-tray
yawp status
yawp toggle-notes
yawp toggle-paste
yawp cancel
./scripts/doctor
```

### Platform Honesty

Handy is explicit about Wayland limitations, paste tools, overlay focus issues,
and runtime dependencies. This is a strength.

Yawp should be equally explicit:

- X11 paste requires `xdotool`.
- Wayland paste prefers `wtype`, then `dotool`.
- Global hotkeys on Wayland may need desktop-environment shortcuts or daemon
  workarounds.
- WebKitGTK startup/rendering can require Linux-specific environment flags.

### Settings Surface

Handy has many focused setting components:

- microphone selector;
- output device selector;
- audio feedback;
- push-to-talk;
- paste method;
- app language;
- model status/download components;
- update checker;
- permission/onboarding components.

Yawp should not copy the generic settings look, but should adopt the product
coverage:

- daemon status;
- paste tool status;
- microphone status;
- hotkey reset/test;
- OpenRouter test;
- model status;
- diagnostics/doctor export.

## What Yawp Should Not Copy

Yawp should avoid becoming a generic settings dashboard. Handy's UI is practical
but fairly conventional: cards, toggles, dense settings rows, and a broad
control panel shape.

Yawp's better design direction is editorial tooling:

- text-first surfaces;
- hairline rules;
- quiet icon controls;
- marginalia and chapter rhythm;
- no marketing hero sections;
- no decorative gradients;
- no dashboard cards;
- no generic SaaS empty states.

## Ideas Adopted In Yawp

Already implemented in this hardening pass:

- One-command quality gate.
- Diagnostics endpoint and `scripts/doctor`.
- Installed `yawp` CLI for status, doctor, toggle, cancel, reload, restart, and
  logs.
- App flags for `--help`, `--start-hidden`, and `--debug`.
- App `--no-tray` flag plus a native tray menu for show/hide/quit.
- Tauri single-instance support that focuses the existing window on relaunch.
- Debug-bundle CLI for support captures.
- Playwright smoke tests for library/search, Settings diagnostics, and polish
  preview.
- Daemon status and loaded hotkey bindings in Settings.
- Reset hotkeys action.
- Optional local audio cues for recording lifecycle feedback.
- Model diagnostics in Settings/doctor, including loaded/restart-needed state.
- OpenRouter test endpoint and Settings action.
- Safer preview-then-apply flow for AI text mutations.
- Search snippets/highlights.
- Release hardening and architecture docs.
- Wayland shortcut documentation with examples for GNOME, KDE, Sway, and
  Hyprland.
- Uninstall script.

## Ideas Still Worth Implementing

- Model download UI.
