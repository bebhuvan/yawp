# Changelog

All notable changes to Yawp are documented here. Dates are absolute.

## [0.2.2] — 2026-05-31

### Fixed
- **Linux WebKit blank window after opening Settings or switching views.** Local installs now use the system-linked Tauri binary instead of the AppImage runtime that could leave WebKit helper processes without a live web process on this machine.
- **Settings no longer performs an in-webview GitHub release fetch.** The update area now shows the installed version and opens releases externally, avoiding another WebKit-triggered blank-window path.

### Changed
- **Local reinstall is much faster.** `./install.sh` now builds frontend assets plus the release binary and skips deb/rpm/AppImage packaging. Use `scripts/release-check` for distributable bundles.
- **Release assets prioritize the `.deb` installer.** The AppImage is not published for this release while the WebKit/GStreamer bundle path needs more hardening.

## [0.2.1] — 2026-05-29

### Fixed
- **Tray showed the old "voice app" name and a default gear icon.** The bundled
  binary was still named `voice-app` (the original project folder), so the
  window's `WM_CLASS` was `voice-app` even though the title said "Yawp". On
  GNOME the tray/StatusNotifier resolves an indicator's name and icon from that
  class, so it displayed "voice app" + the fallback gear (no `voice-app` icon
  exists). Setting `mainBinaryName: "yawp"` makes the binary — and therefore
  `WM_CLASS`, the generated desktop entry's `Exec`/`Icon`/`StartupWMClass` — all
  `yawp`, which matches the installed `yawp` icon.
- **Window staying fully black after the display sleeps / the app sits idle.**
  The repaint nudge used `queue_draw()`, which only re-blits WebKit's existing
  backing buffer — when that buffer was discarded on occlusion it just re-showed
  the stale black surface. It now also calls `queue_resize()` on the webview,
  forcing a real size-allocate so WebKit re-renders from scratch. This does not
  resize the OS window, so it avoids the hangs an actual window-resize toggle
  caused.

### Changed
- **Force the X11 backend (`GDK_BACKEND=x11`).** The GTK/WebKit Wayland backend
  crashes under Tauri ([tauri#8541](https://github.com/tauri-apps/tauri/issues/8541));
  pinning X11/XWayland everywhere (set in the app and in the installed `.desktop`
  `Exec`) avoids it. Mirrors what the sibling [Handy](https://github.com/cjpais/Handy)
  app does.

## [0.2.0] — 2026-05-28

### Fixed
- **Window black/blank screen + launch flicker (Linux/WebKitGTK).** The window
  now starts hidden and is revealed only after the frontend paints its first
  frame (`app-ready` event), eliminating the pre-paint flash. Accelerated
  compositing and the DMA-BUF renderer are disabled
  (`WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`)
  while keeping hardware GL, which routes WebKitGTK through the non-composited
  paint path that doesn't leave a blank/stale surface after the window is
  occluded — the root cause of the window going blank on focus switches.
- **Polish dumped model "thinking" into notes.** Reasoning models (e.g. the
  default `openai/gpt-oss-20b:free`) returned chain-of-thought in a separate
  channel; the code surfaced it as the result. OpenRouter requests now exclude
  reasoning, never fall back to the `reasoning` field, and reserve more tokens
  so the answer isn't starved.
- **Mouse text selection** of a note's transcript (the global `user-select:
  none` previously blocked all selection).
- **VAD auto-stop race** in the daemon: `state.auto_stop` is bound to a local
  before `feed()` so it can't be nulled mid-check on another thread.

### Added
- **Update notifications.** Settings checks the GitHub Releases API and, when a
  newer version exists, shows a prominent (but dismissible) banner at the top of
  Settings with a "View release" link; otherwise a quiet version/"up to date"
  status with a manual "Check" in the Settings footer. No background calls — the
  check runs when Settings opens or on demand.
- **Bulk delete:** multi-select notes in the Library with a single batched
  undo (`/notes/bulk-delete`, `/notes/bulk-restore`).
- **Trash view:** browse, restore, or permanently empty deleted notes
  (`/notes/trash`, `/notes/{id}/purge`, `/notes/empty-trash`).
- **Ask your notes:** ask a question and get an answer grounded in your own
  notes, with citations (`/ask`). Retrieval uses the existing full-text search;
  synthesis uses your OpenRouter model (no new dependencies or vector store).
- **Cache cleanup panel** in Settings: live disk usage for downloaded models,
  the LanguageTool ruleset, orphaned audio, and trash, each with a Clear button
  (`/cache`, `/cache/clear`).
- **Auto-categorization controls:** an editable categorization prompt and a
  "Reorganize existing notes" action (`/notes/reorganize`).
- **Open-note view** now has audio playback, grammar check, tag editing, and
  an action-items panel (previously only present in an unused component).
- **Click-to-seek transcript:** clicking a line plays the audio from roughly
  that point (proportional, since per-segment timestamps aren't persisted).
- **Settings:** the long ASR model list is now a collapsible disclosure.

### Performance
- **Clipboard paste for dictation.** Paste mode now delivers text by setting the
  clipboard and sending the paste shortcut (terminal-aware: Ctrl+Shift+V in
  terminals, Ctrl+V elsewhere) instead of typing it character-by-character — so
  a long dictation appears instantly instead of crawling out, especially in
  editors like Zed and terminal apps. Restores the prior clipboard afterward,
  and falls back to typing when no clipboard tool (`xclip` / `wl-copy`) is
  present. Toggle in Settings → Hotkeys ("Paste via clipboard").

### Removed
- The dead `/stream` live-transcription path: the WebSocket endpoint, the
  `live_transcription_enabled` setting, and its (no-op) Settings toggle. The
  frontend never opened the socket.
- Dead code: the unused `NoteDetail` component, `cn` / `groupByDay` /
  `localAsrModelById` / `sidecarStreamUrl` helpers, and the orphaned `clsx`
  dependency.

### Changed
- **`install.sh` prefers [uv](https://github.com/astral-sh/uv)** for the sidecar
  virtualenv and dependency install when available (much faster for the heavy
  ML deps), falling back to `python3 -m venv` + `pip` otherwise. The resulting
  `.venv/bin/python` layout is unchanged, so the systemd units are untouched.
