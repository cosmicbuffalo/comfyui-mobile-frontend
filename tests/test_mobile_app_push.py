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
    # Every existing test relays through relay.example; allowlist it so these
    # stay about persistence/dedupe rather than about the allowlist itself.
    monkeypatch.setenv("COMFYUI_MOBILE_APP_PUSH_RELAYS", "https://relay.example")
    # add_target now verifies the pairing code against the relay before
    # persisting it (a real requests.post call) — default every test to a
    # relay that confirms the pairing, so tests about persistence/dedupe/etc.
    # don't need to know that verification exists. Tests about verification
    # itself override this with their own monkeypatch.
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(200))
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
    # Stored canonicalized: the allowlist compares origins, so the trailing
    # slash the app sent is normalized away before it hits disk.
    assert saved[0]["relay_url"] == "https://relay.example"
    assert saved[0]["pairing_code"] == "ABCD-EFGH"
    assert saved[0]["label"] == "iPhone"


def test_add_target_rejects_non_https_relay():
    assert not m.add_target("http://relay.example/", "ABCD-EFGH")
    assert m.target_count() == 0


def test_add_target_rejects_unlisted_https_relay():
    assert not m.add_target("https://attacker.example", "ABCD-EFGH")
    assert m.target_count() == 0


@pytest.mark.parametrize("url", [
    "https://relay.example/path",
    "https://relay.example/?redirect=https://attacker.example",
    "https://user:password@relay.example",
    "https://relay.example#fragment",
])
def test_add_target_rejects_non_origin_relay_urls(url):
    assert not m.add_target(url, "ABCD-EFGH")
    assert m.target_count() == 0


def test_official_relay_is_allowed_without_extra_configuration(monkeypatch):
    monkeypatch.delenv("COMFYUI_MOBILE_APP_PUSH_RELAYS", raising=False)
    assert m.add_target(m._OFFICIAL_RELAY_ORIGIN, "ABCD-EFGH")


def test_allowed_relay_origins_reports_official_plus_configured(monkeypatch):
    monkeypatch.setenv(
        "COMFYUI_MOBILE_APP_PUSH_RELAYS",
        " https://b.example , https://a.example:8443/ , not-a-url ",
    )
    assert m.allowed_relay_origins() == sorted([
        m._OFFICIAL_RELAY_ORIGIN,
        "https://a.example:8443",
        "https://b.example",
    ])


def test_add_target_stops_at_the_device_limit():
    for i in range(m.MAX_TARGETS):
        assert m.add_target("https://relay.example", f"CODE-{i}")
    assert m.target_count() == m.MAX_TARGETS
    assert not m.add_target("https://relay.example", "ONE-TOO-MANY")
    assert m.target_count() == m.MAX_TARGETS


def test_device_limit_is_enforced_before_the_relay_is_contacted(monkeypatch):
    """The cap exists to bound outbound relay traffic, and verification is
    itself an outbound relay request that pushes to the paired device. Checking
    the cap after verifying would leave that traffic uncapped — anyone who can
    reach the endpoint could spend a round-trip per call on a refused add."""
    for i in range(m.MAX_TARGETS):
        assert m.add_target("https://relay.example", f"CODE-{i}")

    posts = []
    monkeypatch.setattr(
        m.requests, "post",
        lambda *a, **k: (posts.append(a), _Resp(200))[1],
    )
    assert not m.add_target("https://relay.example", "ONE-TOO-MANY")
    assert posts == []
    assert m.target_count() == m.MAX_TARGETS


def test_ghost_entries_outside_the_allowlist_do_not_block_new_pairings(monkeypatch):
    """Devices paired against a relay the admin has since removed from the
    allowlist are never POSTed to — they must not count against the cap, or a
    freshly reconfigured, idle server refuses every pairing until a completion
    happens to prune them."""
    monkeypatch.setenv(
        "COMFYUI_MOBILE_APP_PUSH_RELAYS",
        "https://old.example,https://new.example",
    )
    for i in range(m.MAX_TARGETS):
        assert m.add_target("https://old.example", f"CODE-{i}")
    monkeypatch.setenv("COMFYUI_MOBILE_APP_PUSH_RELAYS", "https://new.example")
    assert m.add_target("https://new.example", "FRESH-CODE")


