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
