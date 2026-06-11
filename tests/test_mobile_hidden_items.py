import json
from pathlib import Path

from mobile_hidden_items import (
    get_hidden_paths,
    migrate_legacy_cache,
    remove_path,
    set_hidden,
)


def write_hidden(path: Path, hidden: dict[str, list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": 1, "updatedAt": 1, "hidden": hidden}),
        encoding="utf-8",
    )


def test_migrate_legacy_cache_merges_old_locations_once(tmp_path: Path):
    destination = tmp_path / "user" / "mobile" / "hidden_items.json"
    old_root = tmp_path / "extension" / "hidden_items_cache.json"
    old_cache = tmp_path / "extension" / ".cache" / "hidden_items_cache.json"
    write_hidden(old_root, {"output": ["video", "images"]})
    write_hidden(old_cache, {"output": ["video", "upscales"], "input": ["private"]})

    assert migrate_legacy_cache(str(destination), [str(old_root), str(old_cache)])
    assert get_hidden_paths(str(destination), "output") == {"video", "images", "upscales"}
    assert get_hidden_paths(str(destination), "input") == {"private"}

    # Existing durable state wins on later starts, so an intentionally unhidden
    # legacy path is not resurrected.
    set_hidden(str(destination), "output", "video", False)
    assert not migrate_legacy_cache(str(destination), [str(old_root), str(old_cache)])
    assert get_hidden_paths(str(destination), "output") == {"images", "upscales"}


def test_hidden_marker_survives_target_temporarily_missing(tmp_path: Path):
    cache = tmp_path / "hidden_items.json"
    set_hidden(str(cache), "output", "generated/video", True)

    # Reads do not depend on the target currently existing on disk.
    assert get_hidden_paths(str(cache), "output") == {"generated/video"}

    # Explicit deletion remains the operation that removes stale markers.
    remove_path(str(cache), "output", "generated")
    assert get_hidden_paths(str(cache), "output") == set()
