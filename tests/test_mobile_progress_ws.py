"""Tests for the Live Activity progress channel.

The app's progress ring is driven entirely by what this module pushes, so the
properties that matter are: the snapshot faithfully reports the registry (and
degrades to a well-formed idle payload rather than raising), broadcasts only go
out on an actual change, and a socket that goes away is dropped instead of
accumulating. `comfy_execution.progress` is a ComfyUI-runtime import, so it's
stubbed here — mirroring how the node imports it lazily inside `_snapshot`.
"""
import asyncio
import json
import sys
import types

import pytest


class _NodeState:
    Running = "running"
    Pending = "pending"
    Finished = "finished"
    Error = "error"


class _DynPrompt:
    def __init__(self, node_ids=(), graph=None):
        self._ids = set(node_ids)
        self._graph = graph or {}

    def all_node_ids(self):
        return self._ids

    def get_node(self, node_id):
        return self._graph[node_id]


class _Registry:
    def __init__(self, prompt_id=None, nodes=None, node_ids=None, graph=None):
        self.prompt_id = prompt_id
        self.nodes = nodes or {}
        # Real registries always carry one; tests that predate node counting
        # get a dynprompt covering exactly the nodes they declared.
        self.dynprompt = _DynPrompt(
            node_ids if node_ids is not None else (nodes or {}).keys(),
            graph=graph,
        )


_registry = _Registry()


def _install_comfy_stub():
    """Stand in for comfy_execution.progress, which only exists in a server."""
    package = types.ModuleType("comfy_execution")
    module = types.ModuleType("comfy_execution.progress")
    module.NodeState = _NodeState
    module.get_progress_state = lambda: _registry
    package.progress = module
    sys.modules.setdefault("comfy_execution", package)
    sys.modules["comfy_execution.progress"] = module


_install_comfy_stub()

import mobile_progress_ws as m  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    global _registry
    _registry = _Registry()
    sys.modules["comfy_execution.progress"].get_progress_state = lambda: _registry
    m._clients.clear()
    monkeypatch.setattr(m, "_mobile_app_push", None)
    monkeypatch.setattr(
        m, "_relay_state_path", lambda: str(tmp_path / "live_activity_relay_state.json")
    )
    m._relay_task = None
    m._relay_pending = None
    m._relay_keyframes.clear()
    m._relay_last_sent_at = 0.0
    m._relay_last_routine_sent_at = 0.0
    m._relay_was_active = False
    m._relay_last_prompt_id = None
    m._relay_active_prompt_id = None
    m._relay_active_prompt_was_running = False
    m._relay_last_payload = None
    m._relay_finished_phases.clear()
    m._workflow_cache.clear()
    yield
    m._clients.clear()


class FakeWS:
    """Enough of aiohttp's WebSocketResponse for this module's use of it."""

    def __init__(self, incoming=None, fail_on_send=False, **_kwargs):
        self.sent = []
        self.prepared = False
        self.closed = False
        self.fail_on_send = fail_on_send
        self._incoming = list(incoming or [])

    async def prepare(self, _request):
        self.prepared = True

    async def send_str(self, message):
        if self.fail_on_send:
            raise ConnectionResetError("client gone")
        self.sent.append(message)

    async def close(self):
        self.closed = True

    def __aiter__(self):
        async def gen():
            for msg in self._incoming:
                yield msg
        return gen()

    @property
    def payloads(self):
        return [json.loads(s) for s in self.sent]


def _running(prompt_id="p1", value=3, maximum=10):
    return _Registry(
        prompt_id=prompt_id,
        nodes={"1": {"state": _NodeState.Running, "value": value, "max": maximum}},
    )


def _queue_entry(prompt_id):
    return (0, prompt_id, {}, {}, [])


# --- snapshot -------------------------------------------------------------

def test_snapshot_is_idle_when_nothing_has_run():
    assert m._snapshot() == {
        "prompt_id": None, "value": 0, "max": 0, "nodes_total": 0, "nodes_done": 0,
        "node_name": None,
    }


def test_snapshot_reports_the_running_node():
    global _registry
    _registry = _running(value=4, maximum=20)
    assert m._snapshot() == {
        "prompt_id": "p1", "value": 4, "max": 20, "nodes_total": 1, "nodes_done": 0,
        "node_name": None,
    }


