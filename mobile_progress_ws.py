"""Progress delivery for CueForge's foreground socket and Live Activity relay.

The node's own asyncio loop watches comfy_execution.progress's registry
in-process (a dict read, not a network call) and pushes a message to connected
clients the instant the value changes, so delivery latency is bounded by the
tick interval below rather than a client-chosen poll interval.

Connected apps still receive the low-latency WebSocket stream. Independently,
when at least one native app is paired, the same watcher combines execution
progress with ComfyUI's authoritative queue and publishes coalesced ActivityKit
snapshots through the relay. That second path keeps working after iOS suspends
the app and, critically, emits `done` when running and pending are both empty.
"""
import asyncio
from collections import deque
import json
import logging
import os
import time

from aiohttp import web, WSMsgType
from json_cache_io import atomic_write_json

try:
    import mobile_app_push as _mobile_app_push
except Exception:  # pragma: no cover - unavailable only outside the node
    _mobile_app_push = None

try:
    import mobile_queue_metadata as _mobile_queue_metadata
except Exception:  # pragma: no cover - labels are optional
    _mobile_queue_metadata = None

logger = logging.getLogger(__name__)

_clients = {}
_watch_task = None
_relay_task = None
_relay_pending = None
_relay_keyframes = deque()
_relay_last_sent_at = 0.0
_relay_last_routine_sent_at = 0.0
_relay_was_active = False
_relay_last_prompt_id = None
_relay_active_prompt_id = None
_relay_active_prompt_was_running = False
_relay_last_payload = None
_relay_finished_phases = {}
_workflow_cache = {}
_TICK_SECONDS = 0.1

# --- Foreground socket pacing --------------------------------------------
#
# 3.2.4 pushed every connected app a snapshot the instant the sampler moved,
# which is ~10 messages/second. On a LAN that is free. Over a hole-punched or
# relayed tunnel it is not: every message needs a TCP ack back, so the stream
# is ~20 packets/second in each direction while carrying almost no data, and
# a path that cannot sustain that rate spends its time renegotiating instead
# of delivering. So the cadence is negotiable, and coalescing is
# last-writer-wins: a slowed-down client sees fewer snapshots, never staler
# ones.
#
# A client that never negotiates keeps the 3.2.4 rate, so upgrading the node
# alone changes nothing for an app already in the field. It is still covered
# by the server-side backoff below, which is the half that does not need the
# client to cooperate.
_PROTOCOL_VERSION = 1
# The watcher's own tick is the floor: nothing can be delivered faster than
# the registry is sampled.
_MIN_CLIENT_INTERVAL_S = _TICK_SECONDS
_MAX_CLIENT_INTERVAL_S = 60.0
# How far the server will slow a client down on its own, and how many
# consecutive stalled sends it takes to do it. Deliberately well short of
# _MAX_CLIENT_INTERVAL_S: this is a link that is struggling, not a client
# that asked to idle, and the Live Activity relay is already covering the
# low-frequency case.
_BACKOFF_INTERVAL_CEILING_S = 4.0
_SLOW_SENDS_BEFORE_BACKOFF = 2

_stats = {
    "connections": 0,
    "dropped": 0,
    "slow_sends": 0,
    "backoffs": 0,
}

# Routine APNs updates remain lower-frequency than the foreground socket, but
# two seconds is granular enough to show meaningful motion in a 10–20 second
# sampler. Only routine states coalesce; prompt start/completion keyframes have
# their own FIFO and can never be overwritten by a newer sampler tick.
_RELAY_COALESCE_SECONDS = 2.0
_RELAY_HEARTBEAT_SECONDS = 30.0
_RELAY_RETRY_SECONDS = 3.0
_RELAY_PUMP_TICK_SECONDS = 0.25
# APNs timestamps have one-second precision. Spacing every outbound state by a
# little more than one second makes completion → next-start ordering explicit
# even when both transitions happen in the same ComfyUI event-loop tick.
_RELAY_MIN_SEND_GAP_SECONDS = 1.1
_WORKFLOW_CACHE_SECONDS = 30.0
_QUEUE_METADATA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".cache", "queue_metadata_cache.json"
)
_RELAY_STATE_VERSION = 1


