import os
import tempfile
import pytest
import file_utils
from file_utils import entry_matches_name_or_path, is_within_dir, link_or_copy, list_files, safe_join


class TestLinkOrCopy:
    def test_hard_links_when_same_filesystem(self, tmp_path):
        src = tmp_path / "out" / "image.png"
        src.parent.mkdir()
        src.write_bytes(b"image-bytes")
        dst = tmp_path / "input" / "image.png"

        result = link_or_copy(str(src), str(dst))

        assert result == "link"
        assert dst.read_bytes() == b"image-bytes"
        # Same inode → no extra disk use, and link count went up.
        assert os.path.samefile(str(src), str(dst))
        assert src.stat().st_nlink == 2

    def test_falls_back_to_copy_when_link_fails(self, tmp_path, monkeypatch):
        src = tmp_path / "out" / "video.mp4"
        src.parent.mkdir()
        src.write_bytes(b"video-bytes")
        dst = tmp_path / "input" / "video.mp4"

        # Simulate cross-device / link-less filesystem.
        def boom(*_a, **_k):
            raise OSError(18, "Invalid cross-device link")
        monkeypatch.setattr("file_utils.os.link", boom)

        result = link_or_copy(str(src), str(dst))

        assert result == "copy"
        assert dst.read_bytes() == b"video-bytes"
        # Independent copy → distinct inode.
        assert not os.path.samefile(str(src), str(dst))

    def test_overwrites_existing_destination(self, tmp_path):
        src = tmp_path / "out" / "image.png"
        src.parent.mkdir()
        src.write_bytes(b"new")
        dst = tmp_path / "input" / "image.png"
        dst.parent.mkdir()
        dst.write_bytes(b"stale")

        result = link_or_copy(str(src), str(dst))

        assert result == "link"
        assert dst.read_bytes() == b"new"
        assert os.path.samefile(str(src), str(dst))

    def test_same_path_is_a_noop(self, tmp_path):
        # Input dir configured to equal output dir: src and dst are literally
        # the same file. The old remove-first implementation deleted it.
        f = tmp_path / "image.png"
        f.write_bytes(b"only-copy")

        result = link_or_copy(str(f), str(f))

        assert result == "link"
        assert f.read_bytes() == b"only-copy"

    def test_existing_hard_link_is_a_noop(self, tmp_path):
        src = tmp_path / "out" / "image.png"
        src.parent.mkdir()
        src.write_bytes(b"image-bytes")
        dst = tmp_path / "input" / "image.png"
        dst.parent.mkdir()
        os.link(str(src), str(dst))

        result = link_or_copy(str(src), str(dst))

        assert result == "link"
        assert os.path.samefile(str(src), str(dst))
        assert src.stat().st_nlink == 2

    def test_double_failure_preserves_existing_destination(self, tmp_path, monkeypatch):
        src = tmp_path / "out" / "image.png"
        src.parent.mkdir()
        src.write_bytes(b"new")
        dst = tmp_path / "input" / "image.png"
        dst.parent.mkdir()
        dst.write_bytes(b"precious-old-input")

        def boom(*_a, **_k):
            raise OSError(28, "No space left on device")
        monkeypatch.setattr("file_utils.os.link", boom)
        monkeypatch.setattr("file_utils.shutil.copy2", boom)

        with pytest.raises(OSError):
            link_or_copy(str(src), str(dst))

        # Old input untouched, no temp litter left behind.
        assert dst.read_bytes() == b"precious-old-input"
        assert sorted(p.name for p in dst.parent.iterdir()) == ["image.png"]

    def test_symlink_destination_replaced_with_real_link(self, tmp_path):
        src = tmp_path / "out" / "image.png"
        src.parent.mkdir()
        src.write_bytes(b"image-bytes")
        dst = tmp_path / "input" / "image.png"
        dst.parent.mkdir()
        os.symlink(str(src), str(dst))

        result = link_or_copy(str(src), str(dst))

        assert result == "link"
        assert not os.path.islink(str(dst))
        assert os.path.samefile(str(src), str(dst))


