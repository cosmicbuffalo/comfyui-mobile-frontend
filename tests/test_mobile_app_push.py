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
    m._last_live_routine_sent.clear()
    yield
    m._targets = None
    m._last_live_routine_sent.clear()


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


def test_post_event_treats_410_as_gone(monkeypatch):
    """The relay answers 410 for a server the phone removed while this node
    was unreachable — the phone's goodbye, delivered on our next attempt.
    Anything but pruning would retry a dead letter forever."""
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(410))
    target = {"relay_url": "https://relay.example/", "pairing_code": "X"}
    assert m._post_event(target, {}) == "gone"


def test_a_410_prunes_the_target_from_the_registry(monkeypatch):
    monkeypatch.setattr(m, "_verify_pairing", lambda *a, **k: True)
    assert m.add_target("https://relay.example/", "ABCD-EFGH")
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(410))
    result = m.send_completion("p", "success", 1)
    assert result["pruned"] == 1
    assert m.target_count() == 0


def test_a_409_corrects_the_notifications_flag_without_deleting(monkeypatch):
    """The relay enforcing a phone-side disable answers /event with 409. The
    target must survive — its Live Activity role and a future re-enable depend
    on it — with only its notifications flag corrected."""
    monkeypatch.setattr(m, "_verify_pairing", lambda *a, **k: True)
    assert m.add_target("https://relay.example/", "ABCD-EFGH", live_activity=True)
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(409))
    result = m.send_completion("p", "success", 1)
    assert result["sent"] == 0
    # Survives in the raw store; target_count() agrees with list_targets()
    # and so reads 0 once notifications are off.
    assert len(m._load_targets()) == 1
    assert m.target_count() == 0
    # list_targets() hides notifications-off entries (the app's bell reads
    # that view, so a corrected target reads as disabled) — check raw state.
    target = m._load_targets()[0]
    assert target.get("notifications") is False
    assert target.get("live_activity") is True
    assert m.list_targets() == []
    # And the corrected flag sticks: the next send has no eligible targets.
    calls = []
    def record(*a, **k):
        calls.append(a)
        return _Resp(200)
    monkeypatch.setattr(m.requests, "post", record)
    m.send_completion("p2", "success", 1)
    assert calls == []


def test_a_409_on_the_live_activity_path_is_not_a_mute(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(409))
    target = {"relay_url": "https://relay.example/", "pairing_code": "X"}
    assert m._post_event(target, {}, path="/live-activity/event") != "muted"


def test_post_event_treats_other_non_200_as_error(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(500))
    target = {"relay_url": "https://relay.example/", "pairing_code": "X"}
    assert m._post_event(target, {}) == "error"


def test_send_live_activity_hits_dedicated_relay_path(monkeypatch):
    captured = {}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["body"] = json
        return _Resp(200)

    monkeypatch.setattr(m.requests, "post", fake_post)
    m.add_target(
        "https://relay.example/", "ABCD-EFGH", server_id="server-uuid-1",
        live_activity=True,
    )
    captured.clear()  # discard the side-effect-free verification request
    result = m.send_live_activity({
        "phase": "generating",
        "prompt_id": "prompt-1",
        "queue_position": 2,
        "progress": 0.5,
    })

    assert result == {"sent": 1, "pruned": 0, "total": 1, "retryable": 0, "failed": 0}
    assert captured["url"] == "https://relay.example/live-activity/event"
    assert captured["body"]["pairing_code"] == "ABCD-EFGH"
    assert captured["body"]["server_id"] == "server-uuid-1"


def test_live_activity_send_marks_transient_relay_failure_retryable(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(200))
    m.add_target(
        "https://relay.example/", "ABCD-EFGH", server_id="server-uuid-1",
        live_activity=True,
    )
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(502))

    assert m.send_live_activity({"phase": "done"}) == {
        "sent": 0,
        "pruned": 0,
        "total": 1,
        "retryable": 1,
        "failed": 0,
    }