def test_snapshot_keeps_the_prompt_id_between_nodes():
    """The registry holds the last prompt's id until a new prompt starts, and
    no node is Running in the gap between two nodes of the same prompt. Zeroing
    the fraction while keeping the id is what lets the client tell "still this
    prompt, no tick yet" from "idle"."""
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={"1": {"state": _NodeState.Finished, "value": 10, "max": 10}},
    )
    assert m._snapshot() == {
        "prompt_id": "p1", "value": 0, "max": 0, "nodes_total": 1, "nodes_done": 1,
        "node_name": None,
    }


def test_snapshot_tolerates_a_running_node_without_progress_fields():
    global _registry
    _registry = _Registry(prompt_id="p1", nodes={"1": {"state": _NodeState.Running}})
    assert m._snapshot() == {
        "prompt_id": "p1", "value": 0, "max": 0, "nodes_total": 1, "nodes_done": 0,
        "node_name": None,
    }


# --- remote Live Activity state ------------------------------------------

def test_live_activity_payload_uses_authoritative_pending_count(monkeypatch):
    monkeypatch.setattr(m, "_workflow_label", lambda prompt_id: "Portrait Studio")
    snapshot = {
        "prompt_id": "p1", "value": 5, "max": 10,
        "nodes_total": 4, "nodes_done": 2, "node_name": "KSampler",
    }
    payload = m._live_activity_payload(
        snapshot,
        [_queue_entry("p1")],
        [_queue_entry("p2"), _queue_entry("p3")],
    )

    assert payload == {
        "phase": "generating",
        "progress": 0.625,
        "queue_position": 2,
        "prompt_id": "p1",
        "node_name": "KSampler",
        "workflow_label": "Portrait Studio",
        "node_index": 3,
        "node_count": 4,
        "node_progress": 0.5,
    }


def test_live_activity_queued_payload_uses_the_next_prompt(monkeypatch):
    monkeypatch.setattr(m, "_workflow_label", lambda prompt_id: None)
    payload = m._live_activity_payload(
        {
            "prompt_id": "old", "value": 10, "max": 10,
            "nodes_total": 1, "nodes_done": 1, "node_name": None,
        },
        [],
        [_queue_entry("next"), _queue_entry("later")],
    )

    assert payload["phase"] == "queued"
    assert payload["prompt_id"] == "next"
    assert payload["queue_position"] == 2
    assert payload["progress"] == 0
    assert payload["node_name"] is None


def test_relay_emits_completion_then_end_after_active_queue_becomes_empty(monkeypatch):
    monkeypatch.setattr(m, "_workflow_label", lambda prompt_id: None)
    queues = iter([
        ([_queue_entry("p1")], [_queue_entry("p2")]),
        ([], []),
        ([], []),
    ])
    monkeypatch.setattr(m, "_current_queue_entries", lambda: next(queues))
    snapshot = {
        "prompt_id": "p1", "value": 1, "max": 2,
        "nodes_total": 1, "nodes_done": 0, "node_name": "KSampler",
    }

    [active] = m._relay_snapshot(snapshot)
    assert active["delivery"] == "keyframe"
    assert active["activity_event"] == "update"
    assert active["progress"] == 0
    assert active["queue_position"] == 1

    asyncio.run(m.broadcast_finished("p1", status="error"))
    finished, ending = m._relay_snapshot(snapshot)
    assert finished["phase"] == "error"
    assert finished["delivery"] == "keyframe"
    assert finished["activity_event"] == "update"
    assert finished["queue_position"] == 0
    assert finished["progress"] == 1
    assert ending["phase"] == "error"
    assert ending["activity_event"] == "end"

    assert m._relay_snapshot(snapshot) == []


def test_relay_preserves_completion_and_start_when_prompt_changes(monkeypatch):
    monkeypatch.setattr(m, "_workflow_label", lambda prompt_id: prompt_id)
    queues = iter([
        ([_queue_entry("p1")], [_queue_entry("p2")]),
        ([_queue_entry("p2")], []),
    ])
    monkeypatch.setattr(m, "_current_queue_entries", lambda: next(queues))

    [first_start] = m._relay_snapshot({
        "prompt_id": "p1", "value": 7, "max": 10,
        "nodes_total": 1, "nodes_done": 0, "node_name": "KSampler",
    })
    assert first_start["prompt_id"] == "p1"
    assert first_start["progress"] == 0

    completed, next_start = m._relay_snapshot({
        "prompt_id": "p2", "value": 4, "max": 10,
        "nodes_total": 1, "nodes_done": 0, "node_name": "KSampler",
    })
    assert (completed["prompt_id"], completed["phase"], completed["progress"]) == (
        "p1", "done", 1.0,
    )
    assert completed["activity_event"] == "update"
    assert (next_start["prompt_id"], next_start["phase"], next_start["progress"]) == (
        "p2", "generating", 0.0,
    )
    assert [completed["delivery"], next_start["delivery"]] == ["keyframe", "keyframe"]


