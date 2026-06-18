"""Regression tests for mobile_app_push.

This module is on the live generation-completion path (every finished prompt
fans out to every registered iOS device) and persists target state to disk.
The original code shipped without any test coverage, so this file locks the
contract in before any further changes ship.
"""
import json
from pathlib import Path

import pytest

import mobile_app_push as m


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch):
    """Give each test its own user dir and a freshly emptied target cache."""
    monkeypatch.setattr(m.folder_paths, "get_user_directory", lambda: str(tmp_path))
    m._targets = None
    yield
    m._targets = None


class _Resp:
    def __init__(self, status_code):
        self.status_code = status_code


# --- add / list / remove --------------------------------------------------

def test_add_target_persists_to_disk(tmp_path: Path):
    assert m.add_target("https://relay.example/", "ABCD-EFGH", label="iPhone")

    saved = json.loads(
        (tmp_path / "default" / "mobile" / "push" / "app_targets.json").read_text()
    )
    assert saved[0]["relay_url"] == "https://relay.example/"
    assert saved[0]["pairing_code"] == "ABCD-EFGH"
    assert saved[0]["label"] == "iPhone"


def test_add_target_rejects_non_https_relay():
    assert not m.add_target("http://relay.example/", "ABCD-EFGH")
    assert m.target_count() == 0


def test_add_target_rejects_empty_pairing_code():
    assert not m.add_target("https://relay.example/", "")
    assert m.target_count() == 0


def test_add_target_dedupes_by_relay_and_code():
    m.add_target("https://relay.example/", "ABCD-EFGH", label="iPhone")
    m.add_target("https://relay.example/", "ABCD-EFGH", label="iPhone (re-pair)")
    assert m.target_count() == 1
    assert m.list_targets()[0]["label"] == "iPhone (re-pair)"


def test_list_targets_hides_full_pairing_code():
    m.add_target("https://relay.example/", "ABCD-EFGH")
    view = m.list_targets()[0]
    assert view["code_hint"] == "EFGH"
    assert "pairing_code" not in view
    assert view["relay_url"] == "https://relay.example/"


def test_remove_target_clears_persisted_file():
    m.add_target("https://relay.example/", "ABCD-EFGH")
    assert m.remove_target("ABCD-EFGH") == 1
    assert m.target_count() == 0


def test_legacy_targets_file_without_new_fields_loads_cleanly(tmp_path: Path):
    """An older saved file lacking newer fields must still be readable."""
    push_dir = tmp_path / "default" / "mobile" / "push"
    push_dir.mkdir(parents=True)
    (push_dir / "app_targets.json").write_text(json.dumps([
        {"relay_url": "https://relay.example/", "pairing_code": "OLD-CODE",
         "label": "iPhone", "added": None},
    ]))
    m._targets = None
    assert m.target_count() == 1
    m.add_target("https://relay.example/", "OLD-CODE", label="updated")
    assert m.list_targets()[0]["label"] == "updated"


# --- relay event POST body ------------------------------------------------

def test_post_event_attaches_pairing_code_and_hits_event_path(monkeypatch):
    captured = {}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["body"] = json
        return _Resp(200)

    monkeypatch.setattr(m.requests, "post", fake_post)

    target = {"relay_url": "https://relay.example/", "pairing_code": "ABCD-EFGH"}
    result = m._post_event(target, {"prompt_id": "p", "status": "success", "outputs": 1})

    assert result == "ok"
    assert captured["url"] == "https://relay.example/event"
    assert captured["body"]["pairing_code"] == "ABCD-EFGH"
    assert captured["body"]["prompt_id"] == "p"
    assert captured["body"]["status"] == "success"
    assert captured["body"]["outputs"] == 1


def test_post_event_treats_404_as_gone(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(404))
    target = {"relay_url": "https://relay.example/", "pairing_code": "X"}
    assert m._post_event(target, {}) == "gone"


def test_post_event_treats_other_non_200_as_error(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(500))
    target = {"relay_url": "https://relay.example/", "pairing_code": "X"}
    assert m._post_event(target, {}) == "error"


def test_send_prunes_targets_that_returned_gone(monkeypatch):
    m.add_target("https://relay.example/", "ALIVE-CODE")
    m.add_target("https://relay.example/", "DEAD-CODE")

    def fake_post(url, json, timeout):
        return _Resp(200 if json["pairing_code"] == "ALIVE-CODE" else 404)

    monkeypatch.setattr(m.requests, "post", fake_post)

    result = m._send({"prompt_id": "p", "status": "success", "outputs": 1})
    assert result == {"sent": 1, "pruned": 1, "total": 2}

    remaining_codes = [t["pairing_code"] for t in m._load_targets()]
    assert remaining_codes == ["ALIVE-CODE"]


