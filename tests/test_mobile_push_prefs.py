import json
import os

import pytest

import mobile_push_prefs as prefs


@pytest.fixture
def prefs_file(tmp_path, monkeypatch):
    path = tmp_path / "push" / "preferences.json"
    monkeypatch.setattr(prefs, "_prefs_path", lambda: str(path))
    monkeypatch.setattr(prefs, "_push_dir", lambda: str(path.parent))
    monkeypatch.setattr(prefs, "_stores", {})
    return path


def test_persists_known_boolean_keys(prefs_file):
    key = next(iter(prefs._DEFAULTS))

    result = prefs.set_prefs({key: False})

    assert result[key] is False
    assert json.loads(prefs_file.read_text())[key] is False


def test_a_failed_write_does_not_leave_the_cache_ahead_of_disk(prefs_file, monkeypatch):
    # Otherwise the client sees a 500 while every later read — including the
    # completion-notification gate — reports a value that was never saved, and
    # it silently reverts on the next restart.
    key = next(iter(prefs._DEFAULTS))
    prefs.set_prefs({key: True})
    assert prefs.get_prefs()[key] is True

    def fail_replace(src, dst):
        raise OSError("no space left on device")

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(OSError):
        prefs.set_prefs({key: False})

    assert prefs.get_prefs()[key] is True
    assert json.loads(prefs_file.read_text())[key] is True


def test_write_is_atomic(prefs_file, monkeypatch):
    key = next(iter(prefs._DEFAULTS))
    prefs.set_prefs({key: True})
    good = prefs_file.read_text()

    monkeypatch.setattr(os, "replace", lambda src, dst: (_ for _ in ()).throw(OSError("boom")))
    with pytest.raises(OSError):
        prefs.set_prefs({key: False})

    assert prefs_file.read_text() == good
    assert [p.name for p in prefs_file.parent.iterdir()] == [prefs_file.name]


# --- multiuser scoping ------------------------------------------------------
#
# One global file let any signed-in account silence everyone's pushes, so
# non-admin accounts now write sibling per-user stores. The legacy file stays
# as the no-accounts/admin store and as the baseline an unpersonalized
# account reads through.

U1 = {"id": "u1", "roles": ["public"]}
U2 = {"id": "u2", "roles": ["public"]}
ADMIN = {"id": "boss", "roles": ["admin"]}


@pytest.fixture
def accounts(prefs_file, monkeypatch):
    import mobile_auth

    monkeypatch.setattr(mobile_auth, "is_enabled", lambda: True)
    return prefs_file


def test_one_accounts_write_does_not_change_anothers_read(accounts):
    prefs.set_prefs({"notifyOnComplete": False}, viewer=U1)

    assert prefs.get_prefs(viewer=U1)["notifyOnComplete"] is False
    assert prefs.get_prefs(viewer=U2)["notifyOnComplete"] is True
    # The write landed in u1's own sibling store, not the shared file.
    assert not accounts.exists()
    sibling = accounts.parent / "preferences.u_u1.json"
    assert json.loads(sibling.read_text())["notifyOnComplete"] is False


def test_admins_stay_on_the_legacy_store(accounts):
    prefs.set_prefs({"notifyOnComplete": False}, viewer=ADMIN)

    assert json.loads(accounts.read_text())["notifyOnComplete"] is False
    # An account that never personalized follows the server's standing
    # settings...
    assert prefs.get_prefs(viewer=U1)["notifyOnComplete"] is False
    # ...until it writes its own, which diverges only that account.
    prefs.set_prefs({"notifyOnComplete": True}, viewer=U1)
    assert prefs.get_prefs(viewer=U1)["notifyOnComplete"] is True
    assert prefs.get_prefs(viewer=ADMIN)["notifyOnComplete"] is False


def test_single_user_servers_keep_the_legacy_file(prefs_file, monkeypatch):
    import mobile_auth

    monkeypatch.setattr(mobile_auth, "is_enabled", lambda: False)
    result = prefs.set_prefs({"includeThumbnail": True})

    assert result["includeThumbnail"] is True
    assert json.loads(prefs_file.read_text())["includeThumbnail"] is True
    assert prefs.get_prefs()["includeThumbnail"] is True


def test_prefs_for_owner_reads_that_owners_store(accounts):
    prefs.set_prefs({"notifyOnComplete": False}, viewer=U1)

    assert prefs.prefs_for_owner("u1")["notifyOnComplete"] is False
    assert prefs.prefs_for_owner("u2")["notifyOnComplete"] is True
    # Unowned prompts (and gate-off servers) read the legacy store.
    assert prefs.prefs_for_owner(None)["notifyOnComplete"] is True


def test_an_unresolvable_viewer_cannot_write_the_legacy_store(accounts, monkeypatch):
    """Auth on but no resolvable user is a broken gate, not a single-user
    server: like mobile_common's quarantine store, the write must dead-end
    where nothing else reads it -- never in the server-wide file."""
    import mobile_auth

    monkeypatch.setattr(mobile_auth, "current_user", lambda: None)
    prefs.set_prefs({"notifyOnComplete": False}, viewer=None)

    assert not accounts.exists()
    assert prefs.get_prefs(viewer=U1)["notifyOnComplete"] is True
    quarantine = accounts.parent / "preferences.__unresolved__.json"
    assert json.loads(quarantine.read_text())["notifyOnComplete"] is False