def test_a_prompt_cancelled_before_it_ran_does_not_report_a_completion(monkeypatch):
    """Queued, then cleared before execution reached it.

    The prompt-change branch already refuses to invent a completion for a
    prompt that never started; the queue-drain path must agree, or the watch
    face is told a generation finished at 100% that never ran a node.
    """
    monkeypatch.setattr(m, "_workflow_label", lambda prompt_id: None)
    queues = iter([
        ([], [_queue_entry("p1")]),
        ([], []),
    ])
    monkeypatch.setattr(m, "_current_queue_entries", lambda: next(queues))
    snapshot = {"prompt_id": None, "value": 0, "max": 0,
                "nodes_total": 0, "nodes_done": 0, "node_name": None}

    [queued] = m._relay_snapshot(snapshot)
    assert queued["phase"] == "queued"
    assert queued["progress"] == 0

    events = m._relay_snapshot(snapshot)

    # Exactly one event: the end. No 100% "done" frame ahead of it.
    assert [event["activity_event"] for event in events] == ["end"]
    assert events[0]["phase"] == "queued"
    assert events[0]["progress"] == 0
    assert events[0]["queue_position"] == 0


def test_a_prompt_that_ran_still_reports_its_completion_on_drain(monkeypatch):
    # The guard above must not suppress the normal case.
    monkeypatch.setattr(m, "_workflow_label", lambda prompt_id: None)
    queues = iter([
        ([_queue_entry("p1")], []),
        ([], []),
    ])
    monkeypatch.setattr(m, "_current_queue_entries", lambda: next(queues))
    snapshot = {"prompt_id": "p1", "value": 1, "max": 2,
                "nodes_total": 1, "nodes_done": 0, "node_name": "KSampler"}

    m._relay_snapshot(snapshot)
    completion, ending = m._relay_snapshot(snapshot)

    assert completion["phase"] == "done"
    assert completion["progress"] == 1
    assert ending["activity_event"] == "end"


def test_a_queued_prompt_with_a_recorded_completion_still_reports_it(monkeypatch):
    """A history write can land while the prompt is still only *queued* from
    the watcher's point of view. A real completion record outranks the
    never-started guard."""
    monkeypatch.setattr(m, "_workflow_label", lambda prompt_id: None)
    queues = iter([
        ([], [_queue_entry("p1")]),
        ([], []),
    ])
    monkeypatch.setattr(m, "_current_queue_entries", lambda: next(queues))
    snapshot = {"prompt_id": None, "value": 0, "max": 0,
                "nodes_total": 0, "nodes_done": 0, "node_name": None}

    m._relay_snapshot(snapshot)
    asyncio.run(m.broadcast_finished("p1", status="error"))
    completion, ending = m._relay_snapshot(snapshot)

    assert completion["phase"] == "error"
    assert completion["progress"] == 1
    assert ending["activity_event"] == "end"


def test_empty_queue_without_prior_work_does_not_end_an_activity(monkeypatch):
    monkeypatch.setattr(m, "_current_queue_entries", lambda: ([], []))
    assert m._relay_snapshot({"prompt_id": None}) == []


# --- broadcast ------------------------------------------------------------

def test_broadcast_sends_json_to_every_client():
    a, b = FakeWS(), FakeWS()
    m._clients.update({a, b})
    asyncio.run(m._broadcast({"prompt_id": "p1", "value": 1, "max": 4}))
    assert a.payloads == [{"prompt_id": "p1", "value": 1, "max": 4}]
    assert b.payloads == a.payloads


def test_broadcast_drops_a_client_that_fails_and_still_serves_the_others():
    good, bad = FakeWS(), FakeWS(fail_on_send=True)
    m._clients.update({good, bad})
    asyncio.run(m._broadcast({"prompt_id": "p1", "value": 1, "max": 4}))
    assert bad not in m._clients
    assert good in m._clients
    assert len(good.payloads) == 1


