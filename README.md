# Yawp

> *"I sound my barbaric yawp over the roofs of the world."* — Walt Whitman

**Local-first voice dictation for Linux.** Press a hotkey, talk, and the
transcript appears wherever your cursor is — terminal, editor, browser, chat.
Every byte of audio stays on your machine.

```
                Ctrl + Alt + V        ┌──────────────────────────────┐
   ─────────────────────────────────► │  any text input on your OS   │
   "let's grab lunch tomorrow"        │                              │
                                      │  let's grab lunch tomorrow▌  │
                                      └──────────────────────────────┘
```

---

## Why this exists

If you write or code with your voice, the Linux options today are thin:

| | Cloud dictation (Otter, Whisper API, Google Voice) | Manual workflow (open Whisper, paste) | **Yawp** |
|---|---|---|---|
| Privacy | Audio leaves your machine | — | All-local |
| Latency | Network roundtrip | Manual | Hotkey → text |
| Works in any app | Often no | Manual paste | Yes (xdotool/wtype) |
| Linux-native | Patchy | Yes | Yes |

It's roughly the experience of `Fn-Fn` dictation on macOS, but you own every byte
and it works inside any input on the system, including SSH terminals and code editors.

## What you get

- **Two hotkeys.** `Ctrl+Alt+V` types into the focused window. `Ctrl+Alt+N` saves
  a note in the library. Both also available as hold-to-talk.
- **A real notes library.** Searchable (SQLite FTS5), editable, tag-able,
  foldered, optionally action-item-extracted, exportable to Markdown.
- **Editorial UI.** Serif typography, paper-white palette, no glass / glow / neon.
  Designed to be a tool you want to sit with.
- **Polish pipeline.** Three opt-in tiers: regex cleanup (default on),
  LanguageTool grammar pass, OpenRouter copy-edit. Each replaceable in isolation.
- **Smart metadata.** Notes can be organized into summaries, note type,
  collection, people/projects, and stronger tags using OpenRouter or a local
  fallback.
- **Folders without lock-in.** Smart collections become real folders, but notes
  can still be moved manually and exported as plain Markdown. Auto-organize is
  opt-in and confidence-gated.
- **Voice commands.** "Period", "new paragraph", "scratch that", "all caps next" —
  off by default; turn on in Settings.
- **Live updates.** Recordings made via the global hotkey appear in the app
  window in real time (SSE).
- **Tray resident.** Closing the window hides it when the tray is active;
  relaunching Yawp focuses the existing window instead of creating duplicates.
- **Optional audio cues.** Local start/stop/error sounds are available for
  hands-free feedback and stay off until you enable them.
- **Undo on delete.** A 6-second toast lets you bring back any note you trash.

## What it doesn't do

- No cloud sync or accounts.
- No mobile build.
- No macOS or Windows build yet. (Tauri supports both; nothing in the codebase
  is Linux-specific except the paste tools and the WebKitGTK permission grant.
  Contributions welcome.)

## Quick install

```bash
git clone https://github.com/bebhuvan/yawp.git
cd yawp
./install.sh
```

