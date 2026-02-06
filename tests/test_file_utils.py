import os
import tempfile
import pytest
from file_utils import list_files


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
