"""Push to the browser: tell every open Studio tab the moment its data changes.

`GET /api/events` is a Server-Sent Events stream. Each event names a topic and nothing
else — `jobs`, `media` (the gallery's rows or scores), `nodes`, `projects` (a render's
status) or `training` — and the tab refetches that topic through the ordinary scoped
endpoints. No row data rides on
the stream, so a scoped key learns nothing here it couldn't read from its own routes.

Writes publish from the db layer, the one place every change passes through. A burst of
writes (a startup catalog sync, a backfill) collapses into one event per topic per
subscriber, so a tab refetches once, not once per row.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from collections.abc import AsyncIterator

logger = logging.getLogger("flixml.events")

# Writes that land this close together reach a tab as one event.
_COALESCE_SECONDS = 0.2


class _Subscriber:
    def __init__(self) -> None:
        self.topics: set[str] = set()
        self.wake = asyncio.Event()


_subscribers: set[_Subscriber] = set()
_closing = False


def publish(topic: str) -> None:
    """Mark `topic` changed for every open stream. Safe to call from any coroutine."""
    for sub in _subscribers:
        sub.topics.add(topic)
        sub.wake.set()


def close_streams_on_exit() -> None:
    """End every stream as soon as the server is told to stop. Call once from app startup.

    uvicorn waits for open responses before it exits, then cancels whatever is left with
    a logged traceback each. A stream never finishes on its own, so without this every
    restart logged one error per open tab and the tabs only noticed after the timeout.
    Ended cleanly, the browser reconnects on its own once the API is back. uvicorn has
    installed its own SIGINT/SIGTERM handlers by the time startup runs; this one runs
    first and then hands the signal on to it.
    """
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        previous = signal.getsignal(sig)

        def handler(signum: int, frame: object, previous: object = previous) -> None:
            loop.call_soon_threadsafe(_close_all)
            if callable(previous):
                previous(signum, frame)

        signal.signal(sig, handler)


def _close_all() -> None:
    global _closing
    _closing = True
    for sub in _subscribers:
        sub.wake.set()


async def stream() -> AsyncIterator[str]:
    """One subscriber's SSE frames, until the client disconnects and the task is cancelled."""
    sub = _Subscriber()
    _subscribers.add(sub)
    logger.info("events client connected", extra={"event": "events.connected", "clients": len(_subscribers)})
    try:
        # How soon the browser reconnects after a drop (an API restart). Its `open` on
        # reconnect is what tells the tab to catch up on anything it missed meanwhile.
        yield "retry: 3000\n\n"
        while not _closing:
            await sub.wake.wait()
            if _closing:
                break
            await asyncio.sleep(_COALESCE_SECONDS)
            sub.wake.clear()
            topics, sub.topics = sub.topics, set()
            for topic in sorted(topics):
                yield f"event: {topic}\ndata: {{}}\n\n"
    finally:
        _subscribers.discard(sub)
        logger.info("events client disconnected", extra={"event": "events.disconnected", "clients": len(_subscribers)})
