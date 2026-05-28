# Security Policy

## Supported Versions

Yawp is currently pre-1.0. Security fixes target the latest commit on the main
development branch until formal releases begin.

## Reporting A Vulnerability

For now, open a private report with the maintainer if the hosting platform
supports it, or contact the maintainer directly before filing a public issue.

Include:

- affected commit or release;
- operating system and session type;
- whether OpenRouter was configured;
- reproduction steps;
- expected impact;
- relevant logs with secrets redacted.

Do not include OpenRouter API keys, private transcripts, or audio files in a
public issue.

## Security Boundaries

Yawp is a local desktop app. Its main boundaries are:

- local sidecar HTTP API on `127.0.0.1`;
- local Unix daemon socket under `~/.voice/daemon.sock`;
- SQLite database under `~/.voice/notes.db`;
- optional OpenRouter HTTPS calls when configured.

The sidecar is not intended to be exposed on a public network. Keep
`VOICE_HOST=127.0.0.1` for normal use.

## Current Hardening Rules

- Do not expose API keys through diagnostics or settings responses.
- Do not bind the sidecar to non-local interfaces by default.
- Do not add cloud calls to core dictation paths.
- Validate note IDs and audio paths at API boundaries.
- Keep CORS origins narrow.
- Treat provider responses as untrusted.