class _ClientState:
    """Pacing state for one connected foreground socket."""

    __slots__ = ("interval", "negotiated", "forced", "last_sent",
                 "last_prompt_id", "pending", "slow_sends", "lock")

    def __init__(self):
        # Zero, not one tick: an un-negotiated client must be bit-for-bit
        # 3.2.4 — every change, the moment it happens. Gating it on an
        # interval equal to the tick sounds equivalent but is not, because
        # the two clocks jitter against each other and occasional changes
        # get coalesced away. Upgrading the node alone changes nothing.
        self.interval = 0.0
        # Distinguishes "asked for this rate" from "left at the default", so
        # server-side backoff can be reported back as advice rather than
        # silently overriding what the client requested.
        self.negotiated = False
        # Set once the server has had to slow this client down on its own.
        # Sticky for the life of the connection: it is live evidence about
        # this link, and a later re-probe must not be able to talk past it.
        self.forced = False
        self.last_sent = 0.0
        # Sentinel, not None: an idle registry reports prompt_id None, and the
        # first snapshot must count as an edge either way.
        self.last_prompt_id = _UNSET
        self.pending = None
        self.slow_sends = 0
        # aiohttp does not serialise writers. Pongs are answered on the read
        # task while the watch loop may be mid-send on the same socket, and
        # interleaved frames would corrupt the stream.
        self.lock = asyncio.Lock()


_UNSET = object()


def _now():
    return asyncio.get_running_loop().time()


def _clamp_interval(value):
    """A client's requested milliseconds as seconds, or None if unusable."""
    try:
        ms = float(value)
    except (TypeError, ValueError):
        return None
    if ms != ms or ms in (float("inf"), float("-inf")):
        return None
    return min(max(ms / 1000.0, _MIN_CLIENT_INTERVAL_S), _MAX_CLIENT_INTERVAL_S)


def _relay_state_path():
    if _mobile_app_push is not None:
        push_dir = getattr(_mobile_app_push, "_push_dir", None)
        if callable(push_dir):
            return os.path.join(push_dir(), "live_activity_relay_state.json")
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        ".cache",
        "live_activity_relay_state.json",
    )


def _save_relay_state():
    """Atomically persist semantic lifecycle state and the keyframe outbox."""
    state = {
        "version": _RELAY_STATE_VERSION,
        "was_active": _relay_was_active,
        "last_prompt_id": _relay_last_prompt_id,
        "active_prompt_id": _relay_active_prompt_id,
        "active_prompt_was_running": _relay_active_prompt_was_running,
        "last_payload": _relay_last_payload,
        "finished_phases": dict(_relay_finished_phases),
        # Monotonic retry deadlines cannot survive a reboot. Only payloads are
        # durable; restored entries become immediately eligible for delivery.
        "keyframes": [payload for payload, _ in _relay_keyframes],
    }
    try:
        atomic_write_json(_relay_state_path(), state, prefix=".live_activity_relay.")
    except Exception as exc:
        logger.warning("[Mobile Live Activity] failed to save relay state: %s", exc)


def _restore_relay_state():
    global _relay_was_active, _relay_last_prompt_id
    global _relay_active_prompt_id, _relay_active_prompt_was_running
    global _relay_last_payload, _relay_finished_phases
    path = _relay_state_path()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            state = json.load(handle)
    except FileNotFoundError:
        return
    except Exception as exc:
        logger.warning("[Mobile Live Activity] failed to restore relay state: %s", exc)
        return
    if not isinstance(state, dict) or state.get("version") != _RELAY_STATE_VERSION:
        return
    _relay_was_active = state.get("was_active") is True
    _relay_last_prompt_id = state.get("last_prompt_id") \
        if isinstance(state.get("last_prompt_id"), str) else None
    _relay_active_prompt_id = state.get("active_prompt_id") \
        if isinstance(state.get("active_prompt_id"), str) else None
    _relay_active_prompt_was_running = state.get("active_prompt_was_running") is True
    last_payload = state.get("last_payload")
    if isinstance(last_payload, dict):
        _relay_last_payload = dict(last_payload)
        # Older releases persisted the prompt start time for an elapsed timer.
        # Do not let that removed field escape again after an in-place upgrade.
        _relay_last_payload.pop("started_at", None)
    else:
        _relay_last_payload = None
    phases = state.get("finished_phases")
    _relay_finished_phases = {
        key: value
        for key, value in (phases.items() if isinstance(phases, dict) else [])
        if isinstance(key, str) and value in ("done", "error")
    }
    _relay_keyframes.clear()
    for payload in state.get("keyframes", []):
        if isinstance(payload, dict) and payload.get("delivery") == "keyframe":
            restored_payload = dict(payload)
            restored_payload.pop("started_at", None)
            _relay_keyframes.append((restored_payload, 0.0))


