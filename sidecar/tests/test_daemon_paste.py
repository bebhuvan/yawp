from __future__ import annotations

import subprocess
import os
from types import SimpleNamespace

os.environ.setdefault("PYNPUT_BACKEND", "dummy")

import daemon


def test_zed_window_uses_terminal_paste_shortcut(monkeypatch):
    monkeypatch.setattr(daemon, "HAS_XDOTOOL", True)

    def fake_run(cmd, **_kwargs):
        if cmd[-1] == "getwindowclassname":
            return SimpleNamespace(stdout="dev.zed.Zed\n")
        if cmd[-1] == "getwindowname":
            return SimpleNamespace(stdout="Codex - Zed\n")
        raise AssertionError(cmd)

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert daemon._active_window_prefers_terminal_paste() is True


def test_plain_editor_uses_regular_paste_shortcut(monkeypatch):
    monkeypatch.setattr(daemon, "HAS_XDOTOOL", True)

    def fake_run(cmd, **_kwargs):
        if cmd[-1] == "getwindowclassname":
            return SimpleNamespace(stdout="org.gnome.TextEditor\n")
        if cmd[-1] == "getwindowname":
            return SimpleNamespace(stdout="Notes.txt\n")
        raise AssertionError(cmd)

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert daemon._active_window_prefers_terminal_paste() is False