def test_live_activity_send_counts_non_retryable_rejections_as_failed(monkeypatch):
    """A 403 is neither a delivery nor something a retry can fix.

    It used to increment nothing at all, so a mixed result read as a clean
    success upstream and the keyframe was dropped with no trace.
    """
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(200))
    m.add_target(
        "https://relay.example/", "GOOD-CODE", server_id="server-1",
        live_activity=True,
    )
    m.add_target(
        "https://relay.example/", "BAD-CODE", server_id="server-2",
        live_activity=True,
    )

    def post(url, json, timeout):
        return _Resp(200 if json.get("pairing_code") == "GOOD-CODE" else 403)

    monkeypatch.setattr(m.requests, "post", post)

    assert m.send_live_activity({"phase": "done"}) == {
        "sent": 1,
        "pruned": 0,
        "total": 2,
        "retryable": 0,
        "failed": 1,
    }


def test_live_only_target_is_hidden_from_notification_status_and_completion(monkeypatch):
    requests = []
    monkeypatch.setattr(
        m.requests,
        "post",
        lambda url, json, timeout: (requests.append(url), _Resp(200))[1],
    )
    assert m.add_target(
        "https://relay.example/", "ABCD-EFGH", server_id="server-uuid-1",
        live_activity=True,
    )

    assert m.live_activity_target_count() == 1
    assert m.list_targets() == []
    assert m.send_completion("p1", "success", 1) == {
        "sent": 0, "pruned": 0, "total": 0,
    }
    assert requests == ["https://relay.example/live-activity/verify"]


def test_notification_disable_preserves_but_hides_live_target(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(200))
    assert m.add_target(
        "https://relay.example/", "ABCD-EFGH", live_activity=True
    )
    assert m.add_target("https://relay.example/", "ABCD-EFGH")
    assert len(m.list_targets()) == 1

    assert m.remove_target(
        "ABCD-EFGH", "https://relay.example/", notifications_only=True
    ) == 1
    assert m.list_targets() == []
    assert m.live_activity_target_count() == 1


def test_live_activity_disable_preserves_notification_target(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(200))
    assert m.add_target(
        "https://relay.example/", "ABCD-EFGH", label="iPhone",
        server_id="server-uuid-1",
    )
    assert m.add_target(
        "https://relay.example/", "ABCD-EFGH", live_activity=True,
        server_id="server-uuid-1", server_label="Homelab",
        frequent_updates=True, relevance_score=2,
    )

    assert m.remove_live_activity_target(
        "ABCD-EFGH", "https://relay.example/"
    ) == 1
    assert m.live_activity_target_count() == 0
    assert len(m.list_targets()) == 1
    stored = m._load_targets()[0]
    assert stored.get("live_activity") is None
    assert stored.get("server_label") is None
    assert stored.get("frequent_updates") is None
    assert stored.get("relevance_score") is None
    assert stored["server_id"] == "server-uuid-1"


def test_live_activity_disable_removes_live_only_target(monkeypatch):
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(200))
    assert m.add_target(
        "https://relay.example/", "ABCD-EFGH", live_activity=True
    )

    assert m.remove_live_activity_target(
        "ABCD-EFGH", "https://relay.example/"
    ) == 1
    assert m.live_activity_target_count() == 0
    assert m._load_targets() == []


def test_live_activity_disable_rejects_malformed_relay_without_removing():
    assert m.add_target(
        "https://relay.example/", "ABCD-EFGH", live_activity=True
    )

    assert m.remove_live_activity_target("ABCD-EFGH", " ") == 0
    assert m.live_activity_target_count() == 1


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


def test_live_target_forwards_server_presentation_and_capabilities(monkeypatch, tmp_path: Path):
    captured = []
    monkeypatch.setattr(
        m.requests,
        "post",
        lambda url, json, timeout: (captured.append(json), _Resp(200))[1],
    )
    assert m.add_target(
        "https://relay.example/",
        "ABCD-EFGH",
        server_id="server-1",
        server_label="Homelab",
        live_activity=True,
        frequent_updates=False,
        relevance_score=3,
    )
    saved = json.loads(
        (tmp_path / "default" / "mobile" / "push" / "app_targets.json").read_text()
    )[0]
    assert saved["server_label"] == "Homelab"
    assert saved["frequent_updates"] is False
    assert saved["relevance_score"] == 3

    captured.clear()
    m.send_live_activity({"phase": "generating", "delivery": "keyframe"})
    assert captured[0]["server_label"] == "Homelab"
    assert captured[0]["relevance_score"] == 3


