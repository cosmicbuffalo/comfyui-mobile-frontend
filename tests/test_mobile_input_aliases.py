import json
import os
from pathlib import Path

import pytest

from mobile_input_aliases import (
    ALIAS_PREFIX,
    ensure_aliases,
    known_aliases,
    migrate_legacy_cache,
    resolve_aliases,
    resolve_all_aliases,
)


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


def test_resolve_all_aliases_maps_every_live_alias(tmp_path: Path):
    input_dir = tmp_path / "input"
    source = input_dir / "sub" / "photo.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"pixels")
    cache = tmp_path / "aliases.json"
    alias = ensure_aliases(str(cache), str(input_dir), ["sub/photo.png"])[
        "sub/photo.png"
    ]

    assert known_aliases(str(cache)) == {alias}
    assert resolve_all_aliases(str(cache), str(input_dir)) == {
        alias: "sub/photo.png"
    }


def test_alias_inventory_retains_an_unresolvable_cached_alias(tmp_path: Path):
    input_dir = tmp_path / "input"
    source = input_dir / "sub" / "photo.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"pixels")
    cache = tmp_path / "aliases.json"
    alias = ensure_aliases(str(cache), str(input_dir), ["sub/photo.png"])[
        "sub/photo.png"
    ]
    source.unlink()

    assert known_aliases(str(cache)) == {alias}
    assert resolve_all_aliases(str(cache), str(input_dir)) == {}


def test_object_info_combo_lists_show_real_paths_and_drop_stale_aliases():

    import mobile_object_info as mobile_init
    live = f"{ALIAS_PREFIX}live0123456789.png"
    stale = f"{ALIAS_PREFIX}stale012345678.png"
    unknown = f"{ALIAS_PREFIX}unknown12345678.png"
    payload = {
        "LoadImage": {
            "input": {
                "required": {
                    "image": [[live, stale, unknown, "plain.png"], {"image_upload": True}]
                }
            }
        }
    }

    remapped = mobile_init._remap_alias_strings(
        payload,
        {live: "sub/photo.png"},
        {stale},
    )

    assert remapped["LoadImage"]["input"]["required"]["image"][0] == [
        "sub/photo.png",
        unknown,
        "plain.png",
    ]
    assert mobile_init._remap_alias_strings(payload, {}, set()) is payload


def test_build_remapped_object_info_uses_the_alias_cache(tmp_path: Path, monkeypatch):

    import mobile_object_info as mobile_init
    input_dir = tmp_path / "input"
    source = input_dir / "sub" / "photo.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"pixels")
    cache = tmp_path / "aliases.json"
    alias = ensure_aliases(str(cache), str(input_dir), ["sub/photo.png"])[
        "sub/photo.png"
    ]
    monkeypatch.setattr(mobile_init, "INPUT_ALIASES_CACHE_PATH", str(cache))
    monkeypatch.setattr(
        mobile_init.folder_paths,
        "get_input_directory",
        lambda: str(input_dir),
    )
    body = json.dumps({"LoadImage": {"choices": [alias, "plain.png"]}}).encode()

    remapped = mobile_init._build_remapped_object_info(body)

    assert json.loads(remapped)["LoadImage"]["choices"] == [
        "sub/photo.png",
        "plain.png",
    ]


def test_build_remapped_object_info_keeps_orphaned_hard_link_aliases(
    tmp_path: Path, monkeypatch
):
    """An alias outlives its original path (it is a hard link). It must stay in
    /object_info as long as the alias file exists; only a missing alias file
    is dropped."""

    import mobile_object_info as mobile_init
    input_dir = tmp_path / "input"
    (input_dir / "sub").mkdir(parents=True)
    (input_dir / "sub" / "kept.png").write_bytes(b"pixels")
    (input_dir / "sub" / "moved.png").write_bytes(b"pixels2")
    (input_dir / "sub" / "gone.png").write_bytes(b"pixels3")
    cache = tmp_path / "aliases.json"
    aliases = ensure_aliases(
        str(cache), str(input_dir), ["sub/kept.png", "sub/moved.png", "sub/gone.png"]
    )
    kept, moved, gone = (
        aliases["sub/kept.png"],
        aliases["sub/moved.png"],
        aliases["sub/gone.png"],
    )
    # Original disappears; the hard link is still a usable input.
    (input_dir / "sub" / "moved.png").unlink()
    # Both the original and the alias file itself are gone.
    (input_dir / "sub" / "gone.png").unlink()
    (input_dir / gone).unlink()
    monkeypatch.setattr(mobile_init, "INPUT_ALIASES_CACHE_PATH", str(cache))
    monkeypatch.setattr(
        mobile_init.folder_paths, "get_input_directory", lambda: str(input_dir)
    )
    body = json.dumps({"LoadImage": {"choices": [kept, moved, gone, "plain.png"]}}).encode()

    remapped = mobile_init._build_remapped_object_info(body)

    assert json.loads(remapped)["LoadImage"]["choices"] == [
        "sub/kept.png",
        moved,
        "plain.png",
    ]


def test_build_remapped_object_info_deduplicates_alias_source_collision(
    tmp_path: Path, monkeypatch
):

    import mobile_object_info as mobile_init
    input_dir = tmp_path / "input"
    source = input_dir / "photo.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"pixels")
    cache = tmp_path / "aliases.json"
    alias = ensure_aliases(str(cache), str(input_dir), ["photo.png"])["photo.png"]
    monkeypatch.setattr(mobile_init, "INPUT_ALIASES_CACHE_PATH", str(cache))
    monkeypatch.setattr(
        mobile_init.folder_paths,
        "get_input_directory",
        lambda: str(input_dir),
    )

    for choices in (["photo.png", alias], [alias, "photo.png"]):
        body = json.dumps({"LoadImage": {"choices": choices}}).encode()
        remapped = mobile_init._build_remapped_object_info(body)
        assert json.loads(remapped)["LoadImage"]["choices"] == ["photo.png"]


