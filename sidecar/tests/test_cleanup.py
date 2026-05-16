from app.cleanup import clean


def test_empty_returns_empty():
    assert clean("") == ""


def test_strips_fillers():
    assert "um" not in clean("um, hello there.").lower()
    assert "uh" not in clean("uh, this is, uh, weird.").lower()


def test_collapses_stutters():
    assert clean("I I I think").lower().count("i") <= 2  # one "i think"


def test_capitalizes_sentence_starts():
    out = clean("hello there. how are you? i am fine.")
    assert out.startswith("Hello")
    assert "How" in out
    assert "I am" in out


def test_standalone_i_becomes_capital():
    assert "I am" in clean("i am happy")


def test_terminal_period_added():
    assert clean("hello world").endswith(".")


def test_idempotent():
    once = clean("um, hello there. i think i think this is fine")
    twice = clean(once)
    assert once == twice


def test_preserves_existing_punctuation():
    assert clean("Hello!").endswith("!")
    assert clean("Really?").endswith("?")


def test_whitespace_around_punctuation():
    out = clean("Hello , world .")
    assert ", world" in out
    assert "world." in out
