import json
import os

from json_cache_io import atomic_write_json, now_ms


def test_now_ms_is_positive_int():
    value = now_ms()
    assert isinstance(value, int)
    assert value > 0


def test_atomic_write_round_trips(tmp_path):
    path = str(tmp_path / "cache.json")
    atomic_write_json(path, {"version": 1, "hidden": {"output": ["a"]}}, prefix=".x.")
    with open(path, encoding="utf-8") as handle:
        assert json.load(handle) == {"version": 1, "hidden": {"output": ["a"]}}


def test_atomic_write_creates_missing_directory(tmp_path):
    path = str(tmp_path / "nested" / "deep" / "cache.json")
    atomic_write_json(path, {"a": 1}, prefix=".x.")
    assert os.path.isfile(path)


def test_atomic_write_overwrites_and_leaves_no_temp_files(tmp_path):
    path = str(tmp_path / "cache.json")
    atomic_write_json(path, {"n": 1}, prefix=".x.")
    atomic_write_json(path, {"n": 2}, prefix=".x.")
    with open(path, encoding="utf-8") as handle:
        assert json.load(handle) == {"n": 2}
    # Only the final cache file remains; the temp file was renamed into place.
    assert os.listdir(tmp_path) == ["cache.json"]


def test_atomic_write_is_compact(tmp_path):
    path = str(tmp_path / "cache.json")
    atomic_write_json(path, {"a": 1, "b": 2}, prefix=".x.")
    text = open(path, encoding="utf-8").read()
    assert text == '{"a":1,"b":2}'  # no spaces after separators