def _node_totals(registry, NodeState):
    """Overall progress for the prompt, as a count of nodes rather than steps.

    `value`/`max` below describe whichever node is running *right now*, so they
    restart at zero every time execution moves to the next node — a client
    drawing them as one bar sees the percentage fall back to 0 mid-generation.
    That is what these two fields fix, and they are counted the same way
    ComfyUI's own web frontend counts them: finished nodes over total nodes,
    never per-step.

    Cached nodes are included on both sides of the ratio, because
    `execution.py` calls `finish_progress` for a cache hit just as it does for
    real work. So a re-run with most of the graph cached races forward and then
    finishes, rather than stalling at a low number and jumping at the end.

    `all_node_ids()` covers ephemeral nodes too, so the total can still grow
    mid-run when a node expands into a subgraph. That is rare, and a total that
    grows is far less jarring than a value that resets.
    """
    done_states = (NodeState.Finished, NodeState.Error)
    done = sum(1 for n in registry.nodes.values() if n.get('state') in done_states)
    total = 0
    dynprompt = getattr(registry, 'dynprompt', None)
    if dynprompt is not None:
        try:
            total = len(dynprompt.all_node_ids())
        except Exception:
            total = 0
    # Never report more done than total; a client dividing the two should not
    # have to defend against a ratio above 1.
    if total and done > total:
        done = total
    return total, done


def _running_node_name(registry, node_id):
    """A human label for the node currently executing.

    Prefers the title the user gave the node in the graph, falling back to its
    class type. A client showing "Generating" for two minutes tells you nothing;
    "KSampler" or "Upscale (2x)" tells you where in the workflow you are.

    Every lookup is defensive: this runs on the node's event loop inside a 0.1s
    tick, and a malformed or mid-expansion prompt must degrade to no label
    rather than take the socket down for every connected client.
    """
    dynprompt = getattr(registry, 'dynprompt', None)
    if dynprompt is None or node_id is None:
        return None
    try:
        node = dynprompt.get_node(node_id)
    except Exception:
        return None
    if not isinstance(node, dict):
        return None
    meta = node.get('_meta')
    if isinstance(meta, dict):
        title = meta.get('title')
        if isinstance(title, str) and title.strip():
            return title.strip()
    class_type = node.get('class_type')
    return class_type if isinstance(class_type, str) and class_type else None


def _snapshot():
    from comfy_execution.progress import get_progress_state, NodeState
    registry = get_progress_state()
    if not registry.prompt_id:
        return {
            "prompt_id": None, "value": 0, "max": 0,
            "nodes_total": 0, "nodes_done": 0, "node_name": None,
        }
    total, done = _node_totals(registry, NodeState)
    running_id, running = next(
        (
            (nid, n) for nid, n in registry.nodes.items()
            if n.get('state') == NodeState.Running
        ),
        (None, None),
    )
    if running is None:
        return {
            "prompt_id": registry.prompt_id,
            "value": 0,
            "max": 0,
            "nodes_total": total,
            "nodes_done": done,
            "node_name": None,
        }
    return {
        "prompt_id": registry.prompt_id,
        "value": running.get('value', 0),
        "max": running.get('max', 0),
        "nodes_total": total,
        "nodes_done": done,
        "node_name": _running_node_name(registry, running_id),
    }


def _current_queue_entries():
    """Return (running, pending), or None when ComfyUI is not ready.

    An unavailable queue is deliberately different from an empty queue. Only
    the latter is authoritative enough to end a remotely updated activity.
    """
    try:
        import server
        instance = getattr(server.PromptServer, "instance", None)
        prompt_queue = getattr(instance, "prompt_queue", None)
        get_current_queue = getattr(prompt_queue, "get_current_queue", None)
        if not callable(get_current_queue):
            return None
        current = get_current_queue()
        if not isinstance(current, (tuple, list)) or len(current) != 2:
            return None
        running, pending = current
        if not isinstance(running, (tuple, list)) or not isinstance(pending, (tuple, list)):
            return None
        return list(running), list(pending)
    except Exception as exc:
        logger.debug("[Mobile Progress WS] queue read failed: %s", exc)
        return None


def _entry_prompt_id(entry):
    # Core PromptQueue entries are (number, prompt_id, prompt, extra_data,
    # outputs_to_execute). Accept a dict too so this remains resilient if core
    # eventually exposes a named representation.
    if isinstance(entry, (tuple, list)) and len(entry) > 1:
        value = entry[1]
    elif isinstance(entry, dict):
        value = entry.get("prompt_id") or entry.get("promptId")
    else:
        return None
    return value if isinstance(value, str) and value else None


