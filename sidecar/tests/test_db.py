"""Smoke tests for db.py — migrations, soft-delete flow, FTS query builder."""

from app.db import _build_fts_query


def test_fts_query_empty():
    assert _build_fts_query("") == ""
    assert _build_fts_query("   ") == ""


def test_fts_query_single_token():
    assert _build_fts_query("auth") == '"auth"*'


def test_fts_query_multiple_tokens_use_or():
    q = _build_fts_query("redesign tomorrow")
    assert q == '"redesign"* OR "tomorrow"*'


def test_fts_query_strips_punctuation():
    q = _build_fts_query("auth, security!")
    assert "auth" in q
    assert "security" in q
    assert "!" not in q
    assert "," not in q


def test_soft_delete_then_restore_then_purge(fresh_db):
    db = fresh_db
    note = db.create_note(
        title="t",
        transcript="hello world",
        language="en",
        model="m",
        mode="notes",
        duration_sec=1.0,
        audio_path=None,
        tags=[],
        todos=[],
    )

    # visible
    assert any(n.id == note.id for n in db.list_notes())
    assert db.get_note(note.id) is not None

    # soft-delete
    assert db.soft_delete_note(note.id) is True
    assert all(n.id != note.id for n in db.list_notes())
    assert db.get_note(note.id) is None  # hidden by default
    assert db.get_note(note.id, include_deleted=True) is not None

    # restore
    restored = db.restore_note(note.id)
    assert restored is not None
    assert restored.deleted_at is None
    assert any(n.id == note.id for n in db.list_notes())

    # delete again, then hard purge
    db.soft_delete_note(note.id)
    assert db.purge_note(note.id) is True
    assert db.get_note(note.id, include_deleted=True) is None


def test_count_excludes_deleted(fresh_db):
    db = fresh_db
    a = db.create_note(
        title="a", transcript="x", language="en", model="m",
        mode="notes", duration_sec=1, audio_path=None,
    )
    db.create_note(
        title="b", transcript="y", language="en", model="m",
        mode="notes", duration_sec=1, audio_path=None,
    )
    assert db.count_notes() == 2
    db.soft_delete_note(a.id)
    assert db.count_notes() == 1


def test_fts_search_excludes_deleted(fresh_db):
    db = fresh_db
    a = db.create_note(
        title="alpha", transcript="findme alpha", language="en", model="m",
        mode="notes", duration_sec=1, audio_path=None,
    )
    db.create_note(
        title="beta", transcript="findme beta", language="en", model="m",
        mode="notes", duration_sec=1, audio_path=None,
    )
    assert len(db.search_notes("findme")) == 2
    db.soft_delete_note(a.id)
    results = db.search_notes("findme")
    assert len(results) == 1
    assert all(n.id != a.id for n in results)


def test_fts_search_snippets_mark_matches(fresh_db):
    db = fresh_db
    note = db.create_note(
        title="Architecture",
        transcript="make the app reliable and robust for daily use",
        language="en",
        model="m",
        mode="notes",
        duration_sec=1,
        audio_path=None,
        tags=["quality"],
    )

    results = db.search_notes_with_snippets("reliable")

    assert len(results) == 1
    found, snippet = results[0]
    assert found.id == note.id
    assert "[[reliable]]" in snippet.lower()


def test_smart_metadata_is_stored_and_searchable(fresh_db):
    db = fresh_db
    note = db.create_note(
        title="Meeting",
        transcript="ordinary text",
        language="en",
        model="m",
        mode="notes",
        duration_sec=1,
        audio_path=None,
        smart_metadata={
            "summary": "Discussed launch planning",
            "kind": "meeting",
            "collection": "Launch",
            "keywords": ["roadmap"],
        },
    )

    found = db.search_notes("roadmap")

    assert [n.id for n in found] == [note.id]
    assert found[0].smart_metadata["collection"] == "Launch"


def test_folders_are_durable_and_notes_can_move(fresh_db):
    db = fresh_db
    folder = db.create_folder("Product")
    note = db.create_note(
        title="Roadmap",
        transcript="folder test",
        language="en",
        model="m",
        mode="notes",
        duration_sec=1,
        audio_path=None,
        folder_id=folder.id,
    )

    assert db.get_note(note.id).folder_id == folder.id
    assert db.list_folders()[0].note_count == 1
    assert [n.id for n in db.list_notes(folder_id=folder.id)] == [note.id]

    moved = db.assign_note_folder(note.id, None)
    assert moved.folder_id is None
    assert [n.id for n in db.list_notes(folder_id="__uncategorized__")] == [note.id]


def test_collection_metadata_creates_folder(fresh_db):
    db = fresh_db
    note = db.create_note(
        title="Launch notes",
        transcript="launch",
        language="en",
        model="m",
        mode="notes",
        duration_sec=1,
        audio_path=None,
        smart_metadata={"collection": "Launch"},
        auto_folder_from_metadata=True,
        auto_folder_min_confidence=0,
    )

    folders = db.list_folders()
    assert [f.name for f in folders] == ["Launch"]
    assert note.folder_id == folders[0].id


def test_collection_metadata_does_not_create_folder_by_default(fresh_db):
    db = fresh_db
    note = db.create_note(
        title="Launch notes",
        transcript="launch",
        language="en",
        model="m",
        mode="notes",
        duration_sec=1,
        audio_path=None,
        smart_metadata={"collection": "Launch", "confidence": 1},
    )

    assert note.folder_id is None
    assert db.list_folders() == []


def test_auto_folder_respects_confidence_and_manual_move(fresh_db):
    db = fresh_db
    note = db.create_note(
        title="Launch notes",
        transcript="launch",
        language="en",
        model="m",
        mode="notes",
        duration_sec=1,
        audio_path=None,
        smart_metadata={"collection": "Launch", "confidence": 0.4},
        auto_folder_from_metadata=True,
        auto_folder_min_confidence=0.65,
    )
    assert note.folder_id is None

    manual = db.create_folder("Manual")
    db.assign_note_folder(note.id, manual.id)
    moved = db.auto_assign_folder_from_metadata(
        note.id,
        {"collection": "AI", "confidence": 1},
        min_confidence=0.65,
    )
    assert moved.folder_id == manual.id
    assert moved.folder_manually_set is True