def test_nonfrequent_targets_throttle_only_replaceable_routine_updates(monkeypatch):
    captured = []
    monkeypatch.setattr(
        m.requests,
        "post",
        lambda url, json, timeout: (captured.append(json), _Resp(200))[1],
    )
    assert m.add_target(
        "https://relay.example/", "ABCD-EFGH",
        live_activity=True, frequent_updates=False,
    )
    captured.clear()
    moments = iter([100.0, 101.0])
    monkeypatch.setattr(m.time, "monotonic", lambda: next(moments))

    assert m.send_live_activity({"phase": "generating", "delivery": "routine"})["sent"] == 1
    assert m.send_live_activity({"phase": "generating", "delivery": "routine"})["total"] == 0
    assert m.send_live_activity({"phase": "done", "delivery": "keyframe"})["sent"] == 1
    assert len(captured) == 2


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
# --- per-account routing --------------------------------------------------
#
# On a server running comfyui-multiuser, "every paired device" is several
# different people's phones. A completion belongs to the account that queued
# it, and so does the notification.


def test_a_pairing_records_the_account_that_registered_it():
    assert m.add_target("https://relay.example/", "ABCD-EFGH", label="iPhone",
                        owner="u1")
    assert m._load_targets()[0]["user_id"] == "u1"


def test_a_completion_reaches_only_the_owners_devices(monkeypatch):
    m.add_target("https://relay.example/", "AAAA", label="u1 phone", owner="u1")
    m.add_target("https://relay.example/", "BBBB", label="u2 phone", owner="u2")
    posted = []
    monkeypatch.setattr(m.requests, "post",
                        lambda url, json=None, timeout=None: (
                            posted.append(json["pairing_code"]) or _Resp(200)))

    result = m.send_completion("pid-1", "success", 1, owner="u1")
    assert posted == ["AAAA"]
    assert result["sent"] == 1


def test_a_server_without_accounts_still_notifies_every_device(monkeypatch):
    """The single-user behaviour this node has always had. `owner=None` is not
    a fallback here — it is the correct answer when there is one user."""
    m.add_target("https://relay.example/", "AAAA", label="Phone")
    m.add_target("https://relay.example/", "BBBB", label="Tablet")
    posted = []
    monkeypatch.setattr(m.requests, "post",
                        lambda url, json=None, timeout=None: (
                            posted.append(json["pairing_code"]) or _Resp(200)))

    m.send_completion("pid-1", "success", 1)
    assert sorted(posted) == ["AAAA", "BBBB"]


def test_a_device_paired_before_accounts_existed_is_skipped(monkeypatch, capsys):
    """It belongs to nobody, so it cannot be shown to somebody. Silencing it
    until it re-pairs beats broadcasting one person's completions to whoever
    happened to pair first — but say so, or the silence is unexplainable."""
    m.add_target("https://relay.example/", "LEGACY", label="Old phone")
    monkeypatch.setattr(m, "_warned_unowned", False)
    posted = []
    monkeypatch.setattr(m.requests, "post",
                        lambda url, json=None, timeout=None: (
                            posted.append(json["pairing_code"]) or _Resp(200)))

    m.send_completion("pid-1", "success", 1, owner="u1")
    assert posted == []
    assert "re-pair" in capsys.readouterr().out.lower()


def test_the_target_list_shows_only_your_own_devices():
    m.add_target("https://relay.example/", "AAAA", label="u1 phone", owner="u1")
    m.add_target("https://relay.example/", "BBBB", label="u2 phone", owner="u2")
    assert [t["label"] for t in m.list_targets(owner="u1")] == ["u1 phone"]
    assert m.target_count(owner="u1") == 1
    # With no accounts on the server, every pairing is yours.
    assert m.target_count() == 2


def test_the_deletion_sweep_drops_only_that_account():
    """`remove_owned_targets` is the account-deletion sweep for this store:
    the deleted account's pairings go, everyone else's — including unowned
    legacy ones — stays."""
    m.add_target("https://relay.example/", "AAAA", label="u1 phone", owner="u1")
    m.add_target("https://relay.example/", "BBBB", label="u2 phone", owner="u2")
    m.add_target("https://relay.example/", "CCCC", label="legacy phone")

    assert m.remove_owned_targets("u1") == 1

    assert [t["label"] for t in m.list_targets()] == ["u2 phone", "legacy phone"]
    assert m.target_count(owner="u2") == 1
    assert m.target_count() == 2