def _workflow_label(prompt_id):
    if not prompt_id or _mobile_queue_metadata is None:
        return None
    now = time.monotonic()
    cached = _workflow_cache.get(prompt_id)
    if cached is not None and now - cached[0] < _WORKFLOW_CACHE_SECONDS:
        return cached[1]
    label = None
    try:
        metadata = _mobile_queue_metadata.get_prompt_metadata(
            _QUEUE_METADATA_PATH, [prompt_id]
        ).get(prompt_id, {})
        value = metadata.get("workflowLabel") if isinstance(metadata, dict) else None
        if isinstance(value, str) and value.strip():
            label = value.strip()[:200]
    except Exception as exc:
        logger.debug("[Mobile Progress WS] workflow label read failed: %s", exc)
    if len(_workflow_cache) >= 64:
        _workflow_cache.clear()
    _workflow_cache[prompt_id] = (now, label)
    return label


def _fraction(value, maximum):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if not isinstance(maximum, (int, float)) or isinstance(maximum, bool) or maximum <= 0:
        return None
    return min(max(float(value) / float(maximum), 0.0), 1.0)


def _live_activity_payload(snapshot, running, pending, terminal_prompt_id=None,
                           terminal_phase=None):
    """Map one queue/progress sample to the relay's bounded wire contract."""
    if terminal_phase is not None:
        prompt_id = terminal_prompt_id
        phase = terminal_phase
    elif running:
        prompt_id = _entry_prompt_id(running[0]) or snapshot.get("prompt_id")
        phase = "generating"
    elif pending:
        prompt_id = _entry_prompt_id(pending[0]) or snapshot.get("prompt_id")
        phase = "queued"
    else:
        return None

    terminal = phase in ("done", "error")
    same_prompt = prompt_id is not None and snapshot.get("prompt_id") == prompt_id
    node_fraction = _fraction(snapshot.get("value"), snapshot.get("max")) if same_prompt else None
    nodes_total = snapshot.get("nodes_total") if same_prompt else 0
    nodes_done = snapshot.get("nodes_done") if same_prompt else 0
    if not isinstance(nodes_total, int) or nodes_total < 0:
        nodes_total = 0
    if not isinstance(nodes_done, int) or nodes_done < 0:
        nodes_done = 0
    if nodes_total > 0:
        overall = (min(nodes_done, nodes_total) + (node_fraction or 0.0)) / nodes_total
    else:
        overall = node_fraction or 0.0
    if not terminal:
        overall = min(overall, 0.99)

    node_name = snapshot.get("node_name") if same_prompt and phase == "generating" else None
    if not isinstance(node_name, str) or not node_name:
        node_name = None
    node_index = min(nodes_done + 1, nodes_total) if node_name and nodes_total > 0 else None
    return {
        "phase": phase,
        "progress": 1.0 if terminal else (0.0 if phase == "queued" else overall),
        "queue_position": 0 if terminal else len(pending),
        "prompt_id": prompt_id,
        "node_name": node_name,
        "workflow_label": _workflow_label(prompt_id),
        "node_index": node_index,
        "node_count": nodes_total if node_index is not None else None,
        "node_progress": node_fraction if node_name else None,
    }


def _relay_controlled(payload, delivery="routine", activity_event="update"):
    """Attach relay-only controls that never enter ActivityKit ContentState."""
    return {
        **dict(payload),
        "delivery": delivery,
        "activity_event": activity_event,
    }


def _relay_start_payload(payload):
    """A deterministic zero-percent frame for a newly running prompt."""
    started = dict(payload)
    started["progress"] = 0.0
    if started.get("node_name"):
        started["node_progress"] = 0.0
    return _relay_controlled(started, delivery="keyframe")


def _relay_completion_payload(prompt_id, phase, queue_position):
    """A per-prompt 100% frame that updates, but does not end, the activity."""
    previous = (
        _relay_last_payload
        if isinstance(_relay_last_payload, dict)
        and _relay_last_payload.get("prompt_id") == prompt_id
        else {}
    )
    return _relay_controlled({
        "phase": "error" if phase == "error" else "done",
        "progress": 1.0,
        "queue_position": max(0, queue_position),
        "prompt_id": prompt_id,
        "node_name": None,
        "workflow_label": previous.get("workflow_label") or _workflow_label(prompt_id),
        "node_index": None,
        "node_count": None,
        "node_progress": None,
    }, delivery="keyframe")


