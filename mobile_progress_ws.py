"""Push-based progress channel for the native app's Live Activity.

The node's own asyncio loop watches comfy_execution.progress's registry
in-process (a dict read, not a network call) and pushes a message to connected
clients the instant the value changes, so delivery latency is bounded by the
tick interval below rather than a client-chosen poll interval.

Scope stays narrow: this channel carries only the progress fraction. Queue
depth / isRunning stay on the `/queue` poll.
"""
import asyncio
import json
import logging

from aiohttp import web, WSMsgType

logger = logging.getLogger(__name__)

_clients = set()
_watch_task = None
_TICK_SECONDS = 0.1


def _snapshot():
    from comfy_execution.progress import get_progress_state, NodeState
    registry = get_progress_state()
    if not registry.prompt_id:
        return {"prompt_id": None, "value": 0, "max": 0}
    running = next(
        (n for n in registry.nodes.values() if n.get('state') == NodeState.Running),
        None,
    )
    if running is None:
        return {"prompt_id": registry.prompt_id, "value": 0, "max": 0}
    return {
        "prompt_id": registry.prompt_id,
        "value": running.get('value', 0),
        "max": running.get('max', 0),
    }


# Upper bound on how long one client's send may hold up a broadcast. The
# broadcast sits on the completion-notification path (mobile_push awaits
# broadcast_finished before dispatching pushes), so a suspended/backgrounded
# client whose socket buffer is full must not delay everyone else's
# notification.
_SEND_TIMEOUT_S = 2.0


async def _send_one(ws, message):
    """Send to one client; return False if it failed or timed out."""
    try:
        await asyncio.wait_for(ws.send_str(message), timeout=_SEND_TIMEOUT_S)
        return True
    except Exception:
        return False


async def _close_quietly(ws):
    try:
        await asyncio.wait_for(ws.close(), timeout=_SEND_TIMEOUT_S)
    except Exception:
        pass


async def _broadcast(snapshot):
    if not _clients:
        return
    message = json.dumps(snapshot)
    targets = list(_clients)
    # Concurrent + time-bounded: one slow client costs at most _SEND_TIMEOUT_S
    # for the whole broadcast instead of stacking up serially.
    results = await asyncio.gather(
        *(_send_one(ws, message) for ws in targets), return_exceptions=True
    )
    for ws, ok in zip(targets, results):
        if ok is True:
            continue
        _clients.discard(ws)
        # A cancelled/failed write leaves the socket in an unknown state; close
        # it in the background so the client reconnects cleanly rather than
        # sitting on a half-dead connection.
        asyncio.ensure_future(_close_quietly(ws))


async def _watch_loop():
    last = None
    while True:
        await asyncio.sleep(_TICK_SECONDS)
        if not _clients:
            continue
        try:
            snapshot = _snapshot()
        except Exception as exc:
            logger.debug("[Mobile Progress WS] snapshot failed: %s", exc)
            continue
        if snapshot == last:
            continue
        last = snapshot
        await _broadcast(snapshot)


async def api_progress_ws(request):
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    # Send the current state right away — the watch loop only broadcasts on
    # change, which would otherwise leave a client that connects mid-run
    # blank until the next tick.
    try:
        await ws.send_str(json.dumps(_snapshot()))
    except Exception:
        pass
    _clients.add(ws)
    try:
        async for msg in ws:
            if msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE, WSMsgType.CLOSING):
                break
    finally:
        _clients.discard(ws)
    return ws


async def broadcast_finished(prompt_id):
    """Explicit completion signal, called from mobile_push's own history-diff
    detection loop — the same trigger that fires the push notification.

    The progress snapshot alone can't tell a client "this exact prompt just
    finished": comfy_execution.progress's registry keeps the last prompt's id
    until a NEW prompt starts, so a client watching only value/max has no
    sharp edge to react to and has to infer completion from a slower,
    independent signal (the app's own /queue poll, up to ~2s stale). Piggy-
    backing on mobile_push's detection instead means this fires from the
    exact same moment-in-time as the notification dispatch, which is the
    whole point — a client reacting to this can resolve its UI in lockstep
    with the notification landing rather than racing it on a separate clock.
    """
    await _broadcast({"type": "finished", "prompt_id": prompt_id})


async def on_startup(app):
    global _watch_task
    _watch_task = asyncio.ensure_future(_watch_loop())


async def on_cleanup(app):
    if _watch_task is not None:
        _watch_task.cancel()
    for ws in list(_clients):
        await ws.close()
    _clients.clear()
