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
    assert entry["secret"] == "s3cret"
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


def test_refollowing_replaces_and_old_entries_drop_off(follows_file):
    for number in range(1, follows.MAX_FOLLOWS + 3):
        follows.add_follow("default", number, "t", "s", True)
    follows.add_follow("default", 5, "t", "new", True)

    numbers = [e["number"] for e in follows.list_follows("default")]
    assert len(numbers) == follows.MAX_FOLLOWS
    assert 1 not in numbers and 2 not in numbers
    assert numbers[-1] == 5
    assert follows.list_follows("default")[-1]["secret"] == "new"


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
