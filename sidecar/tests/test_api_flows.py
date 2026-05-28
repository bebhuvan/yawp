import pytest
from types import SimpleNamespace


TestClient = pytest.importorskip("fastapi.testclient").TestClient


def test_note_crud_search_and_restore_flow(fresh_db):
    from app.main import app

    client = TestClient(app)

    created = client.post(
        "/notes",
        json={
            "title": "Architecture",
            "transcript": "make the app reliable",
            "language": "en",
            "model": "test",
            "mode": "notes",
            "duration_sec": 1.2,
            "tags": ["architecture"],
            "todos": [],
        },
    )
    assert created.status_code == 201
    note = created.json()

    listed = client.get("/notes")
    assert listed.status_code == 200
    assert [n["id"] for n in listed.json()["notes"]] == [note["id"]]

    found = client.get("/search", params={"q": "reliable"})
    assert found.status_code == 200
    assert [n["id"] for n in found.json()["notes"]] == [note["id"]]
    assert "searchSnippet" in found.json()["notes"][0]

    updated = client.patch(
        f"/notes/{note['id']}",
        json={"title": "Reliable architecture"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Reliable architecture"

    deleted = client.delete(f"/notes/{note['id']}")
    assert deleted.status_code == 204
    assert client.get("/notes").json()["notes"] == []

    restored = client.post(f"/notes/{note['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["id"] == note["id"]


def test_folder_crud_and_note_assignment_flow(fresh_db):
    from app.main import app

    client = TestClient(app)

    created_folder = client.post("/folders", json={"name": "Product"})
    assert created_folder.status_code == 201
    folder = created_folder.json()
    assert folder["name"] == "Product"

    created_note = client.post(
        "/notes",
        json={
            "title": "Folder test",
            "transcript": "organize this note",
            "language": "en",
            "model": "test",
            "mode": "notes",
            "duration_sec": 1,
            "folder_id": folder["id"],
        },
    )
    assert created_note.status_code == 201
    note = created_note.json()
    assert note["folderId"] == folder["id"]

    listed = client.get("/notes", params={"folder_id": folder["id"]})
    assert [n["id"] for n in listed.json()["notes"]] == [note["id"]]

    moved = client.post(f"/notes/{note['id']}/folder", json={"folder_id": None})
    assert moved.status_code == 200
    assert moved.json()["folderId"] is None

    unfiled = client.get("/notes", params={"folder_id": "__uncategorized__"})
    assert [n["id"] for n in unfiled.json()["notes"]] == [note["id"]]


def test_settings_and_capture_status_endpoints(fresh_db):
    from app.main import app

    client = TestClient(app)

    settings = client.put(
        "/settings",
        json={
            "hotkey_mode": "hold",
            "asr_model": "distil-large-v3",
            "input_device": 0,
            "auto_stop_ms": 2500,
            "hotkey_notes": "<ctrl>+<alt>+m",
            "hotkey_paste": "<ctrl>+<alt>+<f10>",
            "hold_key_notes": "<pause>",
            "hold_key_paste": "<ctrl_r>",
            "audio_feedback_enabled": True,
            "auto_organize_enabled": True,
            "auto_organize_min_confidence": 0.8,
        },
    )
    assert settings.status_code == 200
    body = settings.json()
    assert body["hotkey_mode"] == "hold"
    assert body["asr_model"] == "distil-large-v3"
    assert body["input_device"] == 0
    assert body["auto_stop_ms"] == 2500
    assert body["hotkey_notes"] == "<ctrl>+<alt>+m"
    assert body["hotkey_paste"] == "<ctrl>+<alt>+<f10>"
    assert body["hold_key_notes"] == "<pause>"
    assert body["hold_key_paste"] == "<ctrl_r>"
    assert body["audio_feedback_enabled"] is True
    assert body["auto_organize_enabled"] is True
    assert body["auto_organize_min_confidence"] == 0.8

    reset_input = client.put("/settings", json={"input_device": None})
    assert reset_input.status_code == 200
    assert reset_input.json()["input_device"] is None

    duplicate = client.put("/settings", json={"hold_key_paste": "<pause>"})
    assert duplicate.status_code == 400

    capture = client.get("/capture/status")
    assert capture.status_code == 200
    assert capture.json() == {"recording": False}


def test_auto_organize_setting_files_new_notes_when_confident(fresh_db):
    from app.main import app

    client = TestClient(app)
    client.put(
        "/settings",
        json={"auto_organize_enabled": True, "auto_organize_min_confidence": 0.7},
    )

    created = client.post(
        "/notes",
        json={
            "title": "Launch",
            "transcript": "prepare launch plan",
            "language": "en",
            "model": "test",
            "mode": "notes",
            "duration_sec": 1,
            "smart_metadata": {
                "collection": "Launch",
                "confidence": 0.8,
            },
        },
    )

    assert created.status_code == 201
    body = created.json()
    assert body["folderId"] is not None
    assert client.get("/folders").json()["folders"][0]["name"] == "Launch"


def test_openrouter_test_endpoint_uses_saved_or_supplied_key(fresh_db, monkeypatch):
    from app.main import app
    from app.routes import settings as settings_route

    calls = []
    monkeypatch.setattr(
        settings_route.openrouter,
        "test_connection",
        lambda api_key, model: calls.append((api_key, model)) or "ok",
    )

    client = TestClient(app)
    client.put("/settings", json={"openrouter_api_key": ""})

    missing = client.post("/settings/openrouter/test", json={})
    assert missing.status_code == 400

    client.put(
        "/settings",
        json={"openrouter_api_key": "saved-key", "openrouter_model": "saved/model"},
    )
    saved = client.post("/settings/openrouter/test", json={})
    supplied = client.post(
        "/settings/openrouter/test",
        json={"api_key": "typed-key", "model": "typed/model"},
    )

    assert saved.status_code == 200
    assert supplied.status_code == 200
    assert calls == [("saved-key", "saved/model"), ("typed-key", "typed/model")]


def test_capture_stop_and_save_creates_note_atomically(fresh_db, monkeypatch):
    from app.main import app
    from app.routes import capture as capture_route

    async def fake_run_in_asr(fn, **kwargs):  # noqa: ARG001
        return SimpleNamespace(
            text="saved from one endpoint",
            text_raw="saved from one endpoint",
            title="saved from one endpoint",
            language="en",
            duration=1.5,
            model="test-model",
            audio_path="/tmp/test.wav",
            segments=[],
        )

    monkeypatch.setattr(capture_route.native_capture, "stop_wav", lambda: (b"wav", 1.5))
    monkeypatch.setattr(capture_route, "run_in_asr", fake_run_in_asr)
    monkeypatch.setattr(
        capture_route.transcription_service,
        "enrich_text",
        lambda text, **kwargs: (
            ["reliability"],
            [{"id": "todo-1", "text": text, "done": False}],
            {
                "summary": "saved summary",
                "kind": "note",
                "collection": "Reliability",
                "people": [],
                "projects": [],
                "keywords": ["reliability"],
                "confidence": 0.9,
                "source": "test",
            },
        ),
    )

    client = TestClient(app)
    saved = client.post("/capture/stop-and-save", json={"mode": "notes"})

    assert saved.status_code == 200
    note = saved.json()
    assert note["transcript"] == "saved from one endpoint"
    assert note["mode"] == "notes"
    assert note["tags"] == ["reliability"]
    assert note["todos"][0]["id"] == "todo-1"
    assert note["smartMetadata"]["summary"] == "saved summary"

    listed = client.get("/notes")
    assert [n["id"] for n in listed.json()["notes"]] == [note["id"]]


def test_transcribe_reports_enrichment_failure_without_failing_asr(fresh_db, monkeypatch):
    from app.main import app
    from app.routes import transcription as transcription_route

    async def fake_run_in_asr(fn, **kwargs):  # noqa: ARG001
        return SimpleNamespace(
            text="core transcript still works",
            text_raw="core transcript still works",
            title="core transcript still works",
            language="en",
            duration=1.0,
            model="test-model",
            audio_path="/tmp/test.wav",
            segments=[],
        )

    def fail_enrichment(text, **kwargs):  # noqa: ARG001
        raise RuntimeError("provider timed out")

    monkeypatch.setattr(transcription_route, "run_in_asr", fake_run_in_asr)
    monkeypatch.setattr(
        transcription_route.transcription_service,
        "enrich_text",
        fail_enrichment,
    )

    client = TestClient(app)
    response = client.post(
        "/transcribe",
        files={"audio": ("audio.wav", b"not-a-real-wav", "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "core transcript still works"
    assert body["tags"] == []
    assert body["todos"] == []
    assert body["request_id"]
    assert body["enrichment_status"] == {
        "requested": True,
        "ok": False,
        "code": "RuntimeError",
        "message": "provider timed out",
    }


def test_cleanup_polish_persists_note_and_broadcasts_update(fresh_db, monkeypatch):
    from app.main import app
    from app.routes import polish as polish_route

    events = []
    monkeypatch.setattr(
        polish_route,
        "broadcast_event",
        lambda kind, payload: events.append((kind, payload)),
    )

    client = TestClient(app)
    client.put("/settings", json={"openrouter_api_key": ""})
    created = client.post(
        "/notes",
        json={
            "title": "Raw",
            "transcript": "um i i agree",
            "language": "en",
            "model": "test",
            "mode": "notes",
            "duration_sec": 1,
        },
    ).json()

    polished = client.post(
        "/polish",
        json={"text": created["transcript"], "note_id": created["id"]},
    )

    assert polished.status_code == 200
    assert polished.json() == {"text": "I agree.", "source": "cleanup-only"}
    assert fresh_db.get_note(created["id"]).transcript == "I agree."
    assert events == [
        (
            "note.updated",
            {
                **fresh_db.get_note(created["id"]).to_dict(),
                "transcript": "I agree.",
            },
        )
    ]


def test_grammar_apply_and_todo_extract_broadcast_note_updates(fresh_db, monkeypatch):
    from app.main import app
    from app.routes import grammar as grammar_route
    from app.routes import notes as notes_route

    events = []
    monkeypatch.setattr(
        grammar_route,
        "broadcast_event",
        lambda kind, payload: events.append(("grammar", kind, payload)),
    )
    monkeypatch.setattr(
        notes_route,
        "broadcast_event",
        lambda kind, payload: events.append(("todos", kind, payload)),
    )
    monkeypatch.setattr(grammar_route.grammar_checker, "apply", lambda text: "Corrected.")
    monkeypatch.setattr(
        notes_route.todos_mod,
        "extract",
        lambda text, api_key, model: [{"id": "todo-1", "text": text, "done": False}],
    )

    client = TestClient(app)
    client.put("/settings", json={"openrouter_api_key": "test-key"})
    created = client.post(
        "/notes",
        json={
            "title": "Work",
            "transcript": "fix this",
            "language": "en",
            "model": "test",
            "mode": "notes",
            "duration_sec": 1,
        },
    ).json()
    events.clear()

    grammar = client.post(
        "/grammar/apply",
        json={"text": created["transcript"], "note_id": created["id"]},
    )
    todos = client.post(f"/notes/{created['id']}/extract-todos")

    assert grammar.status_code == 200
    assert todos.status_code == 200
    assert fresh_db.get_note(created["id"]).transcript == "Corrected."
    assert fresh_db.get_note(created["id"]).todos == [
        {"id": "todo-1", "text": "Corrected.", "done": False}
    ]
    assert [event[0:2] for event in events] == [
        ("grammar", "note.updated"),
        ("todos", "note.updated"),
    ]


def test_organize_note_updates_smart_metadata_and_tags(fresh_db, monkeypatch):
    from app.main import app
    from app.routes import notes as notes_route

    monkeypatch.setattr(
        notes_route.smart_metadata,
        "extract",
        lambda **kwargs: {
            "summary": "A product idea about better search.",
            "kind": "idea",
            "collection": "Product",
            "people": [],
            "projects": ["Yawp"],
            "keywords": ["search", "organization"],
            "confidence": 0.92,
            "source": "test",
        },
    )

    client = TestClient(app)
    created = client.post(
        "/notes",
        json={
            "title": "Search idea",
            "transcript": "Add better search and organization.",
            "language": "en",
            "model": "test",
            "mode": "notes",
            "duration_sec": 1,
            "tags": ["product"],
        },
    ).json()

    organized = client.post(f"/notes/{created['id']}/organize")

    assert organized.status_code == 200
    body = organized.json()
    assert body["smartMetadata"]["summary"] == "A product idea about better search."
    assert body["smartMetadata"]["collection"] == "Product"
    assert body["folderId"] is not None
    assert fresh_db.list_folders()[0].name == "Product"
    assert "search" in body["tags"]
