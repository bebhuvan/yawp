# Contributing to Yawp

Thanks for reading this. Yawp is a small personal project shared in case it's
useful — there's no big roadmap. That said, contributions are welcome, and
this guide should make them easier to land.

## Before you start

For anything beyond a one-line fix, **please open an issue first** with a
short description of what you'd like to change. It saves both of us from
sinking time into a PR that doesn't fit the project's direction.

Good things to PR without asking:
- Bug fixes with a clear repro.
- Documentation improvements.
- New tests for existing behavior.
- Cross-platform support (macOS / Windows) — the architecture supports it;
  the paste tools and WebKitGTK permission grant are the Linux-specific bits.

Things that need a conversation first:
- New top-level features.
- Schema migrations (we use `PRAGMA user_version` — see `sidecar/app/db.py`).
- UI redesigns. The aesthetic is opinionated and deliberate.
- New runtime dependencies.

## Development setup

```bash
git clone https://github.com/YOUR_USER/yawp.git
cd yawp

# Sidecar (Python)
python3 -m venv sidecar/.venv
sidecar/.venv/bin/pip install -r sidecar/requirements.txt
sidecar/.venv/bin/pip install -r sidecar/requirements-dev.txt

# Frontend (Node)
cd voice-app && npm install && cd ..

# Run everything in dev (sidecar + Vite preview)
./start.sh

# Add --tauri for the native window, --daemon for global hotkeys
./start.sh --tauri --daemon
```

## Running tests

```bash
sidecar/.venv/bin/pytest sidecar/tests
```

Tests are intentionally minimal and fast — no model loads, no network. If
you add a test, keep it under 100ms.

## Code style

- **Python**: `from __future__ import annotations` at the top of every
  module. Type hints. Small functions. Comments explain *why* (especially
  for the non-obvious tradeoffs); they don't explain *what*.
- **TypeScript**: strict mode (already enforced). Single-letter type aliases
  are fine when scoped tightly. Avoid bare any.
- **CSS**: use tokens from `voice-app/src/styles/globals.css`. The palette
  is small on purpose — if you need a color that isn't in the theme, talk
  to me first.
- **Commits**: imperative mood, scope prefix when relevant
  (`db: …`, `ui: …`, `daemon: …`).

## Architecture principles

- **Three independent processes.** UI, sidecar, daemon — each replaceable
  in isolation. Don't introduce shared state between them beyond the
  sidecar's HTTP/SSE/socket API.
- **Local-first.** No outbound network calls outside the explicit
  OpenRouter / Hugging Face hits, which are user-opt-in.
- **Settings are the source of truth.** Read via `settings.get()`; the
  cache invalidates automatically on file change.
- **Background work runs in executors.** The single-worker ASR executor
  is for `model.transcribe` only — network calls go to the default
  executor so they don't queue behind ASR.

## Filing a good issue

Include:
1. Your distro + kernel (`uname -a`)
2. X11 or Wayland (`echo $XDG_SESSION_TYPE`)
3. Yawp version (`git log -1 --oneline`)
4. The last 20 lines of `journalctl --user -u yawp-sidecar` if it's a
   server-side issue, or `journalctl --user -u yawp-daemon` for hotkey
   issues.

## License

By contributing you agree your work is licensed under the project's
[MIT License](LICENSE).