def _relay_snapshot(snapshot):
    """Return ordered relay events for one authoritative queue observation.

    Routine progress is a single latest-value stream. Prompt boundaries are a
    pair of keyframes — 100% for the old prompt, then 0% for the new prompt —
    and queue-empty adds a final ActivityKit `end` after the completion frame.
    """
    global _relay_was_active, _relay_last_prompt_id
    global _relay_active_prompt_id, _relay_active_prompt_was_running
    global _relay_last_payload
    queue = _current_queue_entries()
    if queue is None:
        return []
    running, pending = queue
    if running or pending:
        payload = _live_activity_payload(snapshot, running, pending)
        if payload is None:
            return []
        prompt_id = payload.get("prompt_id")
        is_running = bool(running) and _entry_prompt_id(running[0]) == prompt_id
        events = []
        if prompt_id != _relay_active_prompt_id:
            if _relay_active_prompt_id and _relay_active_prompt_was_running:
                phase = _relay_finished_phases.pop(_relay_active_prompt_id, "done")
                events.append(_relay_completion_payload(
                    _relay_active_prompt_id,
                    phase,
                    len(running) + len(pending),
                ))
            _relay_active_prompt_id = prompt_id
            _relay_active_prompt_was_running = is_running
            _relay_last_payload = payload
            if is_running:
                events.append(_relay_start_payload(payload))
            else:
                events.append(_relay_controlled(payload))
        elif is_running and not _relay_active_prompt_was_running:
            _relay_active_prompt_was_running = True
            _relay_last_payload = payload
            events.append(_relay_start_payload(payload))
        else:
            _relay_last_payload = payload
            events.append(_relay_controlled(payload))
        _relay_was_active = True
        if prompt_id:
            _relay_last_prompt_id = prompt_id
        return events
    if not _relay_was_active:
        # Do not fire an idle `end` merely because the server/app paired while
        # no generation existed. We need a real active -> empty transition.
        return []
    prompt_id = _relay_active_prompt_id or _relay_last_prompt_id
    recorded_phase = _relay_finished_phases.pop(prompt_id, None)
    # A prompt that was only ever queued — cancelled or cleared before
    # execution reached it — has no completion to report. The prompt-change
    # branch above already gates its completion frame on
    # `_relay_active_prompt_was_running`; the queue-drain path has to make the
    # same distinction, or a cancelled prompt tells the Live Activity that a
    # generation finished at 100% when it never ran a single node.
    never_started = bool(_relay_active_prompt_id) and not _relay_active_prompt_was_running
    events = []
    if recorded_phase is not None or not never_started:
        ending_base = _relay_completion_payload(
            prompt_id, recorded_phase or "done", 0
        )
        events.append(ending_base)
    else:
        # End from the last real state (a `queued` frame at 0%) rather than
        # inventing either a completion or a new phase the app would have to
        # learn. The activity still closes; it just doesn't claim success.
        ending_base = _relay_controlled(
            {**(_relay_last_payload or {"prompt_id": prompt_id}), "queue_position": 0},
            delivery="keyframe",
        )
    events.append({**ending_base, "activity_event": "end"})
    _relay_was_active = False
    _relay_active_prompt_id = None
    _relay_active_prompt_was_running = False
    _relay_last_payload = None
    return events


def _relay_available():
    try:
        return (
            _mobile_app_push is not None
            and _mobile_app_push.is_available()
            and _mobile_app_push.live_activity_target_count() > 0
        )
    except Exception:
        return False


def _queue_relay(payload):
    """Queue keyframes losslessly while retaining only the newest routine state."""
    global _relay_pending, _relay_task
    item = (dict(payload), 0.0)
    if payload.get("delivery") == "keyframe":
        # A routine snapshot from before this semantic transition must never
        # arrive afterward and make the Live Activity move backwards.
        _relay_pending = None
        _relay_keyframes.append(item)
        _save_relay_state()
    else:
        _relay_pending = item
    if _relay_task is None or _relay_task.done():
        _relay_task = asyncio.ensure_future(_relay_send_loop())


