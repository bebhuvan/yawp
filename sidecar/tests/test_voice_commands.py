from app.voice_commands import apply


def test_period_becomes_dot():
    assert apply("hello period") == "hello."


def test_comma():
    assert "hello," in apply("hello comma world")


def test_new_paragraph():
    out = apply("first paragraph new paragraph second paragraph")
    assert "\n\n" in out


def test_question_mark():
    assert apply("really question mark").endswith("?")


def test_scratch_that_drops_last_sentence():
    out = apply("This is wrong. Scratch that. This is right.")
    assert "wrong" not in out.lower()
    assert "right" in out.lower()


def test_capitalize_next_word():
    out = apply("hello capitalize next world")
    assert "World" in out


def test_all_caps():
    out = apply("hello all caps urgent")
    assert "URGENT" in out


def test_open_close_quotes():
    out = apply("open quote hello world close quote")
    assert '"hello world"' in out or '"hello world".' in out


def test_passthrough_when_no_commands():
    plain = "just a normal sentence with no commands"
    assert apply(plain) == plain
