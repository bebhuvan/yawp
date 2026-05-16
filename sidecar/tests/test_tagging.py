from app.tagging import _parse_tags, rule_based


def test_rule_based_returns_top_terms():
    text = (
        "Authentication is a big topic in security. Authentication systems "
        "must handle authentication carefully. Security is paramount."
    )
    tags = rule_based(text, k=3)
    assert "authentication" in tags
    assert "security" in tags
    assert len(tags) <= 3


def test_rule_based_drops_stopwords():
    tags = rule_based("the and but is are was were", k=5)
    assert tags == []


def test_rule_based_drops_short_tokens():
    tags = rule_based("a b c hi", k=5)
    assert tags == []


def test_parse_tags_handles_json_array():
    assert _parse_tags('["work", "personal", "todo"]', 3) == ["work", "personal", "todo"]


def test_parse_tags_handles_prose_wrapped_json():
    reply = 'Here are the tags: ["meeting", "design"] hope that helps!'
    tags = _parse_tags(reply, 5)
    assert "meeting" in tags
    assert "design" in tags


def test_parse_tags_handles_comma_separated_fallback():
    tags = _parse_tags("focus, deepwork, schedule", 5)
    assert "focus" in tags
    assert "deepwork" in tags
    assert "schedule" in tags


def test_parse_tags_dedupes():
    tags = _parse_tags('["foo", "Foo", "foo"]', 5)
    assert tags == ["foo"]


def test_parse_tags_drops_long():
    long_one = "a-very-long-tag-that-should-be-rejected"
    tags = _parse_tags(f'["ok", "{long_one}"]', 5)
    assert "ok" in tags
    assert long_one not in tags
