"""The completion push gate honors the prompt OWNER's preferences.

_handle_completion used to read one global preferences file before fan-out,
so anyone's "don't notify me" silenced everyone. Preferences are per account
now: the person who queued the job is the one the push targets, so their
store decides notifyOnComplete/includeThumbnail. Unowned prompts and
gate-off servers keep the legacy global store — the pre-multiuser behavior.
"""
import asyncio
import json
from types import SimpleNamespace

import pytest

import mobile_push
import mobile_push_prefs

U1 = {"id": "u1", "roles": ["public"]}
ADMIN = {"id": "boss", "roles": ["admin"]}


def _entry(owner, with_image=False):
    outputs = {}
    if with_image:
        outputs = {"9": {"images": [
            {"filename": "out.png", "subfolder": "", "type": "output"}]}}
    return {
        "prompt": {"owner": owner},
        "status": {"status_str": "success"},
        "outputs": outputs,
    }


@pytest.fixture
def gate(tmp_path, monkeypatch):
    import mobile_auth

    push_dir = tmp_path / "push"
    monkeypatch.setattr(mobile_push_prefs, "_push_dir", lambda: str(push_dir))
    monkeypatch.setattr(mobile_push_prefs, "_prefs_path",
                        lambda: str(push_dir / "preferences.json"))
    monkeypatch.setattr(mobile_push_prefs, "_stores", {})
    monkeypatch.setattr(mobile_auth, "is_enabled", lambda: True)

    sends = []

    def send_completion(prompt_id, status, outputs, image_url, click_url,
                        owner=None):
        sends.append({"owner": owner, "image_url": image_url})
        return {"sent": 1, "pruned": 0, "total": 1}

    monkeypatch.setattr(mobile_push, "_mobile_web_push", SimpleNamespace(
        is_available=lambda: True, send_completion=send_completion))
    monkeypatch.setattr(mobile_push, "_mobile_app_push", None)
    monkeypatch.setattr(mobile_push, "_mobile_progress_ws", None)
    # Mirrors the real module's contract: a genuinely unowned job answers None
    # and still notifies, while OWNER_UNKNOWN ("the node is gating but cannot
    # say whose") is the case mobile_push refuses to fan out.
    monkeypatch.setattr(mobile_push, "_mobile_auth", SimpleNamespace(
        prompt_owner=lambda p: p.get("owner") if isinstance(p, dict) else None,
        prompt_owner_or_unknown=(
            lambda p: p.get("owner") if isinstance(p, dict) else None),
        OWNER_UNKNOWN=mobile_auth.OWNER_UNKNOWN,
        is_enabled=lambda: True))
    return sends


def test_the_owners_prefs_gate_their_completion_push(gate):
    mobile_push_prefs.set_prefs({"notifyOnComplete": False}, viewer=U1)

    asyncio.run(mobile_push._handle_completion("p1", _entry("u1")))
    assert gate == []  # u1 opted out; their job stays silent

    asyncio.run(mobile_push._handle_completion("p2", _entry("u2")))
    assert gate == [{"owner": "u2", "image_url": None}]  # u2 did not


def test_the_owners_thumbnail_pref_decides_the_payload(gate):
    mobile_push_prefs.set_prefs({"includeThumbnail": True}, viewer=U1)

    asyncio.run(mobile_push._handle_completion(
        "p1", _entry("u1", with_image=True)))
    asyncio.run(mobile_push._handle_completion(
        "p2", _entry("u2", with_image=True)))

    assert gate[0]["owner"] == "u1"
    assert gate[0]["image_url"] == "/mobile/api/thumbnail?prompt_id=p1"
    assert gate[1] == {"owner": "u2", "image_url": None}


def test_unowned_prompts_follow_the_legacy_store(gate):
    # The admin's store IS the legacy file, so this writes the global gate.
    mobile_push_prefs.set_prefs({"notifyOnComplete": False}, viewer=ADMIN)

    asyncio.run(mobile_push._handle_completion("p1", _entry(None)))
    assert gate == []


def test_single_user_servers_keep_the_global_gate(gate, monkeypatch):
    import mobile_auth

    monkeypatch.setattr(mobile_auth, "is_enabled", lambda: False)
    mobile_push_prefs.set_prefs({"notifyOnComplete": False})

    asyncio.run(mobile_push._handle_completion("p1", _entry(None)))
    assert gate == []


def test_an_undeterminable_owner_notifies_nobody(gate, monkeypatch):
    import mobile_auth

    """A gating auth node that cannot say whose job this is must not fan out.

    Downstream, owner=None addresses every paired device on the server, so the
    "cannot say" case would deliver one account's completion -- deep link, and
    the thumbnail when enabled -- to everybody else's phone.
    """
    monkeypatch.setattr(
        mobile_push._mobile_auth, "prompt_owner_or_unknown",
        lambda p: mobile_auth.OWNER_UNKNOWN)

    asyncio.run(mobile_push._handle_completion("p1", _entry("u1")))
    assert gate == []


def test_an_undeterminable_owner_still_notifies_with_accounts_off(gate, monkeypatch):
    import mobile_auth

    """With no gate there is nobody to disclose to, so the push still goes."""
    monkeypatch.setattr(
        mobile_push._mobile_auth, "prompt_owner_or_unknown",
        lambda p: mobile_auth.OWNER_UNKNOWN)
    monkeypatch.setattr(mobile_push._mobile_auth, "is_enabled", lambda: False)

    asyncio.run(mobile_push._handle_completion("p1", _entry(None)))
    assert gate != []