class TestIsWithinDir:
    def test_path_inside_is_allowed(self, tmp_path):
        base = str(tmp_path)
        assert is_within_dir(base, os.path.join(base, "a", "b.png"))

    def test_base_itself_is_allowed(self, tmp_path):
        base = str(tmp_path)
        assert is_within_dir(base, base)

    def test_sibling_prefix_is_rejected(self, tmp_path):
        # "<base>_secret" shares a name prefix but is NOT inside base.
        base = str(tmp_path / "output")
        (tmp_path / "output").mkdir()
        sibling = str(tmp_path / "output_secret" / "x.png")
        assert not is_within_dir(base, sibling)

    def test_parent_traversal_is_rejected(self, tmp_path):
        base = str(tmp_path / "output")
        (tmp_path / "output").mkdir()
        assert not is_within_dir(base, os.path.join(base, "..", "etc", "passwd"))


class TestSafeJoin:
    def test_returns_abspath_when_inside(self, tmp_path):
        base = str(tmp_path)
        result = safe_join(base, "sub", "file.png")
        assert result == os.path.abspath(os.path.join(base, "sub", "file.png"))

    def test_returns_none_on_traversal(self, tmp_path):
        base = str(tmp_path / "output")
        (tmp_path / "output").mkdir()
        assert safe_join(base, "../secret.png") is None

    def test_empty_rel_resolves_to_base(self, tmp_path):
        base = str(tmp_path)
        assert safe_join(base, "") == os.path.abspath(base)


@pytest.fixture
def tree(tmp_path):
    """Create a test directory tree:

    tmp_path/
        photo.png
        clip.mp4
        notes.txt          (unknown type, should be excluded)
        .hidden_file.png
        subdir/
            nested.jpg
        .hidden_dir/
            secret.png
            deep/
                deeper.png
    """
    (tmp_path / "photo.png").write_bytes(b"fake-png")
    (tmp_path / "clip.mp4").write_bytes(b"fake-mp4")
    (tmp_path / "notes.txt").write_bytes(b"text")
    (tmp_path / ".hidden_file.png").write_bytes(b"hidden")

    subdir = tmp_path / "subdir"
    subdir.mkdir()
    (subdir / "nested.jpg").write_bytes(b"nested")

    hidden_dir = tmp_path / ".hidden_dir"
    hidden_dir.mkdir()
    (hidden_dir / "secret.png").write_bytes(b"secret")
    deep = hidden_dir / "deep"
    deep.mkdir()
    (deep / "deeper.png").write_bytes(b"deeper")

    return tmp_path


class TestNonRecursiveListing:
    def test_lists_files_and_dirs(self, tree):
        results = list_files(str(tree), str(tree))
        names = [r["name"] for r in results]
        assert "subdir" in names
        assert "photo.png" in names
        assert "clip.mp4" in names

    def test_excludes_unknown_types(self, tree):
        results = list_files(str(tree), str(tree))
        names = [r["name"] for r in results]
        assert "notes.txt" not in names

    def test_dirs_sorted_first(self, tree):
        results = list_files(str(tree), str(tree))
        types = [r["type"] for r in results]
        dir_indices = [i for i, t in enumerate(types) if t == "dir"]
        file_indices = [i for i, t in enumerate(types) if t != "dir"]
        if dir_indices and file_indices:
            assert max(dir_indices) < min(file_indices)

    def test_hides_dotfiles_by_default(self, tree):
        results = list_files(str(tree), str(tree))
        names = [r["name"] for r in results]
        assert ".hidden_file.png" not in names
        assert ".hidden_dir" not in names

    def test_shows_dotfiles_when_show_hidden(self, tree):
        results = list_files(str(tree), str(tree), show_hidden=True)
        names = [r["name"] for r in results]
        assert ".hidden_file.png" in names
        assert ".hidden_dir" in names

    def test_dir_entry_has_count(self, tree):
        results = list_files(str(tree), str(tree))
        subdir_entry = next(r for r in results if r["name"] == "subdir")
        assert subdir_entry["type"] == "dir"
        assert subdir_entry["count"] == 1  # nested.jpg

    def test_dir_count_excludes_hidden_files(self, tree):
        """Hidden dir file count should not include files in hidden subdirs."""
        # Add a hidden subdir inside subdir
        hidden_sub = os.path.join(str(tree), "subdir", ".secret_sub")
        os.makedirs(hidden_sub)
        with open(os.path.join(hidden_sub, "hidden_nested.png"), "w") as f:
            f.write("data")

        results = list_files(str(tree), str(tree))
        subdir_entry = next(r for r in results if r["name"] == "subdir")
        # Should only count nested.jpg, not hidden_nested.png
        assert subdir_entry["count"] == 1

    def test_dir_count_excludes_manually_hidden_files(self, tree):
        results = list_files(
            str(tree),
            str(tree),
            hidden_paths={"subdir/nested.jpg"},
        )
        subdir_entry = next(r for r in results if r["name"] == "subdir")
        assert subdir_entry["count"] == 0

    def test_dir_count_excludes_manually_hidden_descendant_folder(self, tree):
        nested_dir = tree / "subdir" / "nested"
        nested_dir.mkdir()
        (nested_dir / "kept_out.png").write_bytes(b"hidden")

        results = list_files(
            str(tree),
            str(tree),
            hidden_paths={"subdir/nested"},
        )
        subdir_entry = next(r for r in results if r["name"] == "subdir")
        assert subdir_entry["count"] == 1

    def test_dir_count_includes_hidden_when_show_hidden(self, tree):
        results = list_files(str(tree), str(tree), show_hidden=True)
        hidden_dir_entry = next(r for r in results if r["name"] == ".hidden_dir")
        # secret.png + deeper.png
        assert hidden_dir_entry["count"] == 2

    def test_search_filters_by_name(self, tree):
        results = list_files(str(tree), str(tree), search="photo")
        names = [r["name"] for r in results]
        assert names == ["photo.png"]

    def test_search_is_case_insensitive(self, tree):
        results = list_files(str(tree), str(tree), search="CLIP")
        names = [r["name"] for r in results]
        assert "clip.mp4" in names

    def test_file_entry_has_expected_keys(self, tree):
        results = list_files(str(tree), str(tree))
        file_entry = next(r for r in results if r["name"] == "photo.png")
        assert "name" in file_entry
        assert "path" in file_entry
        assert "type" in file_entry
        assert "size" in file_entry
        assert "date" in file_entry
        assert file_entry["type"] == "image"
        assert file_entry["size"] > 0


