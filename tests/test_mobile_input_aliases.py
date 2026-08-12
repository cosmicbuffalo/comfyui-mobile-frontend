import json
import os
from pathlib import Path

import pytest

from mobile_input_aliases import ALIAS_PREFIX, ensure_aliases, migrate_legacy_cache, resolve_aliases


def test_creates_stable_hard_link_without_copying_data(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    source = input_dir / "private" / "photo.png"
    source.parent.mkdir()
    source.write_bytes(b"image-data")
    cache = tmp_path / "aliases.json"

    first = ensure_aliases(str(cache), str(input_dir), ["private/photo.png"])["private/photo.png"]
    second = ensure_aliases(str(cache), str(input_dir), ["private/photo.png"])["private/photo.png"]
    alias = input_dir / first

    assert first == second
    assert first.startswith(ALIAS_PREFIX)
    assert "/" not in first
    assert os.path.samefile(source, alias)
    assert source.stat().st_ino == alias.stat().st_ino


def test_reuses_alias_after_original_moves(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    source = input_dir / "private" / "photo.png"
    source.parent.mkdir()
    source.write_bytes(b"image-data")
    cache = tmp_path / "aliases.json"
    first = ensure_aliases(str(cache), str(input_dir), ["private/photo.png"])["private/photo.png"]

    moved = input_dir / "moved" / "renamed.png"
    moved.parent.mkdir()
    source.rename(moved)
    second = ensure_aliases(str(cache), str(input_dir), ["moved/renamed.png"])["moved/renamed.png"]

    assert second == first
    assert os.path.samefile(moved, input_dir / first)


def test_old_workflow_path_keeps_using_alias_after_original_moves(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    source = input_dir / "private" / "photo.png"
    source.parent.mkdir()
    source.write_bytes(b"image-data")
    cache = tmp_path / "aliases.json"
    first = ensure_aliases(str(cache), str(input_dir), ["private/photo.png"])["private/photo.png"]

    moved = input_dir / "moved" / "renamed.png"
    moved.parent.mkdir()
    source.rename(moved)
    second = ensure_aliases(str(cache), str(input_dir), ["private/photo.png"])["private/photo.png"]

    assert second == first
    assert os.path.samefile(moved, input_dir / first)


def test_resolves_live_alias_to_source_path(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    source = input_dir / "private" / "photo.png"
    source.parent.mkdir()
    source.write_bytes(b"image-data")
    cache = tmp_path / "aliases.json"
    alias = ensure_aliases(str(cache), str(input_dir), ["private/photo.png"])["private/photo.png"]

    assert resolve_aliases(str(cache), str(input_dir), [alias, ".mi-unknown.png"]) == {
        alias: "private/photo.png"
    }


def test_does_not_resolve_stale_source_path_while_alias_still_works(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    source = input_dir / "private" / "photo.png"
    source.parent.mkdir()
    source.write_bytes(b"image-data")
    cache = tmp_path / "aliases.json"
    alias = ensure_aliases(str(cache), str(input_dir), ["private/photo.png"])["private/photo.png"]

    moved = input_dir / "moved" / "renamed.png"
    moved.parent.mkdir()
    source.rename(moved)

    assert resolve_aliases(str(cache), str(input_dir), [alias]) == {}
    assert os.path.isfile(input_dir / alias)


def test_resolves_updated_source_path_after_alias_is_reused(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    source = input_dir / "private" / "photo.png"
    source.parent.mkdir()
    source.write_bytes(b"image-data")
    cache = tmp_path / "aliases.json"
    alias = ensure_aliases(str(cache), str(input_dir), ["private/photo.png"])["private/photo.png"]

    moved = input_dir / "moved" / "renamed.png"
    moved.parent.mkdir()
    source.rename(moved)
    reused = ensure_aliases(str(cache), str(input_dir), ["moved/renamed.png"])["moved/renamed.png"]

    assert reused == alias
    assert resolve_aliases(str(cache), str(input_dir), [alias]) == {
        alias: "moved/renamed.png"
    }


def test_rejects_missing_and_traversing_paths(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    cache = tmp_path / "aliases.json"

    with pytest.raises(ValueError):
        ensure_aliases(str(cache), str(input_dir), ["../secret.png"])
    with pytest.raises(FileNotFoundError):
        ensure_aliases(str(cache), str(input_dir), ["missing.png"])


def test_rejects_symlink_escaping_input_dir(tmp_path: Path):
    # A symlink *inside* the input dir that resolves to a file outside it must be
    # rejected. With a plain abspath check the joined path looks contained; only
    # realpath-based containment catches the escape.
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.png").write_bytes(b"secret")
    (input_dir / "escape").symlink_to(outside, target_is_directory=True)
    cache = tmp_path / "aliases.json"

    with pytest.raises(ValueError):
        ensure_aliases(str(cache), str(input_dir), ["escape/secret.png"])


def test_migrate_legacy_cache_seeds_durable_path_once(tmp_path: Path):
    legacy = tmp_path / ".cache" / "input_aliases_cache.json"
    legacy.parent.mkdir()
    payload = {"version": 1, "updatedAt": 1, "aliases": {f"{ALIAS_PREFIX}abc.png": {"sourcePath": "private/photo.png"}}}
    legacy.write_text(json.dumps(payload))
    dest = tmp_path / "userdata" / "default" / "mobile" / "input_aliases.json"

    assert migrate_legacy_cache(str(dest), [str(tmp_path / "missing.json"), str(legacy)]) is True
    assert json.loads(dest.read_text())["aliases"] == payload["aliases"]
    assert migrate_legacy_cache(str(dest), [str(legacy)]) is False