def test_object_info_remap_cache_expires_and_is_lru_bounded(monkeypatch):

    import mobile_object_info as mobile_init
    mobile_init._object_info_remap_cache.clear()
    for index in range(mobile_init._OBJECT_INFO_REMAP_MAX + 1):
        mobile_init._object_info_remap_put((index,), bytes([index]))

    assert len(mobile_init._object_info_remap_cache) == mobile_init._OBJECT_INFO_REMAP_MAX
    assert mobile_init._object_info_remap_get((0,)) == (False, None)
    latest = mobile_init._OBJECT_INFO_REMAP_MAX
    assert mobile_init._object_info_remap_get((latest,)) == (True, bytes([latest]))

    monkeypatch.setattr(
        mobile_init.time,
        "monotonic",
        lambda: float("inf"),
    )
    assert mobile_init._object_info_remap_get((latest,)) == (False, None)


def test_build_remapped_object_info_drops_aliases_the_auth_gate_refuses(
    tmp_path: Path, monkeypatch
):
    """A name the gate removed must not come back under its real path.

    comfyui-multiuser filters /object_info by the alias names it can see on
    disk. Remapping one of those into a different string afterwards would put a
    file the user may not load back on the menu — for an `isolated` account,
    that is somebody else's filename on screen.
    """
    import mobile_object_info as mobile_init

    input_dir = tmp_path / "input"
    (input_dir / "sub").mkdir(parents=True)
    (input_dir / "sub" / "mine.png").write_bytes(b"mine")
    (input_dir / "sub" / "theirs.png").write_bytes(b"theirs")
    cache = tmp_path / "aliases.json"
    aliases = ensure_aliases(
        str(cache), str(input_dir), ["sub/mine.png", "sub/theirs.png"]
    )
    monkeypatch.setattr(mobile_init, "INPUT_ALIASES_CACHE_PATH", str(cache))
    monkeypatch.setattr(
        mobile_init.folder_paths, "get_input_directory", lambda: str(input_dir)
    )

    refused = aliases["sub/theirs.png"]

    class FakeGate:
        @staticmethod
        def is_enabled():
            return True

        @staticmethod
        def can_use_input(name, user=None):
            return name != refused

    monkeypatch.setattr(mobile_init, "_multiuser_api", lambda: FakeGate)

    body = json.dumps(
        {"LoadImage": {"choices": [aliases["sub/mine.png"], refused, "plain.png"]}}
    ).encode()

    remapped = json.loads(
        mobile_init._build_remapped_object_info(body, {"id": "u1"})
    )

    assert remapped["LoadImage"]["choices"] == ["sub/mine.png", "plain.png"]


def test_the_alias_remap_is_unchanged_without_the_auth_node(tmp_path: Path, monkeypatch):
    """No gate installed: every alias still resolves, exactly as before."""
    import mobile_object_info as mobile_init

    input_dir = tmp_path / "input"
    (input_dir / "sub").mkdir(parents=True)
    (input_dir / "sub" / "photo.png").write_bytes(b"pixels")
    cache = tmp_path / "aliases.json"
    alias = ensure_aliases(str(cache), str(input_dir), ["sub/photo.png"])["sub/photo.png"]
    monkeypatch.setattr(mobile_init, "INPUT_ALIASES_CACHE_PATH", str(cache))
    monkeypatch.setattr(
        mobile_init.folder_paths, "get_input_directory", lambda: str(input_dir)
    )
    monkeypatch.setattr(mobile_init, "_multiuser_api", lambda: None)

    body = json.dumps({"LoadImage": {"choices": [alias]}}).encode()
    remapped = json.loads(mobile_init._build_remapped_object_info(body, {"id": "u1"}))
    assert remapped["LoadImage"]["choices"] == ["sub/photo.png"]


def test_a_second_live_name_for_one_file_gets_its_own_alias(tmp_path: Path):
    """Two live names for one inode must not share an alias.

    `photo.jpeg` and a hard-linked `photo.png` are the same bytes but two
    different widget values. Sharing one alias made the recorded source path
    flip to whichever name was queued last, so an already-embedded workflow
    reloaded as the *other* name -- a file that may not exist any more, which
    the combo then flags as missing while the run still works off the link.
    """
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    jpeg = input_dir / "photo.jpeg"
    jpeg.write_bytes(b"image-data")
    png = input_dir / "photo.png"
    os.link(jpeg, png)
    cache = tmp_path / "aliases.json"

    jpeg_alias = ensure_aliases(str(cache), str(input_dir), ["photo.jpeg"])["photo.jpeg"]
    png_alias = ensure_aliases(str(cache), str(input_dir), ["photo.png"])["photo.png"]

    assert jpeg_alias != png_alias
    # Each embedded workflow reloads as the name it was queued with.
    assert resolve_aliases(str(cache), str(input_dir), [jpeg_alias, png_alias]) == {
        jpeg_alias: "photo.jpeg",
        png_alias: "photo.png",
    }
    # Re-queueing either one is still stable rather than minting a third alias.
    assert ensure_aliases(str(cache), str(input_dir), ["photo.jpeg"])["photo.jpeg"] == jpeg_alias


def test_one_batch_naming_both_hard_linked_names_keeps_them_apart(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    jpeg = input_dir / "photo.jpeg"
    jpeg.write_bytes(b"image-data")
    os.link(jpeg, input_dir / "photo.png")
    cache = tmp_path / "aliases.json"

    aliases = ensure_aliases(str(cache), str(input_dir), ["photo.jpeg", "photo.png"])

    assert aliases["photo.jpeg"] != aliases["photo.png"]