def test_the_deletion_sweep_is_inert_for_junk_and_strays():
    m.add_target("https://relay.example/", "AAAA", label="u1 phone", owner="u1")
    assert m.remove_owned_targets(None) == 0
    assert m.remove_owned_targets("") == 0
    assert m.remove_owned_targets("nobody") == 0
    assert m.target_count() == 1


def test_one_account_cannot_unpair_anothers_phone():
    m.add_target("https://relay.example/", "AAAA", label="u1 phone", owner="u1")
    assert m.remove_target("AAAA", owner="u2") == 0
    assert m.target_count() == 1
    assert m.remove_target("AAAA", owner="u1") == 1


def test_a_test_notification_goes_to_your_own_devices(monkeypatch):
    m.add_target("https://relay.example/", "AAAA", label="u1 phone", owner="u1")
    m.add_target("https://relay.example/", "BBBB", label="u2 phone", owner="u2")
    posted = []
    monkeypatch.setattr(m.requests, "post",
                        lambda url, json=None, timeout=None: (
                            posted.append(json["pairing_code"]) or _Resp(200)))

    m.send_test(owner="u2")
    assert posted == ["BBBB"]


def test_live_activity_frames_go_only_to_the_owners_devices(monkeypatch):
    """The ActivityKit relay was the one push channel with no owner scoping:
    every paired iPhone animated every user's workflow label in real time."""
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(200))
    m.add_target("https://relay.example/", "AAAA", owner="u1",
                 live_activity=True)
    m.add_target("https://relay.example/", "BBBB", owner="u2",
                 live_activity=True)
    posted = []
    monkeypatch.setattr(m.requests, "post",
                        lambda url, json=None, timeout=None: (
                            posted.append(json["pairing_code"]) or _Resp(200)))

    m.send_live_activity({"phase": "generating", "prompt_id": "p1",
                          "delivery": "keyframe"}, owner="u1")
    assert posted == ["AAAA"]

    posted.clear()
    # An unowned prompt (or a server with no accounts) keeps the broadcast.
    m.send_live_activity({"phase": "generating", "prompt_id": "p1",
                          "delivery": "keyframe"})
    assert sorted(posted) == ["AAAA", "BBBB"]


def test_target_count_agrees_with_the_listed_targets():
    """The add-response's count is what the settings screen shows, so it must
    never exceed the devices the listing renders — a Live-Activity-only
    pairing (notifications off) is hidden from both."""
    assert m.add_target("https://relay.example/", "AAAA", label="iPhone")
    assert m.add_target("https://relay.example/", "BBBB", live_activity=True)
    assert len(m._load_targets()) == 2
    assert len(m.list_targets()) == 1
    assert m.target_count() == 1
    # Still owner-scoped like the listing.
    assert m.add_target("https://relay.example/", "CCCC", owner="u1")
    assert m.target_count(owner="u1") == len(m.list_targets(owner="u1")) == 1


# --- one phone, two entries for this server --------------------------------
#
# The app lets a server be added twice, signed in as a different account each
# time. Both entries share the phone's pairing code; `server_id` is what keeps
# them two separate pairings rather than one that the last sign-in owns.


def _pair_admin_and_demo_on_one_phone(**kwargs):
    assert m.add_target("https://relay.example/", "PHONE", owner="admin",
                        server_id="entry-admin", **kwargs)
    assert m.add_target("https://relay.example/", "PHONE", owner="demo",
                        server_id="entry-demo", **kwargs)


def _record_posts(monkeypatch, status=200):
    posted = []
    monkeypatch.setattr(m.requests, "post",
                        lambda url, json=None, timeout=None: (
                            posted.append(json.get("server_id")) or _Resp(status)))
    return posted


def test_a_second_entry_on_the_same_phone_does_not_replace_the_first():
    _pair_admin_and_demo_on_one_phone()
    stored = {t["server_id"]: t["user_id"] for t in m._load_targets()}
    assert stored == {"entry-admin": "admin", "entry-demo": "demo"}


