"""Cover the locale-grouped fan-out that replaced the old single-language
`send_to_all`: every subscriber has to receive copy in the language they
subscribed with, and a subscription the push service reports as gone has to be
forgotten."""
import pytest

import mobile_web_push


@pytest.fixture
def push(monkeypatch):
    """A push module with two subscribers, a stub VAPID key, and `_send_one`
    recorded instead of actually posting to a push service."""
    subs = {
        "https://fcm.googleapis.com/fcm/send/en-endpoint": {
            "endpoint": "https://fcm.googleapis.com/fcm/send/en-endpoint",
        },
        "https://web.push.apple.com/ja-endpoint": {
            "endpoint": "https://web.push.apple.com/ja-endpoint",
            "locale": "ja",
        },
    }
    sent = []
    results = {}

    monkeypatch.setattr(mobile_web_push, "_PUSH_AVAILABLE", True)
    monkeypatch.setattr(mobile_web_push, "_load_subscriptions", lambda: subs)
    monkeypatch.setattr(mobile_web_push, "_save_subscriptions", lambda: None)
    monkeypatch.setattr(
        mobile_web_push, "_load_or_create_vapid", lambda: {"vapid_obj": object()}
    )

    def fake_send_one(subscription, payload_json, _vapid_obj):
        endpoint = subscription["endpoint"]
        sent.append((endpoint, payload_json))
        return results.get(endpoint, "ok")

    monkeypatch.setattr(mobile_web_push, "_send_one", fake_send_one)
    return {"subs": subs, "sent": sent, "results": results}


def _payload_for(sent, endpoint):
    import json

    for sent_endpoint, payload_json in sent:
        if sent_endpoint == endpoint:
            return json.loads(payload_json)
    raise AssertionError(f"nothing sent to {endpoint}")


def test_send_completion_localizes_per_subscription(push):
    result = mobile_web_push.send_completion("prompt-1", "success", 2)

    assert result == {"sent": 2, "pruned": 0, "total": 2}

    english = _payload_for(push["sent"], "https://fcm.googleapis.com/fcm/send/en-endpoint")
    japanese = _payload_for(push["sent"], "https://web.push.apple.com/ja-endpoint")

    assert english["title"] == mobile_web_push._PUSH_MESSAGES["en"]["render_complete_title"]
    assert japanese["title"] == mobile_web_push._PUSH_MESSAGES["ja"]["render_complete_title"]
    assert english["title"] != japanese["title"]
    # The output count is interpolated into each language's own body string.
    assert "2" in english["body"] and "2" in japanese["body"]
    # `data` rides along unchanged on every group.
    assert english["data"] == {"prompt_id": "prompt-1", "status": "success"}
    assert japanese["data"] == english["data"]


def test_send_completion_uses_the_failure_copy_on_error(push):
    mobile_web_push.send_completion("prompt-1", "error", 0)

    english = _payload_for(push["sent"], "https://fcm.googleapis.com/fcm/send/en-endpoint")
    assert english["title"] == mobile_web_push._PUSH_MESSAGES["en"]["generation_failed_title"]


def test_empty_output_count_uses_the_countless_body(push):
    mobile_web_push.send_completion("prompt-1", "success", 0)

    english = _payload_for(push["sent"], "https://fcm.googleapis.com/fcm/send/en-endpoint")
    assert english["body"] == mobile_web_push._PUSH_MESSAGES["en"]["render_complete_body_empty"]


def test_send_test_localizes_per_subscription(push):
    result = mobile_web_push.send_test()

    assert result == {"sent": 2, "pruned": 0, "total": 2}
    english = _payload_for(push["sent"], "https://fcm.googleapis.com/fcm/send/en-endpoint")
    japanese = _payload_for(push["sent"], "https://web.push.apple.com/ja-endpoint")
    assert english["title"] == mobile_web_push._PUSH_MESSAGES["en"]["test_title"]
    assert japanese["title"] == mobile_web_push._PUSH_MESSAGES["ja"]["test_title"]
    assert english["data"] == {"test": True}


def test_a_gone_subscription_is_pruned(push):
    push["results"]["https://web.push.apple.com/ja-endpoint"] = "gone"

    result = mobile_web_push.send_completion("prompt-1", "success", 1)

    assert result == {"sent": 1, "pruned": 1, "total": 2}
    assert "https://web.push.apple.com/ja-endpoint" not in push["subs"]
    assert "https://fcm.googleapis.com/fcm/send/en-endpoint" in push["subs"]


def test_an_errored_send_is_neither_counted_nor_pruned(push):
    push["results"]["https://web.push.apple.com/ja-endpoint"] = "error"

    result = mobile_web_push.send_completion("prompt-1", "success", 1)

    assert result == {"sent": 1, "pruned": 0, "total": 2}
    assert "https://web.push.apple.com/ja-endpoint" in push["subs"]


def test_an_unknown_locale_falls_back_to_english(push):
    push["subs"]["https://web.push.apple.com/ja-endpoint"]["locale"] = "de"

    mobile_web_push.send_completion("prompt-1", "success", 1)

    fallback = _payload_for(push["sent"], "https://web.push.apple.com/ja-endpoint")
    assert fallback["title"] == mobile_web_push._PUSH_MESSAGES["en"]["render_complete_title"]


