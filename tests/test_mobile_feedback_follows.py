import json

import pytest

import mobile_auth
import mobile_feedback_follows as follows
import mobile_routes_system


@pytest.fixture
def follows_file(tmp_path, monkeypatch):
    path = tmp_path / "mobile" / "feedback_follows.json"
    monkeypatch.setattr(follows, "_follows_path", lambda: str(path))
    monkeypatch.setattr(follows, "_follows", None)
    return path


def test_add_persists_and_lists_per_user(follows_file):
    assert follows.add_follow("default", 7, " Crash on save ", "s3cret", True)

    [entry] = follows.list_follows("default")
    assert entry["number"] == 7
    assert entry["title"] == "Crash on save"
    assert set(entry) == {"number", "title", "canReply", "followedAt", "seenAt"}
    assert follows.get_reply_token("default", 7) == "s3cret"
    assert entry["canReply"] is True
    assert entry["seenAt"] == entry["followedAt"]
    assert follows.list_follows("someone-else") == []
    assert json.loads(follows_file.read_text())["default"][0]["number"] == 7


def test_rejects_bad_entries(follows_file):
    assert not follows.add_follow("default", 0, "t", "s", True)
    assert not follows.add_follow("default", True, "t", "s", True)
    assert not follows.add_follow("default", "7", "t", "s", True)
    assert not follows.add_follow("default", 7, "t", "", True)
    assert not follows.add_follow("default", 7, "t", "x" * 101, True)
    assert not follows.add_follow("default", 7, "t", "s", None)
    assert not follows_file.exists()


def test_refollowing_replaces_the_entry(follows_file):
    follows.add_follow("default", 5, "t", "old", True)
    follows.add_follow("default", 6, "t", "s", True)
    follows.add_follow("default", 5, "t", "new", True)

    assert [(e["number"], follows.get_reply_token("default", e["number"])) for e in follows.list_follows("default")] == [(6, "s"), (5, "new")]


def test_seen_only_moves_forward(follows_file):
    follows.add_follow("default", 7, "t", "s", True)
    start = follows.list_follows("default")[0]["seenAt"]

    assert follows.mark_seen("default", 7, start + 1000)
    assert not follows.mark_seen("default", 7, "soon")
    assert follows.mark_seen("default", 7, start)
    assert follows.list_follows("default")[0]["seenAt"] == start + 1000
    assert not follows.mark_seen("default", 8, start)


def test_remove(follows_file):
    follows.add_follow("default", 7, "t", "s", True)

    assert follows.remove_follow("default", 7)
    assert not follows.remove_follow("default", 7)
    assert json.loads(follows_file.read_text()) == {}


def test_user_key_without_auth(monkeypatch):
    monkeypatch.setattr(mobile_auth, "is_enabled", lambda: False)
    assert mobile_routes_system._feedback_user_key() == "default"


def test_user_key_with_auth(monkeypatch):
    monkeypatch.setattr(mobile_auth, "is_enabled", lambda: True)
    monkeypatch.setattr(mobile_auth, "current_user", lambda: {"id": 42, "roles": []})
    assert mobile_routes_system._feedback_user_key() == "42"
    # Auth on but no user (or a broken auth layer) must not fall back to the
    # shared list.
    monkeypatch.setattr(mobile_auth, "current_user", lambda: None)
    assert mobile_routes_system._feedback_user_key() is None


@pytest.mark.parametrize("token_key", ["secret", "replyToken", "reply_token"])
def test_load_and_save_token_key(follows_file, token_key):
    follows_file.parent.mkdir(parents=True)
    follows_file.write_text(json.dumps({"default": [{"number": 7, token_key: "legacy", "title": "t",
                                                     "canReply": True, "followedAt": 1, "seenAt": 1}]}))
    assert follows.get_reply_token("default", 7) == "legacy"
    assert set(follows.list_follows("default")[0]) == {"number", "title", "canReply", "followedAt", "seenAt"}
    assert follows.mark_seen("default", 7, 2)
    entry = json.loads(follows_file.read_text())["default"][0]
    assert entry["reply_token"] == "legacy"
    assert "secret" not in entry and "replyToken" not in entry


@pytest.fixture
def route_call(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    monkeypatch.setattr(mobile_routes_system, "web", SimpleNamespace(
        json_response=lambda data, status=200: SimpleNamespace(data=data, status=status)))

    def call(handler, number=7, body=None):
        async def json_body():
            return body
        return asyncio.run(handler(SimpleNamespace(match_info={"number": str(number)}, json=json_body)))
    return call


@pytest.mark.parametrize("action", ["get", "add", "seen", "delete"])
def test_route_lists_never_include_tokens(follows_file, monkeypatch, route_call, action):
    monkeypatch.setattr(mobile_auth, "is_enabled", lambda: False)
    follows.add_follow("default", 7, "t", "private", True)
    follows.add_follow("default", 8, "kept", "other", False)
    body = {"number": 7, "title": "t", "replyToken": "new", "canReply": True, "seenAt": 9999999999999}
    response = route_call(getattr(mobile_routes_system, "api_feedback_follows_" + action), body=body)
    assert response.status == 200
    assert response.data["follows"]
    for entry in response.data["follows"]:
        assert set(entry) == {"number", "title", "canReply", "followedAt", "seenAt"}


@pytest.mark.parametrize("user,number,expected", [("alice", 7, 200), ("alice", 8, 404),
                                                  ("bob", 7, 200), ("eve", 7, 404), (None, 7, 403)])
def test_reply_token_is_scoped_to_signed_in_user(follows_file, monkeypatch, route_call, user, number, expected):
    monkeypatch.setattr(mobile_auth, "is_enabled", lambda: True)
    monkeypatch.setattr(mobile_auth, "current_user", lambda: {"id": user} if user else None)
    follows.add_follow("alice", 7, "a", "alice-token", True)
    follows.add_follow("bob", 7, "b", "bob-token", True)
    response = route_call(mobile_routes_system.api_feedback_follows_reply_token, number=number)
    assert response.status == expected
    if expected == 200:
        assert response.data == {"replyToken": user + "-token"}
