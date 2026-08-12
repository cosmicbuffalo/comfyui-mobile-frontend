import hashlib
import json
import os
import threading
from pathlib import Path

import pytest

import mobile_file_state
from file_utils import list_files
from mobile_file_state import (
    STATES,
    annotate_listing,
    content_id,
    get_all,
    get_hidden_paths,
    get_paths,
    migrate_legacy,
    plan_remove_path,
    remove_path,
    rename_path,
    set_state,
)

_CHUNK = 1024 * 1024  # matches the module's internal 1 MiB chunk size


def file_entry(path: str, entry_type: str = "file") -> dict:
    return {"name": path.split("/")[-1], "path": path, "type": entry_type}


def read_cache(cache_path: Path) -> dict:
    with open(cache_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def raw_entry(cache_path: Path, source: str, state: str, path: str) -> dict | None:
    data = read_cache(cache_path)
    for entry in data.get("states", {}).get(source, {}).get(state, []):
        if entry.get("path") == path:
            return entry
    return None


# ---------------------------------------------------------------------------
# content_id
# ---------------------------------------------------------------------------

def test_content_id_small_file_is_full_hash(tmp_path: Path):
    small = tmp_path / "small.bin"
    body = b"hello world" * 100
    small.write_bytes(body)

    import struct
    expected = "p1:" + hashlib.sha256(struct.pack("<Q", len(body)) + body).hexdigest()
    assert content_id(str(small)) == expected


def test_content_id_large_file_middle_byte_change_is_invisible(tmp_path: Path):
    large = tmp_path / "large.bin"
    head = b"H" * _CHUNK
    middle = b"M" * _CHUNK
    tail = b"T" * _CHUNK
    large.write_bytes(head + middle + tail)
    before = content_id(str(large))

    # Flip a byte squarely in the middle segment (offset 1.5 * chunk), which
    # the partial-hash scheme never reads.
    data = bytearray(large.read_bytes())
    mid_offset = _CHUNK + (_CHUNK // 2)
    data[mid_offset] = (data[mid_offset] + 1) % 256
    large.write_bytes(bytes(data))

    after = content_id(str(large))
    assert before == after


def test_content_id_large_file_head_byte_change_is_visible(tmp_path: Path):
    large = tmp_path / "large.bin"
    large.write_bytes(b"H" * _CHUNK + b"M" * _CHUNK + b"T" * _CHUNK)
    before = content_id(str(large))

    data = bytearray(large.read_bytes())
    data[0] = (data[0] + 1) % 256
    large.write_bytes(bytes(data))

    assert content_id(str(large)) != before


def test_content_id_large_file_tail_byte_change_is_visible(tmp_path: Path):
    large = tmp_path / "large.bin"
    large.write_bytes(b"H" * _CHUNK + b"M" * _CHUNK + b"T" * _CHUNK)
    before = content_id(str(large))

    data = bytearray(large.read_bytes())
    data[-1] = (data[-1] + 1) % 256
    large.write_bytes(bytes(data))

    assert content_id(str(large)) != before


def test_content_id_different_size_never_collides_even_with_identical_sampled_bytes(tmp_path: Path):
    # Both files share the exact same head chunk and tail chunk (the only
    # bytes the partial hash samples for a >2MiB file); only the untouched
    # middle differs in length. Without size folded into the digest these
    # would collide.
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    a.write_bytes(b"H" * _CHUNK + b"M" * _CHUNK + b"T" * _CHUNK)
    b.write_bytes(b"H" * _CHUNK + b"M" * (2 * _CHUNK) + b"T" * _CHUNK)

    assert a.stat().st_size != b.stat().st_size
    assert content_id(str(a)) != content_id(str(b))


def test_content_id_rejects_a_file_that_changes_while_being_read(tmp_path: Path, monkeypatch):
    target = tmp_path / "changing.bin"
    target.write_bytes(b"first-version")
    original_fstat = mobile_file_state.os.fstat
    calls = 0

    def changing_fstat(fd: int):
        nonlocal calls
        stat = original_fstat(fd)
        calls += 1
        if calls == 2:
            target.write_bytes(b"a-different-second-version")
            stat = original_fstat(fd)
        return stat

    monkeypatch.setattr(mobile_file_state.os, "fstat", changing_fstat)
    try:
        content_id(str(target))
        assert False, "a changing file must not produce a content id"
    except mobile_file_state.FileChangedDuringHash:
        pass


# ---------------------------------------------------------------------------
# basic set/get/toggle
# ---------------------------------------------------------------------------

def test_set_get_toggle_favorite_file(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "a.png").write_bytes(b"content-a")

    assert set_state(str(cache), "output", "favorite", str(output), "a.png", True) is True
    assert get_paths(str(cache), "output", "favorite", str(output)) == ["a.png"]

    set_state(str(cache), "output", "favorite", str(output), "a.png", False)
    assert get_paths(str(cache), "output", "favorite", str(output)) == []


def test_set_get_toggle_reject_file(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "a.png").write_bytes(b"content-a")

    set_state(str(cache), "output", "reject", str(output), "a.png", True)
    assert get_paths(str(cache), "output", "reject", str(output)) == ["a.png"]

    set_state(str(cache), "output", "reject", str(output), "a.png", False)
    assert get_paths(str(cache), "output", "reject", str(output)) == []


def test_set_get_toggle_hidden_file(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "a.png").write_bytes(b"content-a")

    set_state(str(cache), "output", "hidden", str(output), "a.png", True)
    assert get_paths(str(cache), "output", "hidden", str(output)) == ["a.png"]

    set_state(str(cache), "output", "hidden", str(output), "a.png", False)
    assert get_paths(str(cache), "output", "hidden", str(output)) == []


def test_set_get_toggle_favorite_dir(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "folder").mkdir()

    set_state(str(cache), "output", "favorite", str(output), "folder", True)
    assert get_paths(str(cache), "output", "favorite", str(output)) == ["folder"]

    set_state(str(cache), "output", "favorite", str(output), "folder", False)
    assert get_paths(str(cache), "output", "favorite", str(output)) == []


def test_set_get_toggle_hidden_dir(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "folder").mkdir()

    set_state(str(cache), "output", "hidden", str(output), "folder", True)
    assert get_paths(str(cache), "output", "hidden", str(output)) == ["folder"]

    set_state(str(cache), "output", "hidden", str(output), "folder", False)
    assert get_paths(str(cache), "output", "hidden", str(output)) == []


def test_reject_on_directory_is_a_noop(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "folder").mkdir()

    assert set_state(str(cache), "output", "reject", str(output), "folder", True) is False

    assert get_paths(str(cache), "output", "reject", str(output)) == []
    # No entry should have been created at all -- the cache file may not even
    # exist, or if it does, it must carry no reject state for this source.
    if cache.exists():
        data = read_cache(cache)
        assert "reject" not in data.get("states", {}).get("output", {})


def test_set_state_reports_when_the_target_is_not_ready(tmp_path: Path):
    output = tmp_path / "output"
    output.mkdir()

    assert set_state(
        str(tmp_path / "file_state.json"),
        "output",
        "hidden",
        str(output),
        "not-written-yet.png",
        True,
    ) is False


def test_set_state_does_not_commit_a_hash_for_a_replaced_file(tmp_path: Path, monkeypatch):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    target = output / "race.png"
    target.write_bytes(b"first-version")
    original_helper = mobile_file_state._content_id_with_stat

    def replace_after_hash(path: str):
        identity, stat = original_helper(path)
        target.write_bytes(b"replacement-with-a-different-size")
        return identity, stat

    monkeypatch.setattr(mobile_file_state, "_content_id_with_stat", replace_after_hash)

    assert set_state(
        str(cache), "output", "favorite", str(output), "race.png", True
    ) is False
    assert not cache.exists()


# ---------------------------------------------------------------------------
# mutual exclusivity
# ---------------------------------------------------------------------------

def test_favorite_and_reject_are_mutually_exclusive(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "a.png").write_bytes(b"content-a")

    set_state(str(cache), "output", "reject", str(output), "a.png", True)
    assert get_paths(str(cache), "output", "reject", str(output)) == ["a.png"]

    set_state(str(cache), "output", "favorite", str(output), "a.png", True)
    assert get_paths(str(cache), "output", "favorite", str(output)) == ["a.png"]
    assert get_paths(str(cache), "output", "reject", str(output)) == []

    set_state(str(cache), "output", "reject", str(output), "a.png", True)
    assert get_paths(str(cache), "output", "reject", str(output)) == ["a.png"]
    assert get_paths(str(cache), "output", "favorite", str(output)) == []


def test_hidden_does_not_affect_favorite_or_reject(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "a.png").write_bytes(b"content-a")

    set_state(str(cache), "output", "favorite", str(output), "a.png", True)
    set_state(str(cache), "output", "hidden", str(output), "a.png", True)

    assert get_paths(str(cache), "output", "favorite", str(output)) == ["a.png"]
    assert get_paths(str(cache), "output", "hidden", str(output)) == ["a.png"]

    set_state(str(cache), "output", "reject", str(output), "a.png", True)
    # Reject clears favorite but must leave hidden untouched.
    assert get_paths(str(cache), "output", "favorite", str(output)) == []
    assert get_paths(str(cache), "output", "hidden", str(output)) == ["a.png"]


# ---------------------------------------------------------------------------
# annotate_listing: move rediscovery by content hash
# ---------------------------------------------------------------------------

def _rediscovery_scenario(tmp_path: Path, state: str):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "image.png"
    content = f"same-bytes-{state}".encode()
    original.write_bytes(content)

    set_state(str(cache), "output", state, str(output), "image.png", True)

    moved_dir = output / "external"
    moved_dir.mkdir()
    moved = moved_dir / "image.png"
    original.rename(moved)

    listing = [file_entry("external/image.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    flag = {"favorite": "favorite", "reject": "rejected", "hidden": "hiddenSelf"}[state]
    assert listing[0].get(flag) is True
    assert get_paths(str(cache), "output", state, str(output)) == ["external/image.png"]
    return cache, output


def test_annotate_listing_rediscovers_moved_favorite(tmp_path: Path):
    _rediscovery_scenario(tmp_path, "favorite")


def test_annotate_listing_rediscovers_moved_reject(tmp_path: Path):
    _rediscovery_scenario(tmp_path, "reject")


def test_annotate_listing_rediscovers_moved_hidden(tmp_path: Path):
    _rediscovery_scenario(tmp_path, "hidden")


def test_annotate_listing_second_call_is_a_stable_no_op(tmp_path: Path):
    cache, output = _rediscovery_scenario(tmp_path, "favorite")

    before = cache.read_text(encoding="utf-8")
    listing = [file_entry("external/image.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())
    after = cache.read_text(encoding="utf-8")

    assert listing[0].get("favorite") is True
    assert before == after  # fast path hit: no write needed, no re-hash


# ---------------------------------------------------------------------------
# name reuse must not inherit stale state
# ---------------------------------------------------------------------------

def _name_reuse_scenario(tmp_path: Path, state: str):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "image.png"
    original.write_bytes(b"first-generation")

    set_state(str(cache), "output", state, str(output), "image.png", True)

    # A brand-new file with different bytes reuses the same path.
    original.write_bytes(b"second-generation-totally-different")

    listing = [file_entry("image.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    flag = {"favorite": "favorite", "reject": "rejected", "hidden": "hiddenSelf"}[state]
    assert flag not in listing[0]
    assert get_paths(str(cache), "output", state, str(output)) == []

    # But the stale entry must still be sitting in the raw cache file, kept
    # around in case the original bytes resurface at a new path.
    entry = raw_entry(cache, "output", state, "image.png")
    assert entry is not None
    return cache


def test_name_reuse_does_not_inherit_favorite(tmp_path: Path):
    _name_reuse_scenario(tmp_path, "favorite")


def test_name_reuse_does_not_inherit_reject(tmp_path: Path):
    _name_reuse_scenario(tmp_path, "reject")


def test_name_reuse_does_not_inherit_hidden(tmp_path: Path):
    _name_reuse_scenario(tmp_path, "hidden")


def test_hidden_name_reuse_survives_real_listing_pipeline(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    image = output / "image.png"
    image.write_bytes(b"old-hidden-content")
    set_state(str(cache), "output", "hidden", str(output), "image.png", True)

    # A different generation reuses the path. Its size differs too, ensuring
    # verification cannot take the size+mtime signature fast path.
    image.write_bytes(b"brand-new-visible-content-at-the-reused-name")

    hidden_dirs = get_hidden_paths(str(cache), "output")
    verified_hidden = set(get_paths(str(cache), "output", "hidden", str(output)))
    hidden_dirs.intersection_update(verified_hidden)
    listing = list_files(
        str(output),
        str(output),
        show_hidden=False,
        hidden_paths=verified_hidden,
    )
    annotate_listing(str(cache), "output", str(output), listing, hidden_dirs)
    listing = [item for item in listing if not item.get("hidden")]

    assert [item["path"] for item in listing] == ["image.png"]
    assert not listing[0].get("hidden")
    assert not listing[0].get("hiddenSelf")


def test_verified_hidden_files_are_excluded_from_folder_stats(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    folder = output / "folder"
    folder.mkdir(parents=True)
    (folder / "hidden.png").write_bytes(b"hidden-bytes")
    (folder / "visible.png").write_bytes(b"visible-bytes")
    set_state(str(cache), "output", "hidden", str(output), "folder/hidden.png", True)

    verified_hidden = set(get_paths(str(cache), "output", "hidden", str(output)))
    listing = list_files(
        str(output),
        str(output),
        show_hidden=False,
        hidden_paths=verified_hidden,
    )

    assert len(listing) == 1
    assert listing[0]["path"] == "folder"
    assert listing[0]["count"] == 1
    assert listing[0]["size"] == len(b"visible-bytes")


def test_marking_replacement_content_preserves_original_state(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    original_path = output / "same.png"
    original_path.write_bytes(b"original-A")
    set_state(str(cache), "output", "favorite", str(output), "same.png", True)

    moved_path = output / "moved-A.png"
    original_path.rename(moved_path)
    original_path.write_bytes(b"replacement-B-with-a-different-size")
    set_state(str(cache), "output", "favorite", str(output), "same.png", True)

    listing = [file_entry("moved-A.png"), file_entry("same.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    assert [item.get("favorite") for item in listing] == [True, True]
    entries = read_cache(cache)["states"]["output"]["favorite"]
    assert len(entries) == 2
    assert {entry["path"] for entry in entries} == {"moved-A.png", "same.png"}


def test_favoriting_replacement_does_not_clear_rejected_original(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    original_path = output / "same.png"
    original_path.write_bytes(b"rejected-original-A")
    set_state(str(cache), "output", "reject", str(output), "same.png", True)

    moved_path = output / "moved-A.png"
    original_path.rename(moved_path)
    original_path.write_bytes(b"favorite-replacement-B-with-different-size")
    set_state(str(cache), "output", "favorite", str(output), "same.png", True)

    listing = [file_entry("moved-A.png"), file_entry("same.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    assert listing[0].get("rejected") is True
    assert not listing[0].get("favorite")
    assert listing[1].get("favorite") is True
    assert not listing[1].get("rejected")


# ---------------------------------------------------------------------------
# rename_path / remove_path across all three states at once
# ---------------------------------------------------------------------------

def _three_state_layout(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    folder = output / "folder"
    folder.mkdir()
    (folder / "img.png").write_bytes(b"hidden-one")
    (folder / "other.png").write_bytes(b"rejected-one")

    set_state(str(cache), "output", "favorite", str(output), "folder", True)
    set_state(str(cache), "output", "hidden", str(output), "folder/img.png", True)
    set_state(str(cache), "output", "reject", str(output), "folder/other.png", True)
    return cache, output, folder


def test_rename_path_remaps_all_three_states_at_once(tmp_path: Path):
    cache, output, folder = _three_state_layout(tmp_path)

    renamed = output / "renamed"
    folder.rename(renamed)
    rename_path(str(cache), "output", "folder", "renamed")

    assert get_paths(str(cache), "output", "favorite", str(output)) == ["renamed"]
    assert get_paths(str(cache), "output", "hidden", str(output)) == ["renamed/img.png"]
    assert get_paths(str(cache), "output", "reject", str(output)) == ["renamed/other.png"]


def test_state_changes_advance_listing_modified_date_even_when_cleared(
    tmp_path: Path,
    monkeypatch,
):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    image = output / "image.png"
    image.write_bytes(b"image")
    before = list_files(str(output), str(output))[0]
    activity_time = before["modifiedDate"] + 60_000
    monkeypatch.setattr(mobile_file_state, "_now_ms", lambda: activity_time)

    assert set_state(str(cache), "output", "favorite", str(output), "image.png", True)
    assert set_state(str(cache), "output", "favorite", str(output), "image.png", False)

    listing = list_files(str(output), str(output))
    annotate_listing(str(cache), "output", str(output), listing, set())
    assert listing[0].get("favorite") is not True
    assert listing[0]["createdDate"] == before["createdDate"]
    assert listing[0]["modifiedDate"] == activity_time


def test_in_app_rename_preserves_created_and_advances_modified_date(
    tmp_path: Path,
    monkeypatch,
):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "before.png"
    original.write_bytes(b"image")
    before = list_files(str(output), str(output))[0]
    activity_time = before["modifiedDate"] + 60_000
    monkeypatch.setattr(mobile_file_state, "_now_ms", lambda: activity_time)

    original.rename(output / "after.png")
    rename_path(str(cache), "output", "before.png", "after.png", str(output))

    listing = list_files(str(output), str(output))
    annotate_listing(str(cache), "output", str(output), listing, set())
    assert listing[0]["createdDate"] == before["createdDate"]
    assert listing[0]["modifiedDate"] == activity_time


def test_in_app_move_advances_both_old_and_new_folder_trees(
    tmp_path: Path,
    monkeypatch,
):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    old_tree = output / "old" / "deep"
    new_tree = output / "new"
    old_tree.mkdir(parents=True)
    new_tree.mkdir()
    image = old_tree / "image.png"
    image.write_bytes(b"image")
    before = list_files(str(output), str(output))
    activity_time = max(item["modifiedDate"] for item in before) + 60_000
    monkeypatch.setattr(mobile_file_state, "_now_ms", lambda: activity_time)

    image.rename(new_tree / "image.png")
    rename_path(
        str(cache),
        "output",
        "old/deep/image.png",
        "new/image.png",
        str(output),
    )

    listing = list_files(str(output), str(output))
    annotate_listing(str(cache), "output", str(output), listing, set())
    by_name = {item["name"]: item for item in listing}
    assert by_name["old"]["modifiedDate"] == activity_time
    assert by_name["new"]["modifiedDate"] == activity_time


def test_remove_path_drops_all_three_states_at_once(tmp_path: Path):
    cache, output, _folder = _three_state_layout(tmp_path)

    remove_path(str(cache), "output", "folder")

    result = get_all(str(cache), "output", str(output))
    assert result == {"favorite": [], "reject": [], "hidden": []}


def test_identity_aware_delete_preserves_state_for_moved_original(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    reused = output / "same.png"
    reused.write_bytes(b"original-A")
    set_state(str(cache), "output", "favorite", str(output), "same.png", True)

    moved = output / "moved-A.png"
    reused.rename(moved)
    reused.write_bytes(b"replacement-B-with-different-size")

    plan = plan_remove_path(str(cache), "output", str(output), "same.png")
    reused.unlink()
    remove_path(str(cache), "output", "same.png", plan)

    listing = [file_entry("moved-A.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())
    assert listing[0].get("favorite") is True
    assert get_paths(str(cache), "output", "favorite", str(output)) == ["moved-A.png"]


def test_identity_aware_delete_removes_state_for_deleted_content(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    image = output / "image.png"
    image.write_bytes(b"deleted-content")
    set_state(str(cache), "output", "hidden", str(output), "image.png", True)

    plan = plan_remove_path(str(cache), "output", str(output), "image.png")
    image.unlink()
    remove_path(str(cache), "output", "image.png", plan)

    assert raw_entry(cache, "output", "hidden", "image.png") is None


def test_identity_aware_delete_does_not_clobber_concurrent_cache_rename(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    image = output / "image.png"
    image.write_bytes(b"content")
    set_state(str(cache), "output", "favorite", str(output), "image.png", True)

    plan = plan_remove_path(str(cache), "output", str(output), "image.png")
    rename_path(str(cache), "output", "image.png", "concurrent-winner.png")
    image.unlink()
    remove_path(str(cache), "output", "image.png", plan)

    assert raw_entry(cache, "output", "favorite", "concurrent-winner.png") is not None


# ---------------------------------------------------------------------------
# hidden folder inheritance
# ---------------------------------------------------------------------------

def test_hidden_dir_inheritance_flags_nested_file(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    folder = output / "folder"
    folder.mkdir()
    (folder / "img.png").write_bytes(b"nested")

    # No direct hidden entry for folder/img.png -- only ancestor inheritance
    # via the caller-supplied hidden_set.
    listing = [file_entry("folder/img.png")]
    annotate_listing(str(cache), "output", str(output), listing, {"folder"})

    assert listing[0].get("hidden") is True
    assert not listing[0].get("hiddenSelf")


def test_hidden_dir_inheritance_via_dir_listing_item(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "folder").mkdir()

    listing = [file_entry("folder", "dir")]
    annotate_listing(str(cache), "output", str(output), listing, {"folder"})
    assert listing[0].get("hidden") is True


def test_get_hidden_paths_returns_only_directory_inheritance_paths(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "a.png").write_bytes(b"content")
    (output / "folder").mkdir()

    set_state(str(cache), "output", "hidden", str(output), "a.png", True)
    set_state(str(cache), "output", "hidden", str(output), "folder", True)

    # Exact file state is content-verified by get_paths/annotate_listing. The
    # fast inheritance set must contain directories only.
    assert get_hidden_paths(str(cache), "output") == {"folder"}
    assert set(get_paths(str(cache), "output", "hidden", str(output))) == {"a.png", "folder"}


# ---------------------------------------------------------------------------
# migration
# ---------------------------------------------------------------------------

def write_legacy_favorites(path: Path, favorites: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "updatedAt": 1, "favorites": favorites}), encoding="utf-8")


def write_legacy_hidden(path: Path, hidden: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "updatedAt": 1, "hidden": hidden}), encoding="utf-8")


def test_migrate_legacy_basic_shape_and_reject_starts_empty(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "folder").mkdir()
    (output / "folder2").mkdir()

    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {
        "output": [
            {"path": "a.png", "kind": "file", "sha256": "deadbeef", "size": 10, "mtimeNs": 123},
            {"path": "folder", "kind": "dir"},
        ]
    })
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {"output": ["b.png", "folder2"]})

    ok = migrate_legacy(
        str(cache),
        favorites_path=str(favorites_path),
        hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    )
    assert ok is True

    result = get_all(str(cache), "output", str(output))
    assert result["favorite"] == ["folder"]  # a.png absent, not verified
    assert result["hidden"] == ["folder2"]  # b.png absent, not verified
    assert result["reject"] == []

    fav_entry = raw_entry(cache, "output", "favorite", "a.png")
    assert fav_entry is not None
    assert fav_entry.get("legacySha256") == "deadbeef"
    assert "contentId" not in fav_entry

    hidden_entry = raw_entry(cache, "output", "hidden", "b.png")
    assert hidden_entry is not None
    assert "contentId" not in hidden_entry
    assert "legacySha256" not in hidden_entry


def test_migrate_legacy_favorite_present_file_upgrades_eagerly(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    content = b"present-and-accounted-for"
    (output / "present.png").write_bytes(content)

    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {
        "output": [
            {
                "path": "present.png",
                "kind": "file",
                "sha256": hashlib.sha256(content).hexdigest(),
                # Deliberately stale signature forces migration to verify the
                # old full SHA before upgrading identity.
                "size": 1,
                "mtimeNs": 1,
            },
        ]
    })
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {})

    ok = migrate_legacy(
        str(cache),
        favorites_path=str(favorites_path),
        hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    )
    assert ok is True

    entry = raw_entry(cache, "output", "favorite", "present.png")
    assert entry is not None
    assert isinstance(entry.get("contentId"), str) and entry["contentId"].startswith("p1:")
    assert "legacySha256" not in entry
    assert entry["size"] == len(content)
    assert get_all(str(cache), "output", str(output))["favorite"] == ["present.png"]


def test_migrate_legacy_name_reuse_does_not_favorite_replacement(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "same.png"
    original_content = b"legacy-original-A"
    original.write_bytes(original_content)
    original_stat = original.stat()

    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {
        "output": [{
            "path": "same.png",
            "kind": "file",
            "sha256": hashlib.sha256(original_content).hexdigest(),
            "size": len(original_content),
            "mtimeNs": original_stat.st_mtime_ns,
        }],
    })
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {})

    moved = output / "moved-A.png"
    original.rename(moved)
    original.write_bytes(b"replacement-B-has-different-bytes-and-size")

    assert migrate_legacy(
        str(cache),
        favorites_path=str(favorites_path),
        hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    ) is True

    assert get_paths(str(cache), "output", "favorite", str(output)) == []
    listing = [file_entry("moved-A.png"), file_entry("same.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())
    assert listing[0].get("favorite") is True
    assert not listing[1].get("favorite")


def test_migrate_legacy_favorite_absent_survives_and_is_rediscovered_by_full_sha(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()

    content = b"the-original-bytes-that-will-come-back"
    legacy_sha = hashlib.sha256(content).hexdigest()

    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {
        "output": [
            {"path": "gone.png", "kind": "file", "sha256": legacy_sha, "size": len(content), "mtimeNs": 0},
        ]
    })
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {})

    ok = migrate_legacy(
        str(cache),
        favorites_path=str(favorites_path),
        hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    )
    assert ok is True

    entry = raw_entry(cache, "output", "favorite", "gone.png")
    assert entry is not None
    assert entry.get("legacySha256") == legacy_sha
    assert "contentId" not in entry
    # Not dropped just because the file is absent.
    assert get_all(str(cache), "output", str(output))["favorite"] == []

    # The file reappears, moved to a brand-new path.
    found_dir = output / "found"
    found_dir.mkdir()
    (found_dir / "gone.png").write_bytes(content)

    listing = [file_entry("found/gone.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    assert listing[0].get("favorite") is True
    upgraded = raw_entry(cache, "output", "favorite", "found/gone.png")
    assert upgraded is not None
    assert isinstance(upgraded.get("contentId"), str) and upgraded["contentId"].startswith("p1:")
    assert "legacySha256" not in upgraded

    # A second listing pass must be a stable no-op (fast path only from here
    # on -- the full-sha fallback paid its cost exactly once).
    before = cache.read_text(encoding="utf-8")
    listing2 = [file_entry("found/gone.png")]
    annotate_listing(str(cache), "output", str(output), listing2, set())
    after = cache.read_text(encoding="utf-8")
    assert listing2[0].get("favorite") is True
    assert before == after


def test_migrate_legacy_hidden_absent_becomes_unknown_then_upgrades_at_same_path(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()

    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {})
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {"output": ["hidden_gone.png"]})

    ok = migrate_legacy(
        str(cache),
        favorites_path=str(favorites_path),
        hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    )
    assert ok is True

    entry = raw_entry(cache, "output", "hidden", "hidden_gone.png")
    assert entry is not None
    assert entry.get("kind") == "unknown"
    assert "contentId" not in entry
    assert "legacySha256" not in entry
    assert "size" not in entry

    # The file later appears at the *exact same* recorded path.
    (output / "hidden_gone.png").write_bytes(b"now-it-exists")

    listing = [file_entry("hidden_gone.png")]
    annotate_listing(str(cache), "output", str(output), listing, get_hidden_paths(str(cache), "output"))

    assert listing[0].get("hiddenSelf") is True
    assert listing[0].get("hidden") is True
    upgraded = raw_entry(cache, "output", "hidden", "hidden_gone.png")
    assert isinstance(upgraded.get("contentId"), str) and upgraded["contentId"].startswith("p1:")
    assert upgraded["size"] == len(b"now-it-exists")
    assert get_paths(str(cache), "output", "hidden", str(output)) == ["hidden_gone.png"]


def test_migrate_legacy_absent_hidden_folder_becomes_inherited_when_it_returns(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {})
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {"output": ["hidden-folder"]})

    assert migrate_legacy(
        str(cache),
        favorites_path=str(favorites_path),
        hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    ) is True
    assert raw_entry(cache, "output", "hidden", "hidden-folder")["kind"] == "unknown"

    (output / "hidden-folder").mkdir()
    (output / "hidden-folder" / "child.png").write_bytes(b"child")
    assert get_paths(str(cache), "output", "hidden", str(output)) == ["hidden-folder"]
    assert get_hidden_paths(str(cache), "output") == {"hidden-folder"}

    listing = [file_entry("hidden-folder/child.png")]
    annotate_listing(str(cache), "output", str(output), listing, {"hidden-folder"})
    assert listing[0].get("hidden") is True


def test_unknown_hidden_path_can_be_cleared_before_read_time_upgrade(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {})
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {"output": ["returned-folder"]})
    assert migrate_legacy(
        str(cache),
        favorites_path=str(favorites_path),
        hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    ) is True

    (output / "returned-folder").mkdir()
    set_state(str(cache), "output", "hidden", str(output), "returned-folder", False)

    assert raw_entry(cache, "output", "hidden", "returned-folder") is None


def test_rejecting_legacy_favorite_before_hydration_clears_same_content(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    content = b"legacy-content"
    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {
        "output": [{
            "path": "image.png",
            "kind": "file",
            "sha256": hashlib.sha256(content).hexdigest(),
            "size": len(content),
            "mtimeNs": 0,
        }],
    })
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {})
    assert migrate_legacy(
        str(cache),
        favorites_path=str(favorites_path),
        hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    ) is True

    (output / "image.png").write_bytes(content)
    set_state(str(cache), "output", "reject", str(output), "image.png", True)

    assert get_all(str(cache), "output", str(output)) == {
        "favorite": [],
        "reject": ["image.png"],
        "hidden": [],
    }


def test_get_all_does_not_hold_lock_while_hashing(tmp_path: Path, monkeypatch):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    slow = output / "slow.png"
    fast = output / "fast.png"
    slow.write_bytes(b"slow-content")
    fast.write_bytes(b"fast-content")
    set_state(str(cache), "output", "favorite", str(output), "slow.png", True)

    # Force verification to hash slow.png instead of taking the signature fast
    # path, then pause that hash while a concurrent writer updates fast.png.
    stat = slow.stat()
    os.utime(slow, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    started = threading.Event()
    release = threading.Event()
    original_content_id_with_stat = mobile_file_state._content_id_with_stat

    def blocking_content_id_with_stat(path: str):
        if Path(path).name == "slow.png":
            started.set()
            assert release.wait(timeout=5)
        return original_content_id_with_stat(path)

    monkeypatch.setattr(
        mobile_file_state,
        "_content_id_with_stat",
        blocking_content_id_with_stat,
    )
    reader = threading.Thread(
        target=get_all,
        args=(str(cache), "output", str(output)),
        daemon=True,
    )
    reader.start()
    assert started.wait(timeout=2)

    writer = threading.Thread(
        target=set_state,
        args=(str(cache), "output", "reject", str(output), "fast.png", True),
        daemon=True,
    )
    writer.start()
    writer.join(timeout=1)
    writer_finished_while_hash_blocked = not writer.is_alive()

    release.set()
    reader.join(timeout=2)
    writer.join(timeout=2)

    assert writer_finished_while_hash_blocked
    assert not reader.is_alive()
    assert not writer.is_alive()
    assert get_paths(str(cache), "output", "reject", str(output)) == ["fast.png"]


def test_annotate_listing_does_not_clobber_concurrent_rename(tmp_path: Path, monkeypatch):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "old.png"
    original.write_bytes(b"content-that-moved")
    set_state(str(cache), "output", "favorite", str(output), "old.png", True)
    moved = output / "external.png"
    original.rename(moved)

    started = threading.Event()
    release = threading.Event()
    original_content_id = mobile_file_state.content_id

    def blocking_content_id(path: str) -> str:
        if Path(path).name == "external.png":
            started.set()
            assert release.wait(timeout=5)
        return original_content_id(path)

    monkeypatch.setattr(mobile_file_state, "content_id", blocking_content_id)
    listing = [file_entry("external.png")]
    reader = threading.Thread(
        target=annotate_listing,
        args=(str(cache), "output", str(output), listing, set()),
        daemon=True,
    )
    reader.start()
    assert started.wait(timeout=2)

    rename_path(str(cache), "output", "old.png", "concurrent-winner.png")
    release.set()
    reader.join(timeout=2)

    assert not reader.is_alive()
    assert listing[0].get("favorite") is True
    assert raw_entry(cache, "output", "favorite", "concurrent-winner.png") is not None
    assert raw_entry(cache, "output", "favorite", "external.png") is None


def test_migrate_legacy_does_not_rerun_once_cache_exists(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "a.png").write_bytes(b"a")

    favorites_path = tmp_path / "file_favorites.json"
    write_legacy_favorites(favorites_path, {
        "output": [{"path": "a.png", "kind": "file", "sha256": "x", "size": 1, "mtimeNs": 1}],
    })
    hidden_path = tmp_path / "hidden_items.json"
    write_legacy_hidden(hidden_path, {})

    assert migrate_legacy(
        str(cache), favorites_path=str(favorites_path), hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    ) is True

    # The user changes state after migration.
    set_state(str(cache), "output", "favorite", str(output), "a.png", False)
    assert get_paths(str(cache), "output", "favorite", str(output)) == []

    # A second legacy source, introduced after the fact, must never be merged
    # in -- migration is one-time only.
    write_legacy_hidden(hidden_path, {"output": ["should-not-appear.png"]})
    assert migrate_legacy(
        str(cache), favorites_path=str(favorites_path), hidden_path=str(hidden_path),
        base_dirs={"output": str(output)},
    ) is False

    assert get_paths(str(cache), "output", "favorite", str(output)) == []
    assert get_hidden_paths(str(cache), "output") == set()


def test_duplicate_content_does_not_inherit_reject(tmp_path: Path):
    # Rejecting feeds an irreversible "Delete Rejected" bulk action, so a
    # byte-identical twin must NOT pick the mark up: content matching exists to
    # follow a moved file, and a duplicate only looks like a move because the
    # bytes agree. The original is still sitting at its own path.
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "run_a_00001.png").write_bytes(b"identical-frame-bytes")
    (output / "run_b_00001.png").write_bytes(b"identical-frame-bytes")

    set_state(str(cache), "output", "reject", str(output), "run_a_00001.png", True)

    listing = [file_entry("run_a_00001.png"), file_entry("run_b_00001.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    assert [item.get("rejected") for item in listing] == [True, None]
    assert get_paths(str(cache), "output", "reject", str(output)) == ["run_a_00001.png"]


def test_duplicate_content_does_not_inherit_favorite_or_hidden(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    (output / "one.png").write_bytes(b"same-bytes-here")
    (output / "two.png").write_bytes(b"same-bytes-here")

    set_state(str(cache), "output", "favorite", str(output), "one.png", True)
    set_state(str(cache), "output", "hidden", str(output), "one.png", True)

    listing = [file_entry("one.png"), file_entry("two.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    assert [item.get("favorite") for item in listing] == [True, None]
    assert [item.get("hiddenSelf") for item in listing] == [True, None]


def test_state_still_follows_a_move_when_a_duplicate_exists(tmp_path: Path):
    # The guard must not break the feature it protects: once the original path
    # is gone, the entry follows the file to its new home.
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "before.png"
    original.write_bytes(b"followed-bytes")
    set_state(str(cache), "output", "reject", str(output), "before.png", True)

    original.rename(output / "after.png")
    listing = [file_entry("after.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    assert listing[0].get("rejected") is True
    assert get_paths(str(cache), "output", "reject", str(output)) == ["after.png"]


# --- Listing-path characterization -----------------------------------------
# These pin the exact interplay the files endpoint depends on (verified hidden
# paths, path-only directory inheritance, and annotation), so the shared-load
# optimisation below them cannot quietly change what a listing reports.

@pytest.fixture
def listing_tree(tmp_path: Path):
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    (output / "album").mkdir(parents=True)
    (output / "album" / "inside.png").write_bytes(b"inside-bytes")
    (output / "loose.png").write_bytes(b"loose-bytes")
    (output / "secret.png").write_bytes(b"secret-bytes")
    return cache, output


def test_listing_hidden_paths_are_content_verified(listing_tree):
    cache, output = listing_tree
    set_state(str(cache), "output", "hidden", str(output), "secret.png", True)

    assert get_paths(str(cache), "output", "hidden", str(output)) == ["secret.png"]

    # Same path, different bytes: the new file must NOT inherit hidden.
    (output / "secret.png").write_bytes(b"a-totally-different-file")
    assert get_paths(str(cache), "output", "hidden", str(output)) == []


def test_hidden_dirs_are_path_only_and_exclude_files(listing_tree):
    cache, output = listing_tree
    set_state(str(cache), "output", "hidden", str(output), "album", True)
    set_state(str(cache), "output", "hidden", str(output), "loose.png", True)

    dirs = get_hidden_paths(str(cache), "output")

    # Directories can't be hashed, so they're tracked by path; file entries are
    # deliberately excluded so a replaced file can't inherit hidden unverified.
    assert dirs == {"album"}


def test_annotation_applies_folder_inheritance_and_states(listing_tree):
    cache, output = listing_tree
    set_state(str(cache), "output", "hidden", str(output), "album", True)
    set_state(str(cache), "output", "favorite", str(output), "loose.png", True)
    set_state(str(cache), "output", "reject", str(output), "secret.png", True)

    listing = [
        file_entry("album/inside.png"),
        file_entry("loose.png"),
        file_entry("secret.png"),
    ]
    annotate_listing(
        str(cache), "output", str(output), listing,
        get_hidden_paths(str(cache), "output"),
    )

    assert listing[0].get("hidden") is True      # inherited from the folder
    assert listing[0].get("hiddenSelf") is not True
    assert listing[1].get("favorite") is True
    assert listing[2].get("rejected") is True


def test_listing_reads_do_not_mutate_state(listing_tree):
    # A listing is a read: it may upgrade an entry's stored identity, but must
    # never drop paths that are merely absent right now (a folder can be
    # transiently unmounted).
    cache, output = listing_tree
    set_state(str(cache), "output", "favorite", str(output), "loose.png", True)
    (output / "loose.png").unlink()

    listing = [file_entry("secret.png")]
    annotate_listing(str(cache), "output", str(output), listing, set())

    entries = read_cache(cache)["states"]["output"]["favorite"]
    assert [entry["path"] for entry in entries] == ["loose.png"]


def test_hidden_listing_view_matches_the_two_calls_it_replaces(listing_tree):
    # Equivalence check against the pair the listing endpoint used to make, so
    # the shared-load version can't drift from the behaviour it replaced.
    cache, output = listing_tree
    set_state(str(cache), "output", "hidden", str(output), "album", True)
    set_state(str(cache), "output", "hidden", str(output), "secret.png", True)

    expected_verified = set(get_paths(str(cache), "output", "hidden", str(output)))
    expected_dirs = get_hidden_paths(str(cache), "output")
    expected_dirs.intersection_update(expected_verified)

    verified, dirs = mobile_file_state.get_hidden_listing_view(
        str(cache), "output", str(output)
    )

    assert set(verified) == expected_verified
    assert dirs == expected_dirs


def test_hidden_listing_view_reads_the_state_file_once(listing_tree, monkeypatch):
    cache, output = listing_tree
    set_state(str(cache), "output", "hidden", str(output), "album", True)
    loads = []
    real_load = mobile_file_state._load
    monkeypatch.setattr(
        mobile_file_state, "_load",
        lambda path: (loads.append(path), real_load(path))[1],
    )

    mobile_file_state.get_hidden_listing_view(str(cache), "output", str(output))

    # One read for the snapshot. A second only happens when verification found
    # identity upgrades to write back, which this fixture has none of.
    assert len(loads) == 1


def test_hidden_listing_view_drops_a_replaced_file(listing_tree):
    # The verification the listing depends on: a new file at a hidden path must
    # not inherit that state.
    cache, output = listing_tree
    set_state(str(cache), "output", "hidden", str(output), "secret.png", True)
    (output / "secret.png").write_bytes(b"replaced-with-different-bytes")

    verified, dirs = mobile_file_state.get_hidden_listing_view(
        str(cache), "output", str(output)
    )

    assert verified == []
    assert dirs == set()


def test_hidden_listing_view_sees_an_unknown_kind_folder_that_returned(tmp_path: Path):
    # A folder hidden while absent is stored kind="unknown" (migrate_legacy's
    # shape) and only becomes "dir" during verification. Reading directory
    # identities before that pass dropped its inheritance for a listing — the
    # exact case the replaced two-call sequence ordered itself around.
    cache = tmp_path / "file_state.json"
    output = tmp_path / "output"
    (output / "gone_for_now").mkdir(parents=True)
    (output / "gone_for_now" / "inside.png").write_bytes(b"inside")
    cache.write_text(json.dumps({
        "version": 2,
        "updatedAt": 1,
        "states": {"output": {"hidden": [{"path": "gone_for_now", "kind": "unknown"}]}},
    }), encoding="utf-8")

    verified, dirs = mobile_file_state.get_hidden_listing_view(
        str(cache), "output", str(output)
    )

    assert verified == ["gone_for_now"]
    assert dirs == {"gone_for_now"}, "the returned folder must carry inheritance immediately"