def test_finished_carries_the_prompt_id_and_is_distinguishable():
    """The app keys its Live Activity completion off this, so the message has
    to be tellable apart from a progress tick without guessing."""
    client = FakeWS()
    m._clients.add(client)
    asyncio.run(m.broadcast_finished("p1"))
    assert client.payloads == [{"type": "finished", "prompt_id": "p1"}]


def test_broadcast_does_not_wait_on_a_stalled_client(monkeypatch):
    """A suspended/backgrounded client whose send never completes must not
    delay the broadcast (and therefore the completion notification) for
    everyone else. Sends run concurrently and each is time-bounded; the
    stalled client is dropped."""
    monkeypatch.setattr(m, "_SEND_TIMEOUT_S", 0.05)

    class StalledWS(FakeWS):
        async def send_str(self, message):
            await asyncio.sleep(10)

    good, stalled = FakeWS(), StalledWS()
    m._clients.update({good, stalled})

    async def run():
        loop = asyncio.get_running_loop()
        started = loop.time()
        await m._broadcast({"prompt_id": "p1", "value": 1, "max": 4})
        # Let the background close task run.
        await asyncio.sleep(0)
        return loop.time() - started

    elapsed = asyncio.run(run())
    assert elapsed < 1.0
    assert len(good.payloads) == 1
    assert stalled not in m._clients
    assert good in m._clients


def test_broadcast_with_no_clients_is_a_noop():
    asyncio.run(m._broadcast({"prompt_id": "p1", "value": 1, "max": 4}))  # must not raise


# --- watch loop -----------------------------------------------------------

def _run_watch_loop_briefly(ticks=6):
    async def main():
        task = asyncio.ensure_future(m._watch_loop())
        await asyncio.sleep(m._TICK_SECONDS * ticks)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    asyncio.run(main())


def test_watch_loop_broadcasts_once_per_change_not_per_tick(monkeypatch):
    global _registry
    monkeypatch.setattr(m, "_TICK_SECONDS", 0.01)
    _registry = _running(value=1, maximum=10)
    client = FakeWS()
    m._clients.add(client)
    _run_watch_loop_briefly()
    assert client.payloads == [{"prompt_id": "p1", "value": 1, "max": 10, "nodes_total": 1, "nodes_done": 0, "node_name": None}]


def test_watch_loop_pushes_each_new_value(monkeypatch):
    global _registry
    monkeypatch.setattr(m, "_TICK_SECONDS", 0.01)
    client = FakeWS()
    m._clients.add(client)

    async def main():
        task = asyncio.ensure_future(m._watch_loop())
        for value in (1, 2, 3):
            global _registry
            _registry = _running(value=value, maximum=10)
            await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(main())
    assert [p["value"] for p in client.payloads] == [1, 2, 3]


def test_watch_loop_skips_the_registry_read_entirely_with_no_clients(monkeypatch):
    """The loop runs for the life of the server, so the idle path has to stay
    off the registry rather than polling it ten times a second for nobody."""
    monkeypatch.setattr(m, "_TICK_SECONDS", 0.01)
    calls = []
    monkeypatch.setattr(m, "_snapshot", lambda: calls.append(1) or {"prompt_id": None, "value": 0, "max": 0})
    _run_watch_loop_briefly()
    assert calls == []


def test_watch_loop_keeps_sampling_for_relay_with_no_socket_clients(monkeypatch):
    class FakeAppPush:
        @staticmethod
        def is_available():
            return True

        @staticmethod
        def target_count():
            return 1

        @staticmethod
        def live_activity_target_count():
            return 1

    monkeypatch.setattr(m, "_mobile_app_push", FakeAppPush)
    monkeypatch.setattr(m, "_TICK_SECONDS", 0.01)
    monkeypatch.setattr(
        m,
        "_snapshot",
        lambda: {"prompt_id": "p1", "value": 1, "max": 10},
    )
    monkeypatch.setattr(
        m,
        "_relay_snapshot",
        lambda _snapshot: [{"phase": "generating", "prompt_id": "p1"}],
    )
    queued = []
    monkeypatch.setattr(
        m, "_queue_relay", lambda payload: queued.append(payload)
    )

    _run_watch_loop_briefly()

    assert queued == [{"phase": "generating", "prompt_id": "p1"}]