async def _relay_send_loop():
    global _relay_pending, _relay_task, _relay_last_sent_at
    global _relay_last_routine_sent_at
    this_task = asyncio.current_task()
    try:
        while _relay_keyframes or _relay_pending is not None:
            is_keyframe = bool(_relay_keyframes)
            if is_keyframe:
                payload, not_before = _relay_keyframes[0]
            else:
                payload, not_before = _relay_pending
            loop = asyncio.get_running_loop()
            now = loop.time()
            due = max(not_before, _relay_last_sent_at + _RELAY_MIN_SEND_GAP_SECONDS)
            if not is_keyframe:
                due = max(due, _relay_last_routine_sent_at + _RELAY_COALESCE_SECONDS)
            if now < due:
                await asyncio.sleep(min(due - now, _RELAY_PUMP_TICK_SECONDS))
                continue

            if not is_keyframe:
                # Clear only the routine sample being sent. A fresher snapshot
                # arriving during the executor call remains pending.
                _relay_pending = None
            try:
                result = await loop.run_in_executor(
                    None, _mobile_app_push.send_live_activity, payload
                )
            except Exception as exc:
                logger.warning("[Mobile Live Activity] relay dispatch failed: %s", exc)
                result = {"sent": 0, "pruned": 0, "total": 1}
            _relay_last_sent_at = loop.time()
            if not is_keyframe:
                _relay_last_routine_sent_at = _relay_last_sent_at

            sent = result.get("sent", 0) if isinstance(result, dict) else 0
            pruned = result.get("pruned", 0) if isinstance(result, dict) else 0
            total = result.get("total", 0) if isinstance(result, dict) else 0
            retryable = result.get("retryable") if isinstance(result, dict) else None
            failed = result.get("failed", 0) if isinstance(result, dict) else 0
            # "Delivered" means nothing is left that a retry could still help.
            # A non-retryable rejection (`failed`) is not a success, but keeping
            # the keyframe for it would wedge the FIFO forever behind a target
            # that will never accept it — so it is dropped, loudly rather than
            # silently, since that device's activity is now stranded on
            # whatever frame it last received.
            delivered = retryable == 0 if isinstance(retryable, int) else sent + pruned >= total
            if is_keyframe:
                if delivered:
                    if failed:
                        logger.warning(
                            "[Mobile Live Activity] dropping %s keyframe for prompt %s: "
                            "%d of %d target(s) rejected it non-retryably",
                            payload.get("phase"), payload.get("prompt_id"), failed, total,
                        )
                    _relay_keyframes.popleft()
                else:
                    # Start, per-prompt completion, and final-end events are
                    # semantic state. Keep the same durable FIFO head until it
                    # is accepted; a later start can never overtake it.
                    _relay_keyframes[0] = (
                        payload, loop.time() + _RELAY_RETRY_SECONDS
                    )
                _save_relay_state()
    finally:
        if _relay_task is this_task:
            _relay_task = None
        # Cover a sample queued in the narrow cancellation/exit window.
        if (_relay_keyframes or _relay_pending is not None) and _relay_task is None:
            _relay_task = asyncio.ensure_future(_relay_send_loop())


# Upper bound on how long one client's send may hold up a broadcast. The
# broadcast sits on the completion-notification path (mobile_push awaits
# broadcast_finished before dispatching pushes), so a suspended/backgrounded
# client whose socket buffer is full must not delay everyone else's
# notification.
_SEND_TIMEOUT_S = 2.0


async def _send_one(ws, message, state=None):
    """Send to one client.

    Returns "ok", "slow" (the send did not complete inside the timeout) or
    "failed" (the socket is gone). The two failure modes deserve different
    treatment. A stalled send means the link is behind; dropping the socket
    for that forces a reconnect, which is more packets over exactly the path
    that is already struggling, so the caller slows that client down instead.
    A genuinely dead socket is still dropped.
    """
    try:
        if state is None:
            await asyncio.wait_for(ws.send_str(message), timeout=_SEND_TIMEOUT_S)
        else:
            await asyncio.wait_for(
                _send_locked(ws, state, message), timeout=_SEND_TIMEOUT_S
            )
        return "ok"
    except asyncio.TimeoutError:
        _stats["slow_sends"] += 1
        return "slow"
    except Exception:
        return "failed"


async def _send_locked(ws, state, message):
    """Serialise writes to one socket.

    aiohttp does not lock its writer, and pongs are answered on the read task
    while the watch loop may be mid-send on the same connection.
    """
    async with state.lock:
        await ws.send_str(message)


async def _close_quietly(ws):
    try:
        await asyncio.wait_for(ws.close(), timeout=_SEND_TIMEOUT_S)
    except Exception:
        pass


async def _broadcast(snapshot, immediate=False):
    """Queue a snapshot for every client, then deliver whoever is due for one."""
    if not _clients:
        return
    for state in _clients.values():
        state.pending = snapshot
    await _flush(immediate=immediate)