class TestRecursiveListing:
    def test_recursive_includes_nested_files(self, tree):
        results = list_files(str(tree), str(tree), recursive=True)
        names = [r["name"] for r in results]
        assert "photo.png" in names
        assert "nested.jpg" in names

    def test_recursive_does_not_include_dirs(self, tree):
        results = list_files(str(tree), str(tree), recursive=True)
        types = set(r["type"] for r in results)
        assert "dir" not in types

    def test_recursive_excludes_hidden_dirs(self, tree):
        """Files inside hidden directories should NOT appear when show_hidden=False."""
        results = list_files(str(tree), str(tree), recursive=True)
        names = [r["name"] for r in results]
        assert "secret.png" not in names
        assert "deeper.png" not in names

    def test_recursive_excludes_hidden_files(self, tree):
        results = list_files(str(tree), str(tree), recursive=True)
        names = [r["name"] for r in results]
        assert ".hidden_file.png" not in names

    def test_recursive_includes_hidden_dirs_when_show_hidden(self, tree):
        results = list_files(str(tree), str(tree), recursive=True, show_hidden=True)
        names = [r["name"] for r in results]
        assert "secret.png" in names
        assert "deeper.png" in names
        assert ".hidden_file.png" in names

    def test_recursive_sets_folder_field(self, tree):
        results = list_files(str(tree), str(tree), recursive=True)
        nested = next(r for r in results if r["name"] == "nested.jpg")
        assert nested["folder"] == "subdir"

    def test_recursive_root_files_have_empty_folder(self, tree):
        results = list_files(str(tree), str(tree), recursive=True)
        root_file = next(r for r in results if r["name"] == "photo.png")
        assert root_file["folder"] == ""


class TestEntrySearch:
    def test_matches_folder_path_segment(self):
        entry = {"name": "image.png", "path": "sample scene/session/image.png"}
        assert entry_matches_name_or_path(entry, "sample scene")

    def test_scopes_folder_path_to_current_search_root(self):
        entry = {"name": "image.png", "path": "sample scene/session/image.png"}
        assert not entry_matches_name_or_path(entry, "sample scene", scope_path="sample scene")
        assert entry_matches_name_or_path(entry, "session", scope_path="sample scene")