def test_non_retryable_keyframe_rejection_is_dropped_but_logged(caplog, monkeypatch):
    """A target that hard-rejects the keyframe must not wedge the FIFO.

    Retrying a 403 forever would stall every later keyframe behind it, so the
    frame is dropped — but that device's activity is now stranded, which is a
    warning, not a silent success.
    """
    class FakeAppPush:
        calls = []

        @classmethod
        def send_live_activity(cls, payload):
            cls.calls.append(payload)
            return {"sent": 1, "pruned": 0, "total": 2, "retryable": 0, "failed": 1}

    monkeypatch.setattr(m, "_mobile_app_push", FakeAppPush)
    monkeypatch.setattr(m, "_RELAY_PUMP_TICK_SECONDS", 0.001)
    monkeypatch.setattr(m, "_RELAY_MIN_SEND_GAP_SECONDS", 0.0)

    async def run():
        m._queue_relay({
            "phase": "done", "prompt_id": "p1", "delivery": "keyframe",
            "activity_event": "end",
        })
        await m._relay_task

    with caplog.at_level("WARNING"):
        asyncio.run(run())

    # Sent once, not retried in a loop.
    assert len(FakeAppPush.calls) == 1
    assert not m._relay_keyframes
    assert "rejected it non-retryably" in caplog.text


def test_keyframe_relay_failure_is_retried_until_delivered(monkeypatch):
    class FakeAppPush:
        calls = []

        @classmethod
        def send_live_activity(cls, payload):
            cls.calls.append(payload)
            if len(cls.calls) == 1:
                return {"sent": 0, "pruned": 0, "total": 1}
            return {"sent": 1, "pruned": 0, "total": 1}

    monkeypatch.setattr(m, "_mobile_app_push", FakeAppPush)
    monkeypatch.setattr(m, "_RELAY_RETRY_SECONDS", 0.01)
    monkeypatch.setattr(m, "_RELAY_PUMP_TICK_SECONDS", 0.001)
    monkeypatch.setattr(m, "_RELAY_MIN_SEND_GAP_SECONDS", 0.0)

    async def run():
        m._queue_relay({
            "phase": "done", "prompt_id": "p1", "delivery": "keyframe",
            "activity_event": "update",
        })
        await m._relay_task

    asyncio.run(run())

    assert FakeAppPush.calls == [
        {
            "phase": "done", "prompt_id": "p1", "delivery": "keyframe",
            "activity_event": "update",
        },
        {
            "phase": "done", "prompt_id": "p1", "delivery": "keyframe",
            "activity_event": "update",
        },
    ]


def test_keyframes_are_fifo_while_routine_progress_keeps_only_latest(monkeypatch):
    class FakeAppPush:
        calls = []

        @classmethod
        def send_live_activity(cls, payload):
            cls.calls.append(payload)
            return {"sent": 1, "pruned": 0, "total": 1, "retryable": 0}

    monkeypatch.setattr(m, "_mobile_app_push", FakeAppPush)
    monkeypatch.setattr(m, "_RELAY_COALESCE_SECONDS", 0.0)
    monkeypatch.setattr(m, "_RELAY_MIN_SEND_GAP_SECONDS", 0.0)

    async def run():
        m._queue_relay({"prompt_id": "old-routine", "delivery": "routine"})
        m._queue_relay({"prompt_id": "p1", "phase": "done", "delivery": "keyframe"})
        m._queue_relay({"prompt_id": "p2", "progress": 0, "delivery": "keyframe"})
        m._queue_relay({"prompt_id": "p2", "progress": 0.2, "delivery": "routine"})
        m._queue_relay({"prompt_id": "p2", "progress": 0.4, "delivery": "routine"})
        await m._relay_task

    asyncio.run(run())
    assert [(p["prompt_id"], p.get("progress")) for p in FakeAppPush.calls] == [
        ("p1", None),
        ("p2", 0),
        ("p2", 0.4),
    ]


