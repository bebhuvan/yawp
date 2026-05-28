from __future__ import annotations

import sqlite3

import pytest

TestClient = pytest.importorskip("fastapi.testclient").TestClient


def _reset_db_connection(db) -> None:
    cached = getattr(db._local, "conn", None)
    if cached is not None:
        try:
            cached.close()
        except Exception:
            pass
        db._local.conn = None


def test_migrates_v1_database_without_losing_notes(_isolated_voice_dir):
    from app import config, db

    db_path = _isolated_voice_dir / "legacy-v1.db"
    config.DB_PATH = db_path
    config.AUDIO_DIR = _isolated_voice_dir / "audio"
    config.AUDIO_DIR.mkdir(exist_ok=True)
    _reset_db_connection(db)

    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(db._MIGRATIONS[0][1])
        conn.execute("PRAGMA user_version = 1")
        conn.execute(
            "INSERT INTO notes "
            "(id, title, transcript, language, model, mode, duration_sec, "
            "audio_path, created_at, tags, todos) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "legacy-note",
                "Legacy launch note",
                "Ship a reliable dictation release",
                "en",
                "base.en",
                "notes",
                2.5,
                None,
                "2026-05-01T00:00:00.000+00:00",
                '["release"]',
                "[]",
            ),
        )
        conn.commit()
    finally:
        conn.close()

    db.init_db()
    _reset_db_connection(db)

    migrated = db.get_note("legacy-note")
    assert migrated is not None
    assert migrated.title == "Legacy launch note"
    assert migrated.smart_metadata == {}
    assert migrated.folder_id is None
    assert migrated.folder_manually_set is False
    assert [n.id for n in db.search_notes("reliable")] == ["legacy-note"]

    with db.cursor() as conn:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
    assert version == db._MIGRATIONS[-1][0]


def test_audio_route_rejects_path_traversal(fresh_db):
    from app.main import app

    client = TestClient(app)

    encoded = client.get("/audio/%2E%2E%2Fsettings.json")
    windows = client.get("/audio/..\\settings.json")

    assert encoded.status_code in {400, 404}
    assert windows.status_code == 400


def test_corrupt_settings_file_falls_back_to_defaults(_isolated_voice_dir):
    from app import config, settings

    settings.SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    settings.SETTINGS_PATH.write_text("{not-json", encoding="utf-8")
    settings.invalidate_cache()

    loaded = settings.get()

    assert loaded.asr_model == config.DEFAULT_MODEL
    assert loaded.openrouter_api_key == ""


def test_openapi_documents_transcription_enrichment_contract(fresh_db):
    from app.main import app

    client = TestClient(app)
    response = client.get("/openapi.json")

    assert response.status_code == 200
    transcribe_schema = response.json()["components"]["schemas"]["TranscribeResponse"]
    properties = transcribe_schema["properties"]
    assert "request_id" in properties
    assert "enrichment_status" in properties
    assert properties["segments"]["items"]["$ref"].endswith("/SegmentResponse")