def test_each_accounts_completion_reaches_its_own_entry(monkeypatch):
    _pair_admin_and_demo_on_one_phone()
    posted = _record_posts(monkeypatch)

    m.send_completion("p-demo", "success", 1, owner="demo")
    assert posted == ["entry-demo"]

    posted.clear()
    m.send_completion("p-admin", "success", 1, owner="admin")
    assert posted == ["entry-admin"]


def test_re_pairing_an_entry_updates_only_that_entry():
    _pair_admin_and_demo_on_one_phone()
    assert m.add_target("https://relay.example/", "PHONE", label="re-paired",
                        owner="demo", server_id="entry-demo")
    labels = {t["server_id"]: t["label"] for t in m._load_targets()}
    assert labels == {"entry-admin": "Device", "entry-demo": "re-paired"}


def test_an_entry_signed_into_another_account_moves_with_it():
    assert m.add_target("https://relay.example/", "PHONE", owner="admin",
                        server_id="entry-1")
    assert m.add_target("https://relay.example/", "PHONE", owner="demo",
                        server_id="entry-1")
    assert [(t["server_id"], t["user_id"]) for t in m._load_targets()] == [
        ("entry-1", "demo"),
    ]


def test_turning_one_entry_off_leaves_the_other_paired():
    _pair_admin_and_demo_on_one_phone()
    assert m.remove_target("PHONE", "https://relay.example", owner="demo",
                           server_id="entry-demo") == 1
    assert [t["server_id"] for t in m._load_targets()] == ["entry-admin"]


def test_turning_one_entry_off_on_a_server_without_accounts():
    """Same phone, same server, no accounts: still two entries."""
    assert m.add_target("https://relay.example/", "PHONE", server_id="a")
    assert m.add_target("https://relay.example/", "PHONE", server_id="b")
    assert m.remove_target("PHONE", "https://relay.example", server_id="a") == 1
    assert [t["server_id"] for t in m._load_targets()] == ["b"]


def test_an_app_without_server_ids_still_unpairs_the_whole_device():
    _pair_admin_and_demo_on_one_phone()
    assert m.remove_target("PHONE", "https://relay.example") == 2


def test_live_activity_removal_is_per_entry():
    _pair_admin_and_demo_on_one_phone(live_activity=True)
    assert m.remove_live_activity_target(
        "PHONE", "https://relay.example", owner="admin",
        server_id="entry-admin") == 1
    # Live-only pairings, so admin's goes entirely; demo's is untouched.
    assert [(t["server_id"], t.get("live_activity"))
            for t in m._load_targets()] == [("entry-demo", True)]


def test_a_legacy_pairing_is_upgraded_in_place_by_the_same_account():
    assert m.add_target("https://relay.example/", "PHONE", owner="demo")
    assert m.add_target("https://relay.example/", "PHONE", owner="demo",
                        server_id="entry-demo")
    assert [t.get("server_id") for t in m._load_targets()] == ["entry-demo"]


def test_another_accounts_legacy_pairing_is_left_for_it_to_replace():
    assert m.add_target("https://relay.example/", "PHONE", owner="admin")
    assert m.add_target("https://relay.example/", "PHONE", owner="demo",
                        server_id="entry-demo")
    assert sorted((t.get("server_id") or "", t["user_id"])
                  for t in m._load_targets()) == [("", "admin"),
                                                  ("entry-demo", "demo")]


def test_a_relay_410_prunes_only_the_removed_entry(monkeypatch):
    _pair_admin_and_demo_on_one_phone()
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(410))
    m.send_completion("p", "success", 1, owner="demo")
    assert [t["server_id"] for t in m._load_targets()] == ["entry-admin"]


def test_a_relay_409_mutes_only_that_entry(monkeypatch):
    _pair_admin_and_demo_on_one_phone()
    monkeypatch.setattr(m.requests, "post", lambda *a, **k: _Resp(409))
    m.send_completion("p", "success", 1, owner="demo")
    flags = {t["server_id"]: t.get("notifications", True)
             for t in m._load_targets()}
    assert flags == {"entry-admin": True, "entry-demo": False}


def test_the_listing_names_each_entry():
    _pair_admin_and_demo_on_one_phone()
    assert [t["server_id"] for t in m.list_targets(owner="demo")] == ["entry-demo"]
