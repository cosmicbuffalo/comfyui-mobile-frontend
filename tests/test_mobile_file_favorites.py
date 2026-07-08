from pathlib import Path

from mobile_file_favorites import (
    get_favorite_paths,
    mark_favorites,
    rename_path,
    set_favorite,
)


def file_entry(path: str, size: int) -> dict:
    return {
        "name": path.split("/")[-1],
        "path": path,
        "type": "image",
        "size": size,
    }


def test_favorite_survives_rename(tmp_path: Path):
    cache = tmp_path / "file_favorites.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "image.png"
    original.write_bytes(b"favorite")

    assert set_favorite(str(cache), "output", str(output), "image.png", True) == ["image.png"]

    moved_dir = output / "saved"
    moved_dir.mkdir()
    moved = moved_dir / "renamed.png"
    original.rename(moved)
    rename_path(str(cache), "output", "image.png", "saved/renamed.png")

    assert get_favorite_paths(str(cache), "output", str(output)) == ["saved/renamed.png"]


def test_listing_rediscovers_externally_moved_favorite_by_hash(tmp_path: Path):
    cache = tmp_path / "file_favorites.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "image.png"
    content = b"same-image"
    original.write_bytes(content)

    set_favorite(str(cache), "output", str(output), "image.png", True)
    moved_dir = output / "external"
    moved_dir.mkdir()
    moved = moved_dir / "image.png"
    original.rename(moved)

    listing = [file_entry("external/image.png", len(content))]
    mark_favorites(str(cache), "output", str(output), listing)

    assert listing[0]["favorite"] is True
    assert get_favorite_paths(str(cache), "output", str(output)) == ["external/image.png"]


def test_reused_filename_does_not_inherit_favorite(tmp_path: Path):
    cache = tmp_path / "file_favorites.json"
    output = tmp_path / "output"
    output.mkdir()
    original = output / "image.png"
    original.write_bytes(b"favorite")

    set_favorite(str(cache), "output", str(output), "image.png", True)
    original.write_bytes(b"different-generation")

    listing = [file_entry("image.png", len(b"different-generation"))]
    mark_favorites(str(cache), "output", str(output), listing)

    assert "favorite" not in listing[0]
    assert get_favorite_paths(str(cache), "output", str(output)) == []


def test_folder_favorites_are_server_synced_by_path(tmp_path: Path):
    cache = tmp_path / "file_favorites.json"
    output = tmp_path / "output"
    output.mkdir()
    folder = output / "keepers"
    folder.mkdir()

    assert set_favorite(str(cache), "output", str(output), "keepers", True) == ["keepers"]

    listing = [{"name": "keepers", "path": "keepers", "type": "dir"}]
    mark_favorites(str(cache), "output", str(output), listing)
    assert listing[0]["favorite"] is True

    moved = output / "renamed"
    folder.rename(moved)
    rename_path(str(cache), "output", "keepers", "renamed")
    assert get_favorite_paths(str(cache), "output", str(output)) == ["renamed"]
