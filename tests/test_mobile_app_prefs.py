import json
import os

import pytest

import mobile_app_prefs as prefs


@pytest.fixture
def prefs_file(tmp_path, monkeypatch):
    path = tmp_path / "mobile" / "preferences.json"
    monkeypatch.setattr(prefs, "_prefs_path", lambda: str(path))
    monkeypatch.setattr(prefs, "_mobile_dir", lambda: str(path.parent))
    monkeypatch.setattr(prefs, "_prefs", None)
    return path


def test_persists_known_boolean_keys(prefs_file):
    key = next(iter(prefs._DEFAULTS))

    result = prefs.set_prefs({key: True})

    assert result[key] is True
    assert json.loads(prefs_file.read_text())[key] is True


def test_creates_the_directory_it_writes_into(prefs_file):
    # The write helper owns makedirs; losing that would fail on a fresh install
    # whose user-data dir doesn't exist yet.
    assert not prefs_file.parent.exists()

    prefs.set_prefs({next(iter(prefs._DEFAULTS)): True})

    assert prefs_file.is_file()


def test_write_is_atomic(prefs_file, monkeypatch):
    # A crash or full disk mid-write must not leave truncated JSON behind: every
    # later load would reject it, bricking server-side prefs. The temp-file +
    # rename means the previous good file survives a failed write.
    key = next(iter(prefs._DEFAULTS))
    prefs.set_prefs({key: True})
    good = prefs_file.read_text()

    real_replace = os.replace

    def fail_replace(src, dst):
        raise OSError("no space left on device")

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(OSError):
        prefs.set_prefs({key: False})
    monkeypatch.setattr(os, "replace", real_replace)

    assert prefs_file.read_text() == good
    # And no partial temp file is left lying around next to it.
    assert [p.name for p in prefs_file.parent.iterdir()] == [prefs_file.name]


def test_ignores_unknown_and_non_boolean_updates(prefs_file):
    key = next(iter(prefs._DEFAULTS))

    result = prefs.set_prefs({key: "yes", "not_a_real_pref": True})

    assert result[key] == prefs._DEFAULTS[key]
    assert "not_a_real_pref" not in result