def test_restart_restores_active_lifecycle_and_durable_keyframe_outbox(monkeypatch):
    m._relay_was_active = True
    m._relay_last_prompt_id = "p1"
    m._relay_active_prompt_id = "p1"
    m._relay_active_prompt_was_running = True
    m._relay_last_payload = {
        "prompt_id": "p1",
        "workflow_label": "Portrait",
        "started_at": 1_786_000_000,
    }
    m._relay_finished_phases["p1"] = "done"
    m._relay_keyframes.append(({
        "phase": "generating",
        "prompt_id": "p1",
        "delivery": "keyframe",
        "activity_event": "update",
        "started_at": 1_786_000_000,
    }, 123.0))
    m._save_relay_state()

    m._relay_was_active = False
    m._relay_last_prompt_id = None
    m._relay_active_prompt_id = None
    m._relay_active_prompt_was_running = False
    m._relay_last_payload = None
    m._relay_finished_phases.clear()
    m._relay_keyframes.clear()
    m._restore_relay_state()

    assert m._relay_was_active is True
    assert m._relay_active_prompt_id == "p1"
    assert m._relay_keyframes[0][1] == 0.0
    assert "started_at" not in m._relay_last_payload
    assert "started_at" not in m._relay_keyframes[0][0]
    monkeypatch.setattr(m, "_current_queue_entries", lambda: ([], []))
    completion, ending = m._relay_snapshot({"prompt_id": "p1"})
    assert ending["activity_event"] == "end"


def test_delivered_keyframe_is_removed_from_the_durable_outbox(monkeypatch):
    class FakeAppPush:
        @classmethod
        def send_live_activity(cls, payload):
            return {"sent": 1, "pruned": 0, "total": 1, "retryable": 0}

    monkeypatch.setattr(m, "_mobile_app_push", FakeAppPush)
    monkeypatch.setattr(m, "_RELAY_MIN_SEND_GAP_SECONDS", 0.0)

    async def run():
        m._queue_relay({"prompt_id": "p1", "delivery": "keyframe"})
        await m._relay_task

    asyncio.run(run())
    stored = json.loads(open(m._relay_state_path(), encoding="utf-8").read())
    assert stored["keyframes"] == []


def test_watch_loop_survives_a_snapshot_failure(monkeypatch):
    """A registry read can race a ComfyUI-side reload; one bad read must not
    kill the channel for the rest of the server's life."""
    monkeypatch.setattr(m, "_TICK_SECONDS", 0.01)
    client = FakeWS()
    m._clients.add(client)
    state = {"calls": 0}

    def flaky():
        state["calls"] += 1
        if state["calls"] == 1:
            raise RuntimeError("registry reloading")
        return {"prompt_id": "p1", "value": 2, "max": 10}

    monkeypatch.setattr(m, "_snapshot", flaky)
    _run_watch_loop_briefly()
    assert client.payloads == [{"prompt_id": "p1", "value": 2, "max": 10}]


# --- connection lifecycle -------------------------------------------------

def test_connecting_mid_run_gets_the_current_state_immediately(monkeypatch):
    """The watch loop only emits on change, so without this a client that
    connects between two ticks would show a blank ring until the next one."""
    global _registry
    _registry = _running(value=7, maximum=10)
    created = []

    def factory(**kwargs):
        ws = FakeWS(**kwargs)
        created.append(ws)
        return ws

    monkeypatch.setattr(m.web, "WebSocketResponse", factory)
    asyncio.run(m.api_progress_ws(object()))
    assert created[0].prepared
    assert created[0].payloads == [{"prompt_id": "p1", "value": 7, "max": 10, "nodes_total": 1, "nodes_done": 0, "node_name": None}]


def test_a_closed_socket_is_not_left_in_the_client_set(monkeypatch):
    monkeypatch.setattr(m.web, "WebSocketResponse", lambda **kwargs: FakeWS(**kwargs))
    asyncio.run(m.api_progress_ws(object()))
    assert m._clients == set()


def test_cleanup_closes_every_socket_and_cancels_the_watch(monkeypatch):
    client = FakeWS()
    m._clients.add(client)

    async def main():
        await m.on_startup(None)
        await m.on_cleanup(None)

    asyncio.run(main())
    assert client.closed
    assert m._clients == set()
    # The watch task is awaited to completion, not just cancelled and dropped.
    assert m._watch_task is None


# --- overall node counting -------------------------------------------------

def test_node_counts_are_finished_over_the_whole_graph():
    """The reason these fields exist: `value`/`max` restart at zero on every
    node, so a client drawing them as one bar watches the percentage fall back
    mid-generation. Counting nodes is monotonic."""
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={
            "1": {"state": _NodeState.Finished, "value": 10, "max": 10},
            "2": {"state": _NodeState.Running, "value": 2, "max": 20},
        },
        node_ids={"1", "2", "3", "4"},
    )
    snap = m._snapshot()
    assert (snap["nodes_done"], snap["nodes_total"]) == (1, 4)
    # The running node's own fraction is still reported, unchanged.
    assert (snap["value"], snap["max"]) == (2, 20)


