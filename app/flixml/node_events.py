"""Push from ComfyUI: one WebSocket per node, and a reconcile of its jobs on every queue change.

ComfyUI broadcasts a `status` message to every connected socket each time its queue
changes — a prompt queued, started or finished (`PromptQueue.put`, `get` and `task_done`
in its execution.py) — and `task_done` writes the prompt to /history before it sends that
message. So a socket that listens for `status` hears about every job on its node the
moment it moves, whichever client submitted it, and the job's state is then read once
through `_reconcile_job` instead of asking every node about every job on a timer.

No clientId is sent. Studio's first bridge (removed in 90f4ada) connected with a fixed one
per node. When a client reconnects under an id ComfyUI already holds, ComfyUI swaps the
new socket into that slot; when the old connection finally closes, its cleanup pops the
id again and takes the new socket with it. The new socket stays open and hears nothing,
and jobs sat at "pending" with nothing logged. Without a clientId every connection gets
its own id from the server and that cannot happen. The messages ComfyUI sends only to the
submitting client (`executing`, `progress`) are not needed: `status` covers every change
of state.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import Awaitable, Callable

from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from .config import ComfyNode

logger = logging.getLogger("flixml.node_events")

# A node that stops answering without closing the socket (power cut, network drop) is
# noticed when a ping goes unanswered: within ping interval + timeout of going silent.
_PING_INTERVAL_SECONDS = 10.0
_PING_TIMEOUT_SECONDS = 10.0
_RECONNECT_MAX_SECONDS = 10.0
# How soon a reconcile that raised is tried again.
_RETRY_SECONDS = 15.0

# Settles one node's unfinished jobs. Returns seconds until they need another look with
# no push to prompt it, or None when the node's next push is enough.
ReconcileNode = Callable[[ComfyNode], Awaitable[float | None]]

_wakes: dict[str, asyncio.Event] = {}
_rechecks: dict[str, asyncio.TimerHandle] = {}
_unreachable: set[str] = set()
_tasks: list[asyncio.Task] = []


def node_unreachable(node_id: str) -> bool:
    """True while Studio holds no open socket to this node, so its jobs' state is unknown."""
    return node_id in _unreachable


def wake(node_id: str) -> None:
    """Have this node's jobs reconciled now."""
    event = _wakes.get(node_id)
    if event is not None:
        event.set()


def wake_all() -> None:
    """Have every node's jobs reconciled now.

    Called once a new job's row is saved. Studio saves the row only after the node has
    accepted the prompt, so a quick job can be queued, run and finished — and its pushes
    spent — before the row exists to be reconciled.
    """
    for node_id in _wakes:
        wake(node_id)


def start(nodes: list[ComfyNode], reconcile: ReconcileNode) -> None:
    for node in nodes:
        if node.id in _wakes:
            continue
        _wakes[node.id] = asyncio.Event()
        # Nothing is known about a node until its socket opens.
        _unreachable.add(node.id)
        _tasks.append(asyncio.create_task(_listen(node), name=f"node-events:{node.id}"))
        _tasks.append(asyncio.create_task(_settle(node, reconcile), name=f"node-settle:{node.id}"))


async def stop() -> None:
    for task in _tasks:
        task.cancel()
    for task in _tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task
    for handle in _rechecks.values():
        handle.cancel()
    _tasks.clear()
    _rechecks.clear()
    _wakes.clear()
    _unreachable.clear()


def _socket_url(node: ComfyNode) -> str:
    base = node.comfyui.normalized_url
    scheme, rest = base.split("://", 1)
    return f"{'wss' if scheme == 'https' else 'ws'}://{rest}/ws"


async def _listen(node: ComfyNode) -> None:
    """Hold a socket open to one node for the life of the process, reconnecting when it drops."""
    url = _socket_url(node)
    delay = 1.0
    reported_down = False
    while True:
        try:
            async with connect(
                url,
                proxy=None,
                ping_interval=_PING_INTERVAL_SECONDS,
                ping_timeout=_PING_TIMEOUT_SECONDS,
                # Latent previews are binary frames; ComfyUI sends them only to the
                # submitting client, but nothing here should fail on a large one.
                max_size=None,
            ) as socket:
                logger.info("node %s: socket open, jobs follow its pushes", node.id)
                _unreachable.discard(node.id)
                reported_down = False
                delay = 1.0
                # A node that restarted while we were away has lost its queue; this
                # reconcile is what settles the jobs it no longer knows.
                wake(node.id)
                async for message in socket:
                    if isinstance(message, bytes):
                        continue
                    try:
                        kind = json.loads(message).get("type")
                    except (ValueError, AttributeError):
                        continue
                    if kind == "status":
                        wake(node.id)
            reason = "closed by node"
        except asyncio.CancelledError:
            raise
        except (OSError, TimeoutError, WebSocketException) as exc:
            reason = f"{type(exc).__name__}: {exc}"
        _unreachable.add(node.id)
        if not reported_down:
            logger.warning("node %s: no socket (%s); its jobs are unreachable until it reconnects", node.id, reason)
            reported_down = True
        await asyncio.sleep(delay)
        delay = min(delay * 2, _RECONNECT_MAX_SECONDS)


async def _settle(node: ComfyNode, reconcile: ReconcileNode) -> None:
    """Reconcile a node's jobs each time it is woken. Wakes that land mid-reconcile collapse into one more pass."""
    event = _wakes[node.id]
    loop = asyncio.get_running_loop()
    while True:
        await event.wait()
        event.clear()
        try:
            again = await reconcile(node)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("node %s: reconcile failed", node.id, exc_info=True)
            again = _RETRY_SECONDS
        pending = _rechecks.pop(node.id, None)
        if pending is not None:
            pending.cancel()
        if again is not None:
            _rechecks[node.id] = loop.call_later(again, event.set)
