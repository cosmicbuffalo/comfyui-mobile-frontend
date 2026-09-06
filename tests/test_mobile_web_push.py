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
        "https://push.example/en-endpoint": {
            "endpoint": "https://push.example/en-endpoint",
        },
        "https://push.example/ja-endpoint": {
            "endpoint": "https://push.example/ja-endpoint",
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

    english = _payload_for(push["sent"], "https://push.example/en-endpoint")
    japanese = _payload_for(push["sent"], "https://push.example/ja-endpoint")

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

    english = _payload_for(push["sent"], "https://push.example/en-endpoint")
    assert english["title"] == mobile_web_push._PUSH_MESSAGES["en"]["generation_failed_title"]


def test_empty_output_count_uses_the_countless_body(push):
    mobile_web_push.send_completion("prompt-1", "success", 0)

    english = _payload_for(push["sent"], "https://push.example/en-endpoint")
    assert english["body"] == mobile_web_push._PUSH_MESSAGES["en"]["render_complete_body_empty"]


def test_send_test_localizes_per_subscription(push):
    result = mobile_web_push.send_test()

    assert result == {"sent": 2, "pruned": 0, "total": 2}
    english = _payload_for(push["sent"], "https://push.example/en-endpoint")
    japanese = _payload_for(push["sent"], "https://push.example/ja-endpoint")
    assert english["title"] == mobile_web_push._PUSH_MESSAGES["en"]["test_title"]
    assert japanese["title"] == mobile_web_push._PUSH_MESSAGES["ja"]["test_title"]
    assert english["data"] == {"test": True}


def test_a_gone_subscription_is_pruned(push):
    push["results"]["https://push.example/ja-endpoint"] = "gone"

    result = mobile_web_push.send_completion("prompt-1", "success", 1)

    assert result == {"sent": 1, "pruned": 1, "total": 2}
    assert "https://push.example/ja-endpoint" not in push["subs"]
    assert "https://push.example/en-endpoint" in push["subs"]


def test_an_errored_send_is_neither_counted_nor_pruned(push):
    push["results"]["https://push.example/ja-endpoint"] = "error"

    result = mobile_web_push.send_completion("prompt-1", "success", 1)

    assert result == {"sent": 1, "pruned": 0, "total": 2}
    assert "https://push.example/ja-endpoint" in push["subs"]


def test_an_unknown_locale_falls_back_to_english(push):
    push["subs"]["https://push.example/ja-endpoint"]["locale"] = "de"

    mobile_web_push.send_completion("prompt-1", "success", 1)

    fallback = _payload_for(push["sent"], "https://push.example/ja-endpoint")
    assert fallback["title"] == mobile_web_push._PUSH_MESSAGES["en"]["render_complete_title"]


def test_nothing_is_sent_when_push_is_unavailable(push, monkeypatch):
    monkeypatch.setattr(mobile_web_push, "_PUSH_AVAILABLE", False)

    result = mobile_web_push.send_completion("prompt-1", "success", 1)

    assert result == {"sent": 0, "pruned": 0, "total": 0}
    assert push["sent"] == []