def test_cached_nodes_count_as_done():
    """`execution.py` calls finish_progress for a cache hit, so a re-run with
    most of the graph cached reports most of it done immediately instead of
    crawling and then jumping at the end."""
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={
            "1": {"state": _NodeState.Finished, "value": 1, "max": 1},
            "2": {"state": _NodeState.Finished, "value": 1, "max": 1},
            "3": {"state": _NodeState.Running, "value": 0, "max": 20},
        },
        node_ids={"1", "2", "3"},
    )
    snap = m._snapshot()
    assert (snap["nodes_done"], snap["nodes_total"]) == (2, 3)


def test_errored_nodes_count_as_done_so_progress_cannot_stall():
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={"1": {"state": _NodeState.Error, "value": 0, "max": 1}},
        node_ids={"1", "2"},
    )
    assert m._snapshot()["nodes_done"] == 1


def test_pending_nodes_are_not_counted_as_done():
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={
            "1": {"state": _NodeState.Pending, "value": 0, "max": 1},
            "2": {"state": _NodeState.Running, "value": 1, "max": 4},
        },
        node_ids={"1", "2"},
    )
    assert m._snapshot()["nodes_done"] == 0


def test_done_never_exceeds_total():
    """Subgraph expansion can put nodes in the registry that all_node_ids has
    not caught up with. A client dividing the two should never see a ratio
    above 1."""
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={
            "1": {"state": _NodeState.Finished, "value": 1, "max": 1},
            "2": {"state": _NodeState.Finished, "value": 1, "max": 1},
        },
        node_ids={"1"},
    )
    snap = m._snapshot()
    assert snap["nodes_done"] <= snap["nodes_total"]


def test_missing_dynprompt_degrades_to_zero_rather_than_raising():
    """An older or unusual registry without a dynprompt must not break the
    socket for every client — the fields just read as unknown."""
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={"1": {"state": _NodeState.Running, "value": 1, "max": 2}},
    )
    _registry.dynprompt = None
    snap = m._snapshot()
    assert snap["nodes_total"] == 0
    assert (snap["value"], snap["max"]) == (1, 2)


# --- executing node name ---------------------------------------------------

def test_node_name_prefers_the_user_given_title():
    """"Generating" for two minutes says nothing; the node's own title says
    where in the workflow you are."""
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={"7": {"state": _NodeState.Running, "value": 3, "max": 20}},
        node_ids={"7"},
        graph={"7": {"class_type": "KSampler", "_meta": {"title": "Upscale pass"}}},
    )
    assert m._snapshot()["node_name"] == "Upscale pass"


def test_node_name_falls_back_to_class_type():
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={"7": {"state": _NodeState.Running, "value": 3, "max": 20}},
        node_ids={"7"},
        graph={"7": {"class_type": "KSampler"}},
    )
    assert m._snapshot()["node_name"] == "KSampler"


def test_blank_title_falls_back_rather_than_showing_nothing():
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={"7": {"state": _NodeState.Running, "value": 1, "max": 2}},
        node_ids={"7"},
        graph={"7": {"class_type": "KSampler", "_meta": {"title": "   "}}},
    )
    assert m._snapshot()["node_name"] == "KSampler"


def test_unknown_node_degrades_to_no_name_rather_than_raising():
    """A prompt mid-expansion can have a running id the graph has not caught up
    with. This runs on the node's event loop every 0.1s — it must not take the
    socket down for every client."""
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={"missing": {"state": _NodeState.Running, "value": 1, "max": 2}},
        node_ids={"missing"},
        graph={},
    )
    snap = m._snapshot()
    assert snap["node_name"] is None
    assert (snap["value"], snap["max"]) == (1, 2)


def test_no_running_node_reports_no_name():
    global _registry
    _registry = _Registry(
        prompt_id="p1",
        nodes={"1": {"state": _NodeState.Finished, "value": 1, "max": 1}},
        node_ids={"1"},
        graph={"1": {"class_type": "KSampler"}},
    )
    assert m._snapshot()["node_name"] is None