class TestDateFiltering:
    def test_start_date_filter(self, tree):
        # Set photo.png to a known time
        photo = os.path.join(str(tree), "photo.png")
        os.utime(photo, (1000, 1000))  # mtime = 1000s = 1000000ms

        # Filter for files after 2000000ms — photo should be excluded
        results = list_files(str(tree), str(tree), start_date="2000000")
        names = [r["name"] for r in results if r["type"] != "dir"]
        assert "photo.png" not in names

    def test_end_date_filter(self, tree):
        # Set clip.mp4 far in the future
        clip = os.path.join(str(tree), "clip.mp4")
        os.utime(clip, (9999999999, 9999999999))

        # Filter for files before a reasonable time — clip should be excluded
        results = list_files(str(tree), str(tree), end_date="1000000")
        names = [r["name"] for r in results if r["type"] != "dir"]
        assert "clip.mp4" not in names


def test_dirs_only_is_sorted_and_uses_forward_slashes(tree):
    results = list_files(str(tree), str(tree), dirs_only=True, show_hidden=True)
    assert results, "expected directory entries"
    assert all(r["type"] == "dir" for r in results)
    paths = [r["path"] for r in results]
    # Contract: the listing is sorted (the dirs_only early-return honors it too).
    assert paths == sorted(paths, key=str.lower)
    # Paths are forward-slash, even for nested dirs (e.g. ".hidden_dir/deep").
    assert all("\\" not in p for p in paths)
    assert any("/" in p for p in paths)


def test_dirs_only_applies_search_filter(tree):
    results = list_files(str(tree), str(tree), dirs_only=True, show_hidden=True, search="deep")
    names = [r["name"] for r in results]
    assert names == ["deep"]


def test_content_disposition_names_the_original_file():
    # The URL path ends in "playable", so without this the browser saves the
    # video as playable.mp4 instead of the name the user knows it by.
    assert file_utils.content_disposition('clip_00042_.mp4') == (
        'inline; filename="clip_00042_.mp4"'
    )


def test_content_disposition_takes_the_basename_only():
    assert file_utils.content_disposition('videos/2026-08-06/clip.mp4') == (
        'inline; filename="clip.mp4"'
    )


def test_content_disposition_adds_utf8_form_for_non_ascii_names():
    value = file_utils.content_disposition('caffè piñata.mp4')
    assert value.startswith('inline; filename="caff_ pi_ata.mp4"')
    assert value.endswith("filename*=UTF-8''caff%C3%A8%20pi%C3%B1ata.mp4")


def test_content_disposition_strips_header_breaking_characters():
    value = file_utils.content_disposition('bad"name\r\nX-Evil: 1.mp4')
    assert '\r' not in value and '\n' not in value
    assert value.count('"') == 2


def test_content_disposition_falls_back_when_there_is_no_name():
    assert file_utils.content_disposition('') == 'inline'
    assert file_utils.content_disposition(None, 'attachment') == 'attachment'


def test_hidden_check_scales_with_path_depth_not_hidden_count():
    # This runs once per walked file and directory. A linear scan over the
    # hidden list turned a folder listing into an O(files x hidden) walk.
    from file_utils import _is_manually_hidden_rel_path

    many_hidden = frozenset("folder{}/nested".format(i) for i in range(2000))
    assert _is_manually_hidden_rel_path("a/b/c.png", many_hidden) is False
    assert _is_manually_hidden_rel_path("folder7/nested", many_hidden) is True
    assert _is_manually_hidden_rel_path("folder7/nested/deep/img.png", many_hidden) is True
    # A prefix that isn't a path boundary must not match.
    assert _is_manually_hidden_rel_path("folder7/nested-other/img.png", many_hidden) is False


def test_a_failed_reflink_leaves_nothing_behind(tmp_path, monkeypatch):
    # _reflink opens the destination for writing before it can know the
    # filesystem refuses the clone. An abandoned empty file there would make
    # os.link fail with EEXIST and push every caller onto a full copy.
    import file_utils as fu

    source = tmp_path / "src.png"
    source.write_bytes(b"payload")
    dest = tmp_path / "dst.png"

    def refuse(fd, request, arg):
        raise OSError("EOPNOTSUPP")

    import fcntl

    monkeypatch.setattr(fcntl, "ioctl", refuse)
    result = fu.link_or_copy(str(source), str(dest))

    assert result == "link"  # fell through to a hard link, not a copy
    assert dest.read_bytes() == b"payload"
    assert not any(p.name.endswith(".tmp") for p in tmp_path.iterdir())
