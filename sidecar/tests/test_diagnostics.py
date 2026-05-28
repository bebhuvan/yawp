def test_runtime_report_includes_release_doctor_sections(fresh_db):
    from app.diagnostics import runtime_report

    report = runtime_report()

    assert report["database"]["ready"] is True
    assert report["database"]["notes_count"] == 0
    assert isinstance(report["daemon"]["running"], bool)
    assert "status" in report["daemon"]
    assert report["paste"]["ready"] in (True, False)
    assert "microphone" in report
    assert "model" in report
    assert "openrouter_configured" in report["settings"]
    assert "input_device" in report["settings"]
    assert "audio_feedback_enabled" in report["settings"]


def test_paste_report_prefers_wayland_tools(monkeypatch):
    from app.diagnostics import _paste_report

    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")

    report = _paste_report(
        {
            "xdotool": True,
            "wtype": True,
            "dotool": True,
            "notify-send": True,
        }
    )

    assert report["session"] == "wayland"
    assert report["selected_tool"] == "wtype"
    assert report["ready"] is True