async def _flush(immediate=False):
    """Send each client its pending snapshot, if its cadence allows it now.

    Coalescing is last-writer-wins rather than queued: a client on a slow
    cadence drops the snapshots in between instead of accumulating a backlog,
    so what it renders is always the newest state the server has.
    """
    if not _clients:
        return
    now = _now()
    due = []
    for ws, state in list(_clients.items()):
        snapshot = state.pending
        if snapshot is None:
            continue
        # A prompt starting, changing or ending is a semantic edge, not a
        # sampler tick. Those go out at once whatever cadence is in force, so
        # a slowed-down client still resolves its UI in step with the run
        # rather than up to a full interval behind it.
        edge = snapshot.get("prompt_id") != state.last_prompt_id
        if not (immediate or edge or now - state.last_sent >= state.interval):
            continue
        state.pending = None
        state.last_sent = now
        state.last_prompt_id = snapshot.get("prompt_id")
        due.append((ws, state, json.dumps(snapshot)))
    if not due:
        return
    # Concurrent + time-bounded: one slow client costs at most _SEND_TIMEOUT_S
    # for the whole flush instead of stacking up serially.
    results = await asyncio.gather(
        *(_send_one(ws, message, state) for ws, state, message in due),
        return_exceptions=True,
    )
    for (ws, state, _message), outcome in zip(due, results):
        if outcome == "ok":
            state.slow_sends = 0
        elif outcome == "slow":
            state.slow_sends += 1
            if state.slow_sends >= _SLOW_SENDS_BEFORE_BACKOFF:
                _back_off(ws, state)
        else:
            _drop(ws)


def _back_off(ws, state):
    """Halve a struggling client's rate and tell it why.

    This is the half of the cadence control that does not need the client to
    cooperate: an app too old to understand the advice still gets the slower
    stream, which is the part that protects the link.
    """
    state.slow_sends = 0
    if state.interval >= _BACKOFF_INTERVAL_CEILING_S:
        return
    state.forced = True
    # An un-negotiated client sits at zero, so back off from the tick floor
    # rather than doubling nothing.
    base = state.interval if state.interval > 0 else _MIN_CLIENT_INTERVAL_S
    state.interval = min(base * 2, _BACKOFF_INTERVAL_CEILING_S)
    _stats["backoffs"] += 1
    logger.info(
        "[Mobile Progress WS] client not keeping up; slowing it to %dms",
        round(state.interval * 1000),
    )
    # Fire-and-forget: this client has just proved it can stall for the full
    # send timeout, and awaiting the advice would hold up the whole flush.
    asyncio.ensure_future(_send_one(ws, json.dumps({
        "type": "rate_advice",
        "interval_ms": round(state.interval * 1000),
        "reason": "slow_send",
    }), state))


def _drop(ws):
    _clients.pop(ws, None)
    _stats["dropped"] += 1
    # A cancelled/failed write leaves the socket in an unknown state; close it
    # in the background so the client reconnects cleanly rather than sitting on
    # a half-dead connection.
    asyncio.ensure_future(_close_quietly(ws))


async def _watch_loop():
    last_socket_snapshot = None
    last_relay_snapshot = None
    last_relay_enqueued_at = 0.0
    while True:
        await asyncio.sleep(_TICK_SECONDS)
        # Deliver whatever a slowed-down client is still holding, including on
        # ticks where the snapshot itself did not change — otherwise its last
        # update would sit in `pending` until something else moved.
        if _clients:
            await _flush()
        relay_available = _relay_available()
        if not _clients and not relay_available:
            continue
        try:
            snapshot = _snapshot()
        except Exception as exc:
            logger.debug("[Mobile Progress WS] snapshot failed: %s", exc)
            continue
        if _clients and snapshot != last_socket_snapshot:
            last_socket_snapshot = snapshot
            await _broadcast(snapshot)

        if relay_available:
            relay_events = _relay_snapshot(snapshot)
            for payload in relay_events:
                if payload.get("delivery") == "keyframe":
                    _queue_relay(payload)
                    continue
                now = asyncio.get_running_loop().time()
                heartbeat_due = (
                    now - last_relay_enqueued_at >= _RELAY_HEARTBEAT_SECONDS
                )
                if payload != last_relay_snapshot or heartbeat_due:
                    last_relay_snapshot = payload
                    last_relay_enqueued_at = now
                    _queue_relay(payload)


