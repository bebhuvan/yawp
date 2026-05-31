from __future__ import annotations

import subprocess
import os
from types import SimpleNamespace

os.environ.setdefault("PYNPUT_BACKEND", "dummy")

import daemon


def test_zed_window_uses_terminal_paste_shortcut(monkeypatch):
    monkeypatch.setattr(daemon, "HAS_XDOTOOL", True)

    def fake_run(cmd, **_kwargs):
        if cmd[-1] == "getwindowname":
            return SimpleNamespace(stdout="Codex\n")
        if cmd[-1] == "getwindowpid":
            return SimpleNamespace(stdout="1234\n")
        if cmd[:3] == ["ps", "-p", "1234"]:
            return SimpleNamespace(stdout="zed /usr/bin/zed\n")
        raise AssertionError(cmd)

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert daemon._active_window_prefers_terminal_paste() is True


def test_plain_editor_uses_regular_paste_shortcut(monkeypatch):
    monkeypatch.setattr(daemon, "HAS_XDOTOOL", True)

    def fake_run(cmd, **_kwargs):
        if cmd[-1] == "getwindowname":
            return SimpleNamespace(stdout="Notes.txt\n")
        if cmd[-1] == "getwindowpid":
            return SimpleNamespace(stdout="1234\n")
        if cmd[:3] == ["ps", "-p", "1234"]:
            return SimpleNamespace(stdout="gnome-text-editor /usr/bin/gnome-text-editor\n")
        raise AssertionError(cmd)

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert daemon._active_window_prefers_terminal_paste() is False


def test_xdotool_clipboard_paste_uses_terminal_safe_shortcut(monkeypatch):
    seen: list[list[str]] = []

    monkeypatch.setattr(daemon, "HAS_XDOTOOL", True)
    monkeypatch.setattr(daemon, "HAS_WTYPE", False)
    monkeypatch.setattr(daemon, "_clipboard_available", lambda: True)
    monkeypatch.setattr(daemon, "_clipboard_get", lambda: None)
    monkeypatch.setattr(daemon, "_clipboard_set", lambda _data: True)
    monkeypatch.setattr(daemon, "_active_window_prefers_terminal_paste", lambda: False)
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")

    def fake_run(cmd, **_kwargs):
        seen.append(cmd)
        return SimpleNamespace(stdout="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert daemon.paste_via_clipboard("hello") is True
    assert ["xdotool", "key", "--clearmodifiers", "ctrl+shift+v"] in seen
