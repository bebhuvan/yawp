import pytest


class FakeResponse:
    def __init__(self, status_code=200, body=None, text=""):
        self.status_code = status_code
        self._body = body
        self.text = text

    @property
    def ok(self):
        return 200 <= self.status_code < 300

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def test_chat_retries_transient_server_errors(monkeypatch):
    from app import openrouter

    calls = []

    def fake_post(*args, **kwargs):  # noqa: ARG001
        calls.append(kwargs)
        if len(calls) == 1:
            return FakeResponse(status_code=500, text="temporary")
        return FakeResponse(
            body={"choices": [{"message": {"content": "ok"}}]},
            text='{"choices":[{"message":{"content":"ok"}}]}',
        )

    monkeypatch.setattr(openrouter.requests, "post", fake_post)
    monkeypatch.setattr(openrouter.time, "sleep", lambda seconds: None)

    assert openrouter.chat(api_key="key", model="model", messages=[]) == "ok"
    assert len(calls) == 2


def test_chat_reports_invalid_json(monkeypatch):
    from app import openrouter

    monkeypatch.setattr(
        openrouter.requests,
        "post",
        lambda *args, **kwargs: FakeResponse(  # noqa: ARG005
            body=ValueError("bad json"),
            text="<html>nope</html>",
        ),
    )

    with pytest.raises(openrouter.OpenRouterError, match="invalid JSON"):
        openrouter.chat(api_key="key", model="model", messages=[], retries=0)