async def _handle_control(ws, state, data):
    """The client→server half of the socket.

    3.2.4 read this direction only to notice the socket closing. It now
    carries cadence negotiation and the app's link probe. Anything
    unrecognised is ignored rather than closed on, so an app newer than the
    node degrades to whatever this build understands.
    """
    try:
        payload = json.loads(data)
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    kind = payload.get("type")

    if kind == "ping":
        # Echoed straight back from the read task, so a probe measures the
        # socket's real round trip — including any time it spends queued
        # behind a broadcast, which is exactly what a struggling link does.
        await _send_one(ws, json.dumps({
            "type": "pong",
            "seq": payload.get("seq"),
            "t": payload.get("t"),
            "server_ms": round(time.time() * 1000),
        }), state)
        return

    if kind in ("hello", "rate"):
        requested = _clamp_interval(payload.get("min_interval_ms"))
        if requested is not None:
            state.negotiated = True
            # Never let a client talk its way back up past a rate the server
            # already had to force on it — the app re-probes and asks again
            # after a good run, and that ask must not undo live evidence that
            # this link cannot take it.
            state.interval = (
                max(requested, state.interval) if state.forced else requested
            )
            state.slow_sends = 0
        await _send_one(ws, json.dumps({
            "type": "hello_ack",
            "protocol": _PROTOCOL_VERSION,
            "interval_ms": round(state.interval * 1000),
            "tick_ms": round(_TICK_SECONDS * 1000),
            "min_interval_ms": round(_MIN_CLIENT_INTERVAL_S * 1000),
            "max_interval_ms": round(_MAX_CLIENT_INTERVAL_S * 1000),
        }), state)


async def api_progress_ws(request):
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    state = _ClientState()
    # Send the current state right away — the watch loop only broadcasts on
    # change, which would otherwise leave a client that connects mid-run
    # blank until the next tick.
    try:
        snapshot = _snapshot()
    except Exception:
        snapshot = None
    if snapshot is not None:
        state.last_prompt_id = snapshot.get("prompt_id")
        state.last_sent = _now()
        await _send_one(ws, json.dumps(snapshot), state)
    _clients[ws] = state
    _stats["connections"] += 1
    try:
        async for msg in ws:
            if msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE, WSMsgType.CLOSING):
                break
            if msg.type == WSMsgType.TEXT:
                await _handle_control(ws, state, msg.data)
    finally:
        _clients.pop(ws, None)
    return ws


def stats():
    """What the socket has actually had to do, for the app's diagnostic.

    `slow_sends` is the number that matters: 3.2.4 already detected a client
    it could not keep up with and then threw that signal away. Counting it
    is what turns "my connection felt bad last night" into evidence.
    """
    return {
        "protocol": _PROTOCOL_VERSION,
        "tickMs": round(_TICK_SECONDS * 1000),
        "minIntervalMs": round(_MIN_CLIENT_INTERVAL_S * 1000),
        "maxIntervalMs": round(_MAX_CLIENT_INTERVAL_S * 1000),
        "clients": len(_clients),
        "clientIntervalsMs": sorted(
            round(state.interval * 1000) for state in _clients.values()
        ),
        "connections": _stats["connections"],
        "droppedClients": _stats["dropped"],
        "slowSends": _stats["slow_sends"],
        "backoffs": _stats["backoffs"],
    }


async def api_progress_ws_stats(request):
    return web.json_response(stats())


async def broadcast_finished(prompt_id, status=None):
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
    if prompt_id:
        _relay_finished_phases[prompt_id] = "error" if status == "error" else "done"
        # UUID prompt ids make unbounded growth unlikely in one process, but a
        # server that renders for months should still have a hard ceiling.
        if len(_relay_finished_phases) > 256:
            oldest = next(iter(_relay_finished_phases))
            _relay_finished_phases.pop(oldest, None)
        _save_relay_state()
    # Never coalesced: this is the sharp edge the app resolves its UI on, and
    # it is deliberately timed with the push notification's dispatch.
    await _broadcast({"type": "finished", "prompt_id": prompt_id}, immediate=True)


async def on_startup(app):
    global _watch_task, _relay_task
    _restore_relay_state()
    if _relay_keyframes and _relay_available():
        _relay_task = asyncio.ensure_future(_relay_send_loop())
    _watch_task = asyncio.ensure_future(_watch_loop())


async def on_cleanup(app):
    global _watch_task, _relay_task, _relay_pending
    if _watch_task is not None:
        _watch_task.cancel()
        try:
            await _watch_task
        except (asyncio.CancelledError, Exception):
            pass
        _watch_task = None
    # Do not restart the relay pump from its finally block during shutdown.
    _relay_pending = None
    _relay_keyframes.clear()
    if _relay_task is not None:
        _relay_task.cancel()
        try:
            await _relay_task
        except (asyncio.CancelledError, Exception):
            pass
        _relay_task = None
    for ws in list(_clients):
        await ws.close()
    _clients.clear()
