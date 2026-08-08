import json
import os

import pytest

import mobile_push_prefs as prefs


@pytest.fixture
def prefs_file(tmp_path, monkeypatch):
    path = tmp_path / "push" / "preferences.json"
    monkeypatch.setattr(prefs, "_prefs_path", lambda: str(path))
    monkeypatch.setattr(prefs, "_push_dir", lambda: str(path.parent))
    monkeypatch.setattr(prefs, "_prefs", None)
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