`install.sh` will:
1. Verify Rust, Node 20+, Python 3.11+ are present.
2. Set up the Python venv + install requirements (uses [uv](https://github.com/astral-sh/uv) when available — much faster — otherwise `venv` + `pip`).
3. Install the frontend deps.
4. Build the Tauri app (3–5 min the first time; Rust is slow).
5. Install it (`.deb` if you have `sudo` and a ≤6-digit uid, AppImage otherwise).
6. Write systemd user units so the sidecar + hotkey daemon autostart on login.

After it finishes, search "Yawp" in your launcher, or just press `Ctrl+Alt+V`
into any input — services are already running.

### Prebuilt bundles

Tagged releases publish checksummed `.deb` and `.AppImage` bundles on the
[Releases](https://github.com/bebhuvan/yawp/releases) page. Note that the
bundle is the **desktop app only** — Yawp's transcription sidecar and hotkey
daemon are Python services that `install.sh` sets up (venv + systemd). So a
downloaded bundle still needs the sidecar from `install.sh` to function; a
fully self-contained single-download install (bundled sidecar) is planned.

### System packages (if a build step fails)

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  xdotool xclip portaudio19-dev libportaudio2 ffmpeg
```

`xclip` enables **clipboard paste** — paste mode delivers long dictations
instantly instead of typing them character-by-character. Without it, Yawp
falls back to typing. For Wayland, use `wtype` (or `dotool`) plus
`wl-clipboard` for the same fast-paste path.

## Hotkeys

| Action | Toggle mode | Hold mode |
|---|---|---|
| Dictate → note in library | `Ctrl+Alt+N` | hold `Menu` |
| Dictate → type at cursor | `Ctrl+Alt+V` | long-hold `Right Ctrl` |

In **toggle** mode (default), the recording stops automatically after ~1.2s
of silence (VAD-based) or when you press the hotkey again. In **hold** mode
it starts after a short solo hold and stops the moment you release the key.
Shortcuts such as `Ctrl+R` and `Ctrl+Shift+R` cancel the hold path and continue
to the focused app normally.

Switch modes and change hotkey presets in Settings — the daemon picks up the
change live, no restart. Presets intentionally avoid plain letter keys and
destructive combos.

## How it works

Three processes. Each is independently restartable.

```
+─────────────────────+        +───────────────────────+
│  Tauri desktop      │ <────► │  Python ASR sidecar   │
│  (React + Tauri 2)  │  HTTP  │  (FastAPI on 17893)   │
│  - notes library    │  SSE   │  - faster-whisper     │
│  - record + display │        │  - SQLite + FTS5      │
│  - settings UI      │        │  - cleanup, tagging,  │
+─────────────────────+        │    grammar, polish    │
                               +───────────────────────+
+─────────────────────+              ▲
│  Hotkey daemon      │ ─────────────┘
│  (Python + pynput)  │  HTTP
│  - global hotkeys   │
│  - mic capture      │
│  - xdotool / wtype  │
+─────────────────────+
```

- **Sidecar** does ASR (`faster-whisper`, default `base.en`, or local Parakeet
  v3 ONNX), persists notes to SQLite + FTS5 at `~/.voice/notes.db`, and serves
  the REST + SSE API.
- **Daemon** owns global hotkeys (`pynput`), captures audio (`sounddevice`),
  posts to the sidecar, then either saves the result as a note or types it
  into the focused window.
- **Tauri app** is the visible UI. Talks to the sidecar over HTTP + a single
  SSE connection so the library updates live when the daemon records a note.

Everything lives at `~/.voice/`:

```
~/.voice/
├── notes.db          ← SQLite library + FTS5 index
├── audio/            ← per-note WAV files
├── settings.json     ← user settings (mirrored in the UI)
└── daemon.sock       ← unix socket for daemon control
```

## Settings

All settings persist to `~/.voice/settings.json` and are surfaced in the
Settings page. Highlights:

- **Transcription model** — `base.en` is fast and accurate enough for daily
  dictation on a modern laptop. `small.en` is a noticeable accuracy bump at
  ~3× the CPU cost. `medium.en`, `large-v3-turbo`, and `distil-large-v3`
  are heavier downloadable faster-whisper options for accuracy-focused users.
  `Parakeet v3` uses the locally installed ONNX Parakeet TDT 0.6B v3 model.
  Settings includes a curated local model list with download source, rough
  disk size, speed, quality, and memory guidance.
- **Auto-clean transcripts** — strips fillers (`uh`/`um`/`you know`), fixes
  capitalization, dedupes stutters. Default on. Idempotent.
- **Voice commands** — `"period"`, `"new paragraph"`, `"scratch that"`,
  `"all caps next"`, etc. Off by default.
- **Audio cue** — optional local sounds for recording start, stop, cancel, and
  error events. Uses the desktop sound theme when available.
- **Auto-tag** — rule-based by default; uses your OpenRouter model if a key
  is configured.
- **Organize** — enriches a note with summary, type, collection, people,
  projects, and keywords. OpenRouter improves the output; local fallback keeps
  it usable offline.
- **Auto-organize** — optional folder creation/moves for new notes when smart
  metadata is confident enough. Manual folder moves are never overwritten.
- **Folders** — filter the library, create folders inline, and move any note
  from the note detail view.
- **Auto-export** — mirrors notes to a Markdown folder on every change.
  Compatible with Obsidian / Bear / iA Writer.

### OpenRouter (optional)

When configured with a free OpenRouter API key, the **Polish** button does
a conservative copy-edit and auto-tagging upgrades from rule-based to
model-based. Grab a free key at <https://openrouter.ai/keys>.

Curated free models in Settings — all zero-cost on OpenRouter. Paste any
other OpenRouter model ID in the "Custom model ID" field to override.

## Performance

`faster-whisper` int8 on CPU. Latency is logged per request:

```
transcribe: audio=5.91s  cpu=2.98s  rtf=2.0x  text_chars=13
```

For reference, on a 2024 Core Ultra 7 laptop, `base.en` runs at ~10×
realtime and `small.en` at ~3.7× realtime. Your mileage will vary —
benchmark on your hardware:

```bash
sidecar/.venv/bin/python tools/benchmark_asr.py --record-seconds 8
sidecar/.venv/bin/python tools/benchmark_asr.py --audio ~/sample.wav --models base.en,small.en
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Hotkeys don't work** | Daemon needs an active graphical session. Check `systemctl --user status yawp-daemon`. |
| **Paste mode doesn't type** on Wayland | Install `wtype` or `dotool`: `sudo apt install wtype` |
| **"Couldn't reach the transcription service"** | Sidecar isn't running. `systemctl --user restart yawp-sidecar` |
| **`.deb` install fails with "bad archive header magic"** | Your uid > 6 digits (corporate LDAP). `install.sh` will auto-fall-back to the AppImage. |
| **First Polish click hangs ~10s** | OpenRouter is doing first-call model selection. Subsequent calls are fast. |
| **First Grammar click hangs ~30–60s** | LanguageTool downloads ~200 MB of rules into `~/.cache/language_tool_python/`. One-time. |
| **Mic permission denied** in Tauri window | Yawp installs an auto-grant for WebKitGTK; if it still appears, check `pavucontrol`. |

Logs:

```bash
journalctl --user -u yawp-sidecar -f
journalctl --user -u yawp-daemon  -f
```

## Architecture quick-reference

```
voice-app/                — Tauri + React + TypeScript app
  src/                       UI components (editorial, paper-white)
  src-tauri/                 Rust + Tauri config; WebKitGTK permission grant
sidecar/
  app/main.py                FastAPI endpoints
  app/backends/whisper.py    faster-whisper backend (pluggable)
  app/db.py                  SQLite + FTS5 + migrations
  app/cleanup.py             Tier 1 regex polish
  app/tagging.py             Rule-based + OpenRouter tag extraction
  app/grammar.py             LanguageTool wrapper (Tier 2)
  app/openrouter.py          OpenRouter chat client
  app/voice_commands.py      "period" / "new paragraph" → punctuation
  app/transcription_service.py   ASR + cleanup, separate enrichment
  daemon.py                  Global hotkey daemon (toggle + hold)
tools/benchmark_asr.py     Reproducible RTF benchmark
install.sh                 One-shot installer + systemd autostart
start.sh                   Dev launcher (sidecar + Vite + optional daemon/Tauri)
```

Full technical docs:

- [Architecture](docs/ARCHITECTURE.md) - process boundaries, data ownership,
  APIs, reliability rules, diagnostics, and testing strategy.
- [Release hardening](docs/RELEASE_HARDENING.md) - production-readiness plan,
  quality gate, known risks, and pre-release checklist.
- [Distribution and operations](docs/DISTRIBUTION.md) - install, uninstall,
  service control, diagnostics, and release smoke tests.
- [Wayland shortcuts](docs/WAYLAND_SHORTCUTS.md) - GNOME, KDE, Sway, and
  Hyprland fallback bindings when compositor security blocks app hotkeys.
- [Handy review](docs/HANDY_REVIEW.md) - competitive notes from the comparable
  Handy project and which ideas Yawp should adopt.
- [Privacy](PRIVACY.md) and [Security](SECURITY.md) - data storage, network
  behavior, API keys, diagnostics, and vulnerability handling.

Run the complete local quality gate before shipping changes:

```bash
./scripts/check
```

Print a runtime diagnostics report:

```bash
./scripts/doctor
```

After install, the same operations are available through the `yawp` CLI:

```bash
yawp status
yawp doctor
yawp toggle-notes
yawp toggle-paste
yawp cancel
yawp reload
yawp logs
yawp debug-bundle
```

## Contributing

Issues and pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the short version: keep the architecture decoupled, write a test for any
behavior you'd be sad to lose, and match the existing UI palette.

This is a personal project shared in case it's useful. Response times may
vary; please don't take silence personally.

## License

[MIT](LICENSE) © 2026 Bhuvanesh R
