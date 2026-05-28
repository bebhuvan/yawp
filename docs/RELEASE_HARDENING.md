# Release Hardening Plan

This document is the working plan for taking Yawp from a strong local prototype
to software that can be responsibly open sourced or sold as a small paid Linux
desktop utility.

## Release Bar

A release is not ready until all of these are true:

- `./scripts/check` passes on a clean checkout.
- GitHub Actions `Check` passes on pull requests and `main`.
- Install works on a fresh supported Linux distro.
- Uninstall is documented and removes systemd units cleanly.
- Sidecar, daemon, and UI can restart independently.
- The app never corrupts notes or settings during normal failure modes.
- Core dictation works without OpenRouter.
- OpenRouter failures do not block local recording or note saving.
- Hotkey settings are visible, reversible, and diagnosable.
- The docs explain architecture, install, troubleshooting, privacy, data
  storage, known limitations, and contribution workflow.

## Supported Scope

The first production target should be narrow and honest:

- Linux desktop.
- Python sidecar.
- Tauri 2 frontend.
- Local SQLite storage.
- Local ASR by default.
- OpenRouter as optional enhancement.

Before claiming support for a distro/session combination, test it. Good first
targets:

- Ubuntu LTS on X11.
- Ubuntu LTS on Wayland.
- Fedora Workstation on Wayland.

Everything else should be described as best effort until tested.

## Quality Gate

The canonical command is:

```bash
./scripts/check
```

It intentionally uses `sidecar/.venv/bin/python` for backend tests because
route tests require FastAPI and related sidecar dependencies.

It also runs frontend Playwright smoke tests against mocked sidecar responses
so high-traffic UI flows are covered without depending on live local services.

Future additions:

- Fresh-machine installer smoke test.
- Migration fixtures for every published DB version.

Release candidates should additionally run:

```bash
./scripts/release-check
```

That command runs the normal quality gate and then builds the Tauri bundles.

## Hardening Phases

### Phase 1 - Foundation

Status: in progress.

Deliverables:

- One-command quality gate.
- GitHub Actions quality gate.
- Runtime diagnostics endpoint.
- Architecture documentation.
- Release hardening documentation.
- Explicit known limitations.

Success criteria:

- Contributors know which command proves the repo is healthy.
- Support can inspect diagnostics without reading logs first.
- Architecture boundaries are documented.

### Phase 2 - Hotkey And Desktop Reliability

Deliverables:

- Daemon status displayed in Settings.
- Hotkey reset-to-default action.
- Hotkey reload/test status.
- Better daemon command responses with active mode and bindings.
- Paste tool diagnostics visible in the UI.

Success criteria:

- A user can tell whether the daemon is running.
- A user can recover from bad hotkey settings without editing JSON.
- Paste-mode failures explain whether the issue is Wayland/X11 tooling.

### Phase 3 - Transcription Reliability

Deliverables:

- Silence rejection before ASR.
- Audio trim and gain normalization.
- Empty/near-empty transcript behavior tested.
- Recording diagnostics logged and exposed.
- Optional enrichment runs after core save where possible.

Success criteria:

- Silent clips do not waste ASR time or create confusing notes.
- Model latency and recording duration are visible for debugging.
- Tags/todos cannot make core note saving feel broken.

### Phase 4 - OpenRouter Reliability

Deliverables:

- Test API key/model endpoint.
- Retry with bounded backoff for transient provider failures.
- Structured JSON extraction for tags/todos.
- Clear provider error categories.
- Settings UI shows configured, working, failed, or untested provider state.

Success criteria:

- Bad keys, bad models, rate limits, and malformed responses produce clear
  user-facing messages.
- Core local workflows remain usable when OpenRouter is down.

### Phase 5 - Text Mutation Trust

Deliverables:

- Preview/diff for polish.
- Preview/diff for grammar apply.
- Undo path for transcript mutations.
- Clear save states and stale-note errors.

Success criteria:

- User text is never silently transformed without a recoverable path.
- AI-assisted edits feel inspectable rather than destructive.

### Phase 6 - Search And Library UX

Deliverables:

- Search snippets and highlights.
- Folder filters and manual note assignment.
- Optional confidence-gated auto-organization that never overwrites manual
  folder moves.
- Date filters.
- Tests for search ranking, deleted notes, punctuation, tags, and phrase-like
  queries.

Success criteria:

- Search results explain why they matched.
- Smart collections can be promoted into real folders without losing manual
  control.
- Search remains fast and predictable as the library grows.

### Phase 7 - Packaging And Distribution

Deliverables:

- Fresh-machine install test.
- Uninstall instructions/script.
- Systemd unit verification.
- Release checklist.
- Changelog.
- Privacy and security notes.

Success criteria:

- A new user can install, run, diagnose, and uninstall without maintainer help.
- A release can be reproduced from a clean checkout.

## Known Risk Areas

### Linux Desktop Variance

Global hotkeys and paste automation differ across X11, Wayland, compositors,
keyboard layouts, and security settings. This is the highest integration risk.

Mitigation:

- Keep supported environment claims narrow.
- Report daemon and paste tool status clearly.
- Provide a CLI recovery path.
- Keep hotkey defaults conservative.

### Microphone Stack

Audio devices, permissions, sample rates, and PulseAudio/PipeWire behavior vary.

Mitigation:

- Probe microphone availability in diagnostics.
- Fail recording start with actionable messages.
- Add silence and clipping detection.

### AI Provider Instability

Free OpenRouter models can change, rate limit, or return odd shapes.

Mitigation:

- Treat OpenRouter as optional.
- Add provider status tests.
- Validate responses.
- Keep local fallbacks.

### Database Evolution

SQLite migrations must preserve existing user notes.

Mitigation:

- Use append-only `PRAGMA user_version` migrations.
- Add migration tests before releases.
- Keep export simple and documented.

## Contributor Standards

New code should meet these standards:

- Has a clear owner module.
- Uses existing API patterns.
- Includes a focused test when behavior changes.
- Preserves local-first behavior.
- Avoids blocking hot paths on network calls.
- Updates docs when architecture, install, settings, or release behavior changes.

## Pre-Release Checklist

Run this before tagging:

```bash
./scripts/check
```

Then verify manually:

- Fresh install on supported distro.
- Launch app from desktop.
- Start sidecar service.
- Start daemon service.
- Record to note.
- Record to paste.
- Search created note.
- Edit note.
- Polish with no OpenRouter key.
- Configure OpenRouter key and test polish.
- Delete and restore note.
- Export Markdown.
- Restart sidecar and daemon.
- Confirm diagnostics report expected status.
- Uninstall or disable services cleanly.
