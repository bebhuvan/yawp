from __future__ import annotations

import asyncio
import json
import threading
from dataclasses import dataclass

from fastapi import APIRouter
from fastapi.responses import StreamingResponse


router = APIRouter()


@dataclass(frozen=True)
class _Subscriber:
    queue: asyncio.Queue
    loop: asyncio.AbstractEventLoop


_subscribers: list[_Subscriber] = []
_subscribers_lock = threading.Lock()


def _enqueue_event(queue: asyncio.Queue, msg: dict) -> None:
    try:
        queue.put_nowait(msg)
    except asyncio.QueueFull:
        pass


def broadcast_event(kind: str, payload: dict) -> None:
    msg = {"type": kind, "payload": payload}
    with _subscribers_lock:
        snapshot = list(_subscribers)
    for subscriber in snapshot:
        try:
            subscriber.loop.call_soon_threadsafe(
                _enqueue_event,
                subscriber.queue,
                msg,
            )
        except RuntimeError:
            pass


@router.get("/events")
async def events_endpoint() -> StreamingResponse:
    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    subscriber = _Subscriber(queue=queue, loop=asyncio.get_running_loop())
    with _subscribers_lock:
        _subscribers.append(subscriber)

    async def stream():
        yield "event: hello\ndata: {}\n\n"
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: {msg['type']}\ndata: {json.dumps(msg['payload'])}\n\n"
        finally:
            with _subscribers_lock:
                if subscriber in _subscribers:
                    _subscribers.remove(subscriber)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
