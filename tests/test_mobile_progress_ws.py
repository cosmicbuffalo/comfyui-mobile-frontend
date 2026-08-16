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


class _Registry:
    def __init__(self, prompt_id=None, nodes=None):
        self.prompt_id = prompt_id
        self.nodes = nodes or {}


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
def _isolate():
    global _registry
    _registry = _Registry()
    sys.modules["comfy_execution.progress"].get_progress_state = lambda: _registry
    m._clients.clear()
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


# --- snapshot -------------------------------------------------------------

def test_snapshot_is_idle_when_nothing_has_run():
    assert m._snapshot() == {"prompt_id": None, "value": 0, "max": 0}


def test_snapshot_reports_the_running_node():
    global _registry
    _registry = _running(value=4, maximum=20)
    assert m._snapshot() == {"prompt_id": "p1", "value": 4, "max": 20}


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
    assert m._snapshot() == {"prompt_id": "p1", "value": 0, "max": 0}


def test_snapshot_tolerates_a_running_node_without_progress_fields():
    global _registry
    _registry = _Registry(prompt_id="p1", nodes={"1": {"state": _NodeState.Running}})
    assert m._snapshot() == {"prompt_id": "p1", "value": 0, "max": 0}


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
    assert client.payloads == [{"prompt_id": "p1", "value": 1, "max": 10}]


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
    assert created[0].payloads == [{"prompt_id": "p1", "value": 7, "max": 10}]


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