def test_nothing_is_sent_when_push_is_unavailable(push, monkeypatch):
    monkeypatch.setattr(mobile_web_push, "_PUSH_AVAILABLE", False)

    result = mobile_web_push.send_completion("prompt-1", "success", 1)

    assert result == {"sent": 0, "pruned": 0, "total": 0}
    assert push["sent"] == []


# --- Endpoint allowlist: the server POSTs to whatever endpoint it stores, so
# only real browser push services may be stored or contacted (SSRF guard). ---

_KEYS = {"p256dh": "p", "auth": "a"}


@pytest.fixture
def store(monkeypatch):
    subs = {}
    monkeypatch.setattr(mobile_web_push, "_load_subscriptions", lambda: subs)
    monkeypatch.setattr(mobile_web_push, "_save_subscriptions", lambda: None)
    monkeypatch.delenv("COMFYUI_MOBILE_WEB_PUSH_HOSTS", raising=False)
    return subs


@pytest.mark.parametrize("endpoint", [
    "https://web.push.apple.com/QGuQyavXutnMH",
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
])
def test_real_push_service_endpoints_are_accepted(store, endpoint):
    assert mobile_web_push.add_subscription({"endpoint": endpoint, "keys": _KEYS})
    assert endpoint in store


@pytest.mark.parametrize("endpoint", [
    "http://127.0.0.1:8188/api/interrupt",
    "https://127.0.0.1/anything",
    "https://192.168.1.10/admin",
    "https://localhost/x",
    "http://fcm.googleapis.com/fcm/send/x",            # not HTTPS
    "https://fcm.googleapis.com:8443/fcm/send/x",      # non-default port
    "https://user:pw@fcm.googleapis.com/fcm/send/x",   # credentials
    "https://fcm.googleapis.com.evil.example/x",       # allowlisted name as a prefix
    "https://evilfcm.googleapis.com/x",                # suffix without a dot boundary
    "https://storage.googleapis.com/bucket/x",         # sibling of an allowed host
    "https://push.example/endpoint",
    "not a url",
    "",
])
def test_other_endpoints_are_refused(store, endpoint):
    assert not mobile_web_push.add_subscription({"endpoint": endpoint, "keys": _KEYS})
    assert store == {}


def test_operators_can_allow_another_push_service(store, monkeypatch):
    endpoint = "https://push.example.org/wpush/v2/abc"
    assert not mobile_web_push.add_subscription({"endpoint": endpoint, "keys": _KEYS})

    monkeypatch.setenv("COMFYUI_MOBILE_WEB_PUSH_HOSTS", " push.example.org , other.example ")

    assert mobile_web_push.add_subscription({"endpoint": endpoint, "keys": _KEYS})
    # A subdomain of a configured host is covered; its parent is not.
    assert mobile_web_push.endpoint_allowed("https://eu.push.example.org/x")
    assert not mobile_web_push.endpoint_allowed("https://example.org/x")


def test_a_stored_endpoint_off_the_allowlist_is_dropped_without_being_contacted(push):
    # Stored by an older version, before subscribe checked the destination.
    internal = "http://127.0.0.1:8188/api/interrupt"
    push["subs"][internal] = {"endpoint": internal, "keys": _KEYS}

    result = mobile_web_push.send_test()

    assert [endpoint for endpoint, _ in push["sent"]] == [
        "https://fcm.googleapis.com/fcm/send/en-endpoint",
        "https://web.push.apple.com/ja-endpoint",
    ]
    assert internal not in push["subs"]
    assert result == {"sent": 2, "pruned": 1, "total": 3}


def test_a_stored_entry_whose_body_points_elsewhere_is_dropped(push):
    # webpush() posts to the value's endpoint, not the key it is stored under.
    key = "https://fcm.googleapis.com/fcm/send/en-endpoint"
    push["subs"][key] = {"endpoint": "http://10.0.0.5/internal", "keys": _KEYS}

    result = mobile_web_push.send_test()

    assert all(endpoint != "http://10.0.0.5/internal" for endpoint, _ in push["sent"])
    assert key not in push["subs"]
    assert result["pruned"] == 1


@pytest.mark.parametrize("entry", [
    "push.example.org",
    "*.push.example.org",
    "https://push.example.org/wpush/v2/abc",
    "PUSH.EXAMPLE.ORG.",
])
def test_host_entries_are_read_the_way_operators_write_them(store, monkeypatch, entry):
    monkeypatch.setenv("COMFYUI_MOBILE_WEB_PUSH_HOSTS", entry)
    assert mobile_web_push.endpoint_allowed("https://push.example.org/x")
    assert mobile_web_push.endpoint_allowed("https://eu.push.example.org/x")
    assert not mobile_web_push.endpoint_allowed("https://example.org/x")


def test_refused_host_names_an_unlisted_push_service_only(store):
    sub = lambda endpoint: {"endpoint": endpoint, "keys": _KEYS}
    assert mobile_web_push.refused_host(sub("https://Push.Example.org/x")) == "push.example.org"
    # Allowed, or not a push endpoint at all: nothing for an operator to add.
    assert mobile_web_push.refused_host(sub("https://fcm.googleapis.com/fcm/send/x")) is None
    assert mobile_web_push.refused_host(sub("http://127.0.0.1:8188/x")) is None
    assert mobile_web_push.refused_host(sub("not a url")) is None
    assert mobile_web_push.refused_host(None) is None
