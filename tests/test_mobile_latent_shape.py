"""Tests for the latent-preview shape hint.

What matters here is exactly the distinction the client cannot make on its own:
a flat run of N preview frames is either N separate images or N frames of one
animation, and only the tensor knows which. So these cover the two tensor
layouts, the dedup that keeps a per-step callback from flooding the socket, and
— most importantly — that a sampler keeps working no matter what this does. A
preview hint that can break a generation is worse than no hint.

`latent_preview` is a ComfyUI-runtime import, stubbed here the same way the
module imports it: lazily, inside install().
"""
import sys
import types

import pytest

import mobile_latent_shape


class _Latent:
    """Stands in for a torch tensor; only `.shape` is ever read."""

    def __init__(self, *shape):
        self.shape = shape


class _Server:
    def __init__(self):
        self.client_id = "client-1"
        self.sent = []
        self.last_prompt_id = "prompt-1"
        self.last_node_id = "7"

    def send_sync(self, event, data, sid=None):
        self.sent.append((event, data, sid))


@pytest.fixture
def server(monkeypatch):
    instance = _Server()
    module = types.ModuleType("server")
    module.PromptServer = types.SimpleNamespace(instance=instance)
    monkeypatch.setitem(sys.modules, "server", module)
    mobile_latent_shape.reset_for_tests()
    return instance


@pytest.fixture
def latent_preview(monkeypatch):
    """A stub latent_preview whose prepare_callback records its calls."""
    calls = []

    def prepare_callback(model, steps, x0_output_dict=None):
        def callback(step, x0, x, total_steps):
            calls.append((step, total_steps))
            return "inner-result"
        return callback

    module = types.ModuleType("latent_preview")
    module.prepare_callback = prepare_callback
    monkeypatch.setitem(sys.modules, "latent_preview", module)
    monkeypatch.setattr(mobile_latent_shape, "_installed", False)
    return types.SimpleNamespace(module=module, calls=calls)


def _install(latent_preview):
    assert mobile_latent_shape.install() is True
    return latent_preview.module.prepare_callback(None, 10)


# --- shape reading ---------------------------------------------------------

def test_four_dimensional_latent_is_a_batch_of_images():
    assert mobile_latent_shape._shape_of(_Latent(4, 4, 64, 64)) == (4, 1)


def test_five_dimensional_latent_is_batched_video():
    # [B, C, T, H, W] — two videos of nine frames, not eighteen images.
    assert mobile_latent_shape._shape_of(_Latent(2, 16, 9, 60, 104)) == (2, 9)


def test_unknown_rank_reports_nothing():
    assert mobile_latent_shape._shape_of(_Latent(4, 64, 64)) is None
    assert mobile_latent_shape._shape_of(object()) is None


# --- what reaches the socket ----------------------------------------------

def test_reports_batch_shape_once_per_node(server, latent_preview):
    callback = _install(latent_preview)
    for step in range(5):
        callback(step, _Latent(3, 4, 64, 64), None, 5)

    assert len(server.sent) == 1
    event, payload, sid = server.sent[0]
    assert event == "mobile_latent_shape"
    assert sid == "client-1"
    assert payload == {
        "prompt_id": "prompt-1",
        "node_id": "7",
        "batch": 3,
        "frames": 1,
    }


def test_a_second_sampler_in_the_same_run_reports_again(server, latent_preview):
    callback = _install(latent_preview)
    callback(0, _Latent(2, 4, 64, 64), None, 5)
    server.last_node_id = "12"
    callback(0, _Latent(1, 16, 33, 60, 104), None, 5)

    assert [p["node_id"] for _, p, _ in server.sent] == ["7", "12"]
    assert [(p["batch"], p["frames"]) for _, p, _ in server.sent] == [(2, 1), (1, 33)]


def test_state_resets_when_a_new_prompt_runs(server, latent_preview):
    callback = _install(latent_preview)
    callback(0, _Latent(2, 4, 64, 64), None, 5)
    server.last_prompt_id = "prompt-2"
    callback(0, _Latent(2, 4, 64, 64), None, 5)

    assert [p["prompt_id"] for _, p, _ in server.sent] == ["prompt-1", "prompt-2"]


def test_unreadable_latent_sends_nothing(server, latent_preview):
    callback = _install(latent_preview)
    callback(0, object(), None, 5)
    assert server.sent == []


# --- never break the sampler ----------------------------------------------

def test_callback_still_delegates_and_returns_the_inner_result(server, latent_preview):
    callback = _install(latent_preview)
    assert callback(3, _Latent(1, 4, 64, 64), None, 10) == "inner-result"
    assert latent_preview.calls == [(3, 10)]


def test_a_failing_report_does_not_break_sampling(server, latent_preview, monkeypatch):
    callback = _install(latent_preview)

    def explode(_x0):
        raise RuntimeError("websocket is on fire")

    monkeypatch.setattr(mobile_latent_shape, "_report", explode)
    assert callback(0, _Latent(1, 4, 64, 64), None, 10) == "inner-result"
    assert latent_preview.calls == [(0, 10)]


def test_install_is_idempotent(latent_preview):
    assert mobile_latent_shape.install() is True
    assert mobile_latent_shape.install() is False