def test_re_pairing_a_known_device_still_works_at_the_limit():
    # The limit must not lock out a device that is already paired — re-pairing
    # dedupes in place, so it never grows the list.
    for i in range(m.MAX_TARGETS):
        assert m.add_target("https://relay.example", f"CODE-{i}")
    assert m.add_target("https://relay.example", "CODE-0", label="renamed")
    assert m.target_count() == m.MAX_TARGETS
    assert [t["label"] for t in m.list_targets() if t["code_hint"] == "DE-0"] == ["renamed"]


# --- pairing-code verification --------------------------------------------
#
# add_target confirms the code with the relay before persisting it. Without
# that, a typo or garbage code would self-heal after one wasted completion
# POST (the relay's 404 prunes it), but a code an attacker actually controls
# (paired with their own device via the relay's own /pair flow) would sit
# there indefinitely, and this server would notify them of every completion.


def test_add_target_rejects_a_pairing_code_the_relay_does_not_recognize(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(404))
    assert not m.add_target("https://relay.example/", "NOT-REAL")
    assert m.target_count() == 0


def test_add_target_still_succeeds_when_the_relay_is_unreachable(monkeypatch):
    # Fails open on anything short of a definitive "unknown pairing" — a
    # relay hiccup during verification must not become a new way for
    # legitimate pairing to fail.
    def raises(*a, **k):
        raise ConnectionError("relay unreachable")
    monkeypatch.setattr(m.requests, "post", raises)
    assert m.add_target("https://relay.example/", "ABCD-EFGH")
    assert m.target_count() == 1


def test_add_target_still_succeeds_on_a_non_404_relay_error(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(500))
    assert m.add_target("https://relay.example/", "ABCD-EFGH")
    assert m.target_count() == 1


def test_add_target_rejects_a_malformed_pairing_code_too(monkeypatch):
    # Verified live against the production relay: a pairing code that
    # doesn't even match its expected shape comes back 400
    # (invalid_pairing_code), not 404 — equally definitive as "unknown",
    # not a reason to fail open the way an actual relay error would be.
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(400))
    assert not m.add_target("https://relay.example/", "NOT-A-REAL-SHAPE")
    assert m.target_count() == 0


def test_add_target_verifies_before_persisting_and_targets_the_right_pairing(monkeypatch):
    captured = []

    def fake_post(url, json, timeout):
        captured.append((url, json["pairing_code"]))
        return _Resp(200)

    monkeypatch.setattr(m.requests, "post", fake_post)
    m.add_target("https://relay.example/", "ABCD-EFGH")

    assert captured == [("https://relay.example/event", "ABCD-EFGH")]


def test_add_target_verification_failure_leaves_no_trace_on_disk(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(404))
    assert not m.add_target("https://relay.example/", "NOT-REAL")
    assert not (tmp_path / "default" / "mobile" / "push" / "app_targets.json").exists()


# --- pairing gate ---------------------------------------------------------


def test_pairing_is_enabled_without_any_configuration(monkeypatch):
    """Relays are allowlisted, so an untouched server pairs out of the box
    without any env var."""
    monkeypatch.delenv("COMFYUI_MOBILE_APP_PUSH", raising=False)
    assert m.pairing_enabled()


