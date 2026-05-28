# Privacy

Yawp is designed as a local-first dictation app.

## Local Data

By default, Yawp stores data under:

```text
~/.voice/
  notes.db
  audio/
  settings.json
  daemon.sock
```

Stored data can include:

- note titles;
- transcripts;
- tags;
- action items;
- optional per-note audio files;
- app settings.

## Network Access

Core dictation does not require cloud services.

Yawp may use the network when:

- OpenRouter is configured for optional polish, tag, or action-item features;
- a model backend downloads local model files;
- the user or package manager downloads updates or dependencies.

OpenRouter is optional. If no OpenRouter API key is configured, local recording,
transcription, notes, search, editing, and export remain available.

## API Keys

The OpenRouter API key is stored locally in `~/.voice/settings.json`.

The sidecar masks the key in public settings responses. The key is not returned
by:

- `GET /settings`
- `GET /diagnostics`
- `./scripts/doctor`

## Diagnostics

`./scripts/doctor` reports runtime health: dependency availability, daemon
state, paste tools, microphone availability, database readiness, and selected
settings. It does not include transcript contents, note titles, audio, or
OpenRouter API keys.

`./scripts/debug-bundle` collects diagnostics plus recent sidecar and daemon
logs into a local tarball. Review the archive before sharing it because logs may
include local file paths or error messages from your environment.

## Uninstall

`./scripts/uninstall --yes` removes the app and services but intentionally
keeps user data in `~/.voice/`.

To remove all local user data:

```bash
rm -rf ~/.voice
```
