# Yawp

> *"I sound my barbaric yawp over the roofs of the world."* — Walt Whitman, *Song of Myself*

Yawp is a local-first voice dictation app. Hit a global hotkey, talk, and the
transcript appears either as a note in the library or typed directly into the
window where your cursor is. All transcription happens on this machine.

* **Transcription**: [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
  with the `base.en` model by default. Override via `VOICE_MODEL`.
* **Storage**: SQLite at `~/.voice/notes.db`. Audio at `~/.voice/audio/`.
* **Cleanup**: Tier 1 regex polish (default on) and an optional
  [LanguageTool](https://languagetool.org/) grammar pass.
* **Polish**: optional conservative copy-editing via free
  [OpenRouter](https://openrouter.ai/) models (GPT-OSS, Nemotron, DeepSeek,
  Gemma, etc.).
* **Search**: SQLite FTS5 over title + transcript + tags.
* **Two recording modes**: in-app (save to notes) or global hotkey daemon
  (auto-paste at cursor anywhere on the system).

---

## Architecture

Three processes, each replaceable in isolation:

```
+---------------------+        +-----------------------+
|  Tauri desktop      | <----> |  Python ASR sidecar   |
|  (React + Tauri 2)  |  HTTP  |  (FastAPI on 17893)   |
|  - notes library    |  WSS   |  - faster-whisper     |
|  - record + display |        |  - SQLite             |
|  - settings UI      |        |  - cleanup + tagging  |
+---------------------+        |  - OpenRouter polish  |
                               |  - grammar (Java)     |
+---------------------+        +-----------------------+
|  Hotkey daemon      | -----> |   (same sidecar)      |
|  (Python + pynput)  |  HTTP  |                       |
|  - global hotkeys   |        |                       |
|  - sounddevice      |        |                       |
|  - xdotool paste    |        |                       |
+---------------------+        +-----------------------+
```

Key files:

```
voice-app/                 — Tauri + React + TypeScript app shell
  src/                       UI components (Editorial Warm aesthetic)
  src-tauri/                 Rust + Tauri config; webview permission grant
                             for media in WebKitGTK lives here
sidecar/
  app/main.py                FastAPI endpoints (health, transcribe, notes,
                             search, polish, grammar, stream WebSocket)
  app/backends/whisper.py    Pluggable ASR; faster-whisper backend
  app/cleanup.py             Tier 1 regex polish
  app/tagging.py             Rule-based + OpenRouter tag extraction
  app/openrouter.py          OpenRouter chat client
  app/grammar.py             LanguageTool wrapper (Tier 2)
  app/voice_commands.py      "period"/"new paragraph" → punctuation
  app/db.py                  SQLite + FTS5
  app/settings.py            ~/.voice/settings.json
  daemon.py                  Global hotkey daemon (toggle / hold-to-talk)
tools/make_icon.py         Regenerates the icon set
start.sh                   Dev launcher
```

---

## Quick start

### Prerequisites

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  xdotool portaudio19-dev libportaudio2 ffmpeg
```

Plus a Rust toolchain (`rustup`), Node 20+, Python 3.11+.

### Run dev

```bash
./start.sh                  # sidecar + Vite (browser preview at :1420)
./start.sh --tauri          # + native desktop window (first Rust compile ~3-5 min)
./start.sh --daemon         # + global hotkey daemon
./start.sh --daemon --tauri # everything
```

On the very first transcription, the chosen Whisper model downloads
(~150 MB – 1.5 GB depending on size). On the first **Check grammar** click,
LanguageTool downloads its ruleset (~200 MB) into
`~/.cache/language_tool_python/`.

---

## Hotkeys

Defaults — change in Settings (toggle mode) or via env vars (hold mode):

| Action | Default key (toggle) | Default key (hold) |
|---|---|---|
| Record → save as note | `Ctrl + Alt + N` | hold `F9` |
| Record → auto-paste at cursor | `Ctrl + Alt + V` | hold `F10` |

In **toggle** mode the recording stops automatically after ~1.2 s of silence
(VAD-based) or when you press the hotkey again. In **hold** mode it stops
the moment you release the key.

Override via env vars before starting the daemon:

```
VOICE_HOTKEY_NOTES=<ctrl>+<alt>+n   VOICE_HOTKEY_PASTE=<ctrl>+<alt>+v
VOICE_HOLD_KEY_NOTES=<f9>           VOICE_HOLD_KEY_PASTE=<f10>
VOICE_AUTO_STOP_MS=1200             VOICE_VAD_AGGRESSIVENESS=2
VOICE_HOTKEY_MODE=toggle            # or 'hold'
```

The daemon must be restarted after changing the mode or any of these vars.

### Daemon CLI

When the daemon is already running, you can control it from scripts,
keyboard-shortcut launchers, or shell aliases:

```bash
sidecar/.venv/bin/python sidecar/daemon.py --toggle-notes
sidecar/.venv/bin/python sidecar/daemon.py --toggle-paste
sidecar/.venv/bin/python sidecar/daemon.py --cancel
sidecar/.venv/bin/python sidecar/daemon.py --status
```

These commands talk to the running daemon over `~/.voice/daemon.sock`.

### Linux paste tools

Paste mode picks the best available tool for the current display server:

* **X11**: `xdotool`
* **Wayland**: `wtype`, then `dotool`, then `xdotool` as a last fallback

Install the relevant tool for reliable paste-anywhere behavior:

```bash
sudo apt install -y xdotool wtype
```

`dotool` may also work on Wayland, but usually requires extra input-device
permissions.

---

## Settings

All settings persist to `~/.voice/settings.json` and are surfaced in the
Settings page. The daemon reads them at startup.

* **Transcription model** — local faster-whisper model used by the sidecar.
  Default is `base.en` on this machine. Restart the sidecar after changing it.
* **Auto-clean transcripts** — Tier 1 regex polish on every new transcript.
  Removes fillers (uh / um / you know), fixes capitalization, dedupes
  stutters, normalises whitespace. Default on.
* **Voice commands** — interpret spoken phrases as control:
  `"period"`, `"comma"`, `"colon"`, `"semicolon"`, `"question mark"`,
  `"exclamation point"`, `"new line"`, `"new paragraph"`,
  `"open quote"`, `"close quote"`, `"open paren"`, `"close paren"`.
  Default off — enable in Settings.
* **Live transcription** — stream audio to the sidecar while recording so the
  recorder HUD can show partial text. Turn it off to reduce CPU use during
  longer recordings. Final transcription still runs when you stop recording.
* **Auto-tag** — extract up to 5 tags per note. Rule-based by default;
  uses your chosen OpenRouter model when an API key is set.
* **Activation mode** — toggle vs hold-to-talk. Daemon restart required.
* **Auto-export** — when enabled with an export folder, keeps the Markdown
  folder mirrored after note create/edit/polish/delete operations.

### OpenRouter

Optional. When configured, the **Polish** button lightly copy-edits a note via
the chosen free model, and auto-tagging upgrades from rule-based to model-based.

1. Get a free key at <https://openrouter.ai/keys>.
2. Paste it in Settings → OpenRouter → API key.
3. Pick a model from the dropdown:

| Model | Notes |
|---|---|
| `openai/gpt-oss-20b:free` | Fast, low-latency. **Default.** |
| `openai/gpt-oss-120b:free` | 117B with reasoning + tool use. Higher quality. |
| `google/gemma-4-31b-it:free` | Multimodal, balanced. |
| `nvidia/nemotron-3-nano-30b-a3b:free` | 256K context. Agentic-tuned. |
| `nvidia/nemotron-3-super-120b-a12b:free` | Largest Nemotron, 1M context. |
| `z-ai/glm-4.5-air:free` | Thinking + non-thinking modes. |
| `minimax/minimax-m2.5:free` | Tuned for office/productivity. |
| `deepseek/deepseek-v4-flash:free` | 284B MoE, 1M context, fast inference. |
| `inclusionai/ring-2.6-1t:free` | 1T parameters; thinking model. |
| `arcee-ai/trinity-large-thinking:free` | Reasoning-focused. |
| `baidu/cobuddy:free` | Code-oriented. |

Paste any other OpenRouter model ID in the "Custom model ID" field to
override.

---

## Models

Default is `base.en` via `faster-whisper` (int8 on CPU). Override with
`VOICE_MODEL=...` before starting the sidecar. Recognised IDs include
`base.en`, `small.en`, `medium.en`, `large-v3-turbo`, `distil-large-v3`,
plus the multilingual variants without the `.en` suffix.

Bigger model = usually better accuracy but slower on CPU. On this Core Ultra
7 155U laptop, a 10 s mic benchmark ran `base.en` at ~9-11× realtime and
`small.en` at ~3.7× realtime. `base.en` is the default because it is fast
enough for paste-anywhere dictation on this hardware.

Latency is logged per request:

```
transcribe: audio=5.91s  cpu=2.98s  rtf=2.5x  text_chars=13
```

`rtf` is "realtime factor" — larger is faster than realtime.

### Benchmark ASR on this machine

Use the benchmark helper before changing ASR backends or rewriting the app:

```bash
sidecar/.venv/bin/python tools/benchmark_asr.py --record-seconds 8
sidecar/.venv/bin/python tools/benchmark_asr.py --audio ~/sample.wav --models base.en,small.en
sidecar/.venv/bin/python tools/benchmark_asr.py --audio ~/sample.wav --models base.en --runs 3 --csv /tmp/yawp-asr.csv
```

The output reports audio duration, wall time, and realtime factor (`rtf`).
Use the same sample to compare Yawp, Handy, and any Rust/Parakeet spike.

---

## Troubleshooting

* **"Microphone permission denied"** in the Tauri window — Yawp installs
  a WebKitGTK permission handler that auto-grants. If you still see it,
  pulse-audio / pipewire may be blocking; check `pavucontrol` for input
  devices.
* **"MediaRecorder is unsupported"** — you're on an old build of WebKitGTK.
  Yawp uses the Web Audio API + manual WAV encoding instead, so this
  shouldn't appear. If it does, rebuild Tauri.
* **First Polish click hangs** — first call has to download the model
  selection on OpenRouter side. Wait ~10 s.
* **First Check grammar click hangs** — LanguageTool downloads ~200 MB of
  language rules. Wait ~30–60 s once; subsequent calls are <500 ms.
* **Hotkeys don't work** — daemon needs a running X11 session (Wayland
  global-hotkey support varies). Check `echo $XDG_SESSION_TYPE`.
* **Paste mode doesn't type on Wayland** — install `wtype` or `dotool`.
* **Sidecar not running** error toast — start it: `sidecar/.venv/bin/python sidecar/run.py`.

---

## Build for distribution

```bash
cd voice-app
npm run tauri build
```

Produces `.deb` and `.AppImage` in `src-tauri/target/release/bundle/`.
Install via `sudo dpkg -i …_amd64.deb`. The Python sidecar isn't bundled
yet — it runs as a separate process you start manually or via systemd.