@pytest.mark.parametrize("value", ["0", "false", "no", "off", "OFF", " 0 "])
def test_pairing_can_be_turned_off_explicitly(monkeypatch, value):
    monkeypatch.setenv("COMFYUI_MOBILE_APP_PUSH", value)
    assert not m.pairing_enabled()


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "", "   ", "maybe"])
def test_pairing_stays_on_for_anything_that_is_not_an_explicit_no(monkeypatch, value):
    # Blank and unparseable are not decisions; the old opt-in spellings keep
    # working so an existing COMFYUI_MOBILE_APP_PUSH=1 setup is unaffected.
    monkeypatch.setenv("COMFYUI_MOBILE_APP_PUSH", value)
    assert m.pairing_enabled()


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
    assert view["relay_url"] == "https://relay.example"


def test_remove_target_clears_persisted_file():
    m.add_target("https://relay.example/", "ABCD-EFGH")
    assert m.remove_target("ABCD-EFGH") == 1
    assert m.target_count() == 0


def test_unpairing_still_works_after_the_relay_leaves_the_allowlist(monkeypatch):
    """An admin can narrow COMFYUI_MOBILE_APP_PUSH_RELAYS after devices paired.
    The app still sends the relay it paired against, which no longer
    normalizes — refusing there would strand the entry as unpairable."""
    m.add_target("https://relay.example", "ABCD-EFGH")
    monkeypatch.setenv("COMFYUI_MOBILE_APP_PUSH_RELAYS", "https://other.example")
    assert m._normalize_relay_url("https://relay.example") is None
    assert m.remove_target("ABCD-EFGH", "https://relay.example/") == 1
    assert m.target_count() == 0


def test_unpairing_an_un_allowlisted_relay_still_matches_on_the_relay(monkeypatch):
    """The fallback matches the stored spelling — it must not become a
    match-any-relay wildcard."""
    m.add_target("https://relay.example", "ABCD-EFGH")
    monkeypatch.setenv("COMFYUI_MOBILE_APP_PUSH_RELAYS", "https://other.example")
    assert m.remove_target("ABCD-EFGH", "https://elsewhere.example") == 0
    assert m.target_count() == 1


def test_a_garbage_relay_url_is_not_a_match_any_wildcard():
    """relay_url provided-but-unusable (empty, junk) must remove nothing.
    Only omitting relay_url entirely means 'this code on any relay' —
    otherwise a malformed request unpairs the code everywhere."""
    m.add_target("https://relay.example", "ABCD-EFGH")
    assert m.remove_target("ABCD-EFGH", "") == 0
    assert m.remove_target("ABCD-EFGH", "   ") == 0
    assert m.remove_target("ABCD-EFGH", "/") == 0
    assert m.target_count() == 1
    # Omitting it still matches any relay.
    assert m.remove_target("ABCD-EFGH") == 1


def test_unpairing_matches_legacy_spellings_in_either_direction(tmp_path: Path, monkeypatch):
    """Entries written by pre-allowlist releases were stored verbatim — with a
    path, mixed case, or an explicit :443 — and may never normalize again.
    Unpairing must match whichever side carries the legacy spelling."""
    push_dir = tmp_path / "default" / "mobile" / "push"
    push_dir.mkdir(parents=True)
    (push_dir / "app_targets.json").write_text(json.dumps([
        {"relay_url": "https://relay.example/push", "pairing_code": "PATH-CODE",
         "label": "iPhone", "added": None},
        {"relay_url": "https://Relay.Example:443/", "pairing_code": "PORT-CODE",
         "label": "iPad", "added": None},
    ]))
    m._targets = None

    # Path-bearing stored spelling: the app sends back what it stored.
    assert m.remove_target("PATH-CODE", "https://relay.example/push/") == 1
    # Explicit default port and case: matches the bare origin the app sends.
    assert m.remove_target("PORT-CODE", "https://relay.example") == 1
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


def test_post_event_prunes_a_legacy_unlisted_relay_without_requesting_it(monkeypatch):
    monkeypatch.setattr(
        m.requests,
        "post",
        lambda *a, **k: pytest.fail("must not POST to an unlisted relay"),
    )
    target = {"relay_url": "https://attacker.example", "pairing_code": "X"}
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