def test_send_returns_zeros_when_no_targets():
    result = m._send({"prompt_id": "p", "status": "success", "outputs": 1})
    assert result == {"sent": 0, "pruned": 0, "total": 0}


# --- send_completion / send_test -----------------------------------------

def test_send_completion_forwards_optional_image_and_url(monkeypatch):
    m.add_target("https://relay.example/", "ABCD-EFGH")
    captured = []
    monkeypatch.setattr(
        m.requests, "post",
        lambda url, json, timeout: (captured.append(json), _Resp(200))[1],
    )

    m.send_completion(
        "prompt-1", "success", 2,
        image_url="/mobile/api/thumbnail?x=1",
        click_url="/mobile/",
    )

    body = captured[0]
    assert body["prompt_id"] == "prompt-1"
    assert body["status"] == "success"
    assert body["outputs"] == 2
    assert body["image"] == "/mobile/api/thumbnail?x=1"
    assert body["url"] == "/mobile/"


def test_send_completion_omits_image_when_not_provided(monkeypatch):
    m.add_target("https://relay.example/", "ABCD-EFGH")
    captured = []
    monkeypatch.setattr(
        m.requests, "post",
        lambda url, json, timeout: (captured.append(json), _Resp(200))[1],
    )

    m.send_completion("prompt-1", "success", 0)
    assert "image" not in captured[0]
    assert "url" not in captured[0]


# --- server_id routing for multi-server setups --------------------------

def test_add_target_persists_server_id_when_provided(tmp_path: Path):
    assert m.add_target(
        "https://relay.example/", "ABCD-EFGH",
        label="iPhone", server_id="server-uuid-1",
    )
    saved = json.loads(
        (tmp_path / "default" / "mobile" / "push" / "app_targets.json").read_text()
    )
    assert saved[0]["server_id"] == "server-uuid-1"


def test_add_target_omits_server_id_when_missing_or_invalid(tmp_path: Path):
    # Keep the persisted shape clean for the no-id case so old consumers
    # don't see an unexpected null.
    assert m.add_target("https://relay.example/", "ABCD-EFGH")
    saved = json.loads(
        (tmp_path / "default" / "mobile" / "push" / "app_targets.json").read_text()
    )
    assert "server_id" not in saved[0]

    m._targets = None
    assert m.add_target(
        "https://relay.example/", "WXYZ-1234", server_id=12345,  # wrong type
    )
    saved = json.loads(
        (tmp_path / "default" / "mobile" / "push" / "app_targets.json").read_text()
    )
    new_entry = [t for t in saved if t["pairing_code"] == "WXYZ-1234"][0]
    assert "server_id" not in new_entry


def test_post_event_forwards_server_id_when_target_has_one(monkeypatch):
    captured = []
    monkeypatch.setattr(
        m.requests, "post",
        lambda url, json, timeout: (captured.append(json), _Resp(200))[1],
    )
    target = {
        "relay_url": "https://relay.example/",
        "pairing_code": "ABCD-EFGH",
        "server_id": "server-uuid-1",
    }
    m._post_event(target, {"prompt_id": "p", "status": "success", "outputs": 1})
    assert captured[0]["server_id"] == "server-uuid-1"


def test_post_event_omits_server_id_when_target_has_none(monkeypatch):
    """Legacy targets (registered before server_id existed) must still POST cleanly."""
    captured = []
    monkeypatch.setattr(
        m.requests, "post",
        lambda url, json, timeout: (captured.append(json), _Resp(200))[1],
    )
    target = {"relay_url": "https://relay.example/", "pairing_code": "ABCD-EFGH"}
    m._post_event(target, {"prompt_id": "p", "status": "success", "outputs": 1})
    assert "server_id" not in captured[0]


def test_send_test_payload_shape(monkeypatch):
    m.add_target("https://relay.example/", "ABCD-EFGH")
    captured = []
    monkeypatch.setattr(
        m.requests, "post",
        lambda url, json, timeout: (captured.append(json), _Resp(200))[1],
    )

    m.send_test()
    body = captured[0]
    assert body["status"] == "test"
    assert body["title"] == "Test notification"
    assert "body" in body
