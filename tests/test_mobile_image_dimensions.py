import os
from pathlib import Path

import pytest

import mobile_image_dimensions as dims

# conftest leaves PIL alone when Pillow is installed; skip the whole module on a
# runner without it rather than measuring headers against a mock.
Image = pytest.importorskip("PIL.Image", reason="Pillow not installed")
if type(Image).__module__.startswith("unittest.mock"):
    pytest.skip("Pillow not installed", allow_module_level=True)


@pytest.fixture(autouse=True)
def clear():
    dims.clear_cache()
    yield
    dims.clear_cache()


def _write_png(path: Path, size=(320, 200)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (10, 20, 30)).save(path)
    return path


def test_reads_true_dimensions(tmp_path: Path):
    path = _write_png(tmp_path / "a.png", (1920, 1080))
    assert dims.get_dimensions(str(path)) == (1920, 1080)


def test_caches_by_mtime_and_size(tmp_path: Path, monkeypatch):
    path = _write_png(tmp_path / "a.png", (640, 480))
    assert dims.get_dimensions(str(path)) == (640, 480)

    # Second read must not touch PIL at all.
    import PIL.Image as pil

    monkeypatch.setattr(pil, "open", lambda *a, **k: pytest.fail("should be cached"))
    assert dims.get_dimensions(str(path)) == (640, 480)


def test_a_replaced_file_is_re_read(tmp_path: Path):
    path = _write_png(tmp_path / "a.png", (640, 480))
    assert dims.get_dimensions(str(path)) == (640, 480)

    _write_png(path, (800, 600))
    os.utime(path, ns=(1, 1))  # force a different signature
    assert dims.get_dimensions(str(path)) == (800, 600)


def test_missing_and_corrupt_files_yield_none(tmp_path: Path):
    assert dims.get_dimensions(str(tmp_path / "nope.png")) is None
    corrupt = tmp_path / "bad.png"
    corrupt.write_bytes(b"not actually a png")
    assert dims.get_dimensions(str(corrupt)) is None


def test_batch_skips_unreadable_entries_instead_of_failing(tmp_path: Path):
    output = tmp_path / "output"
    _write_png(output / "good.png", (100, 50))
    (output / "bad.png").write_bytes(b"garbage")

    result = dims.get_dimensions_for_paths(
        str(output), ["good.png", "bad.png", "missing.png"]
    )

    assert result == {"good.png": {"width": 100, "height": 50}}


def test_batch_refuses_paths_escaping_the_base_dir(tmp_path: Path):
    output = tmp_path / "output"
    _write_png(output / "in.png", (10, 10))
    _write_png(tmp_path / "outside.png", (10, 10))

    result = dims.get_dimensions_for_paths(str(output), ["../outside.png", "in.png"])

    assert list(result) == ["in.png"]


@pytest.mark.parametrize("orientation,expected", [(1, (400, 200)), (6, (200, 400)), (8, (200, 400))])
def test_rotated_photos_report_displayed_dimensions(tmp_path: Path, orientation, expected):
    # A phone photo stores landscape pixels plus an EXIF quarter turn; every
    # viewer applies it, so the badge must match what the user sees.
    path = tmp_path / "photo.jpg"
    image = Image.new("RGB", (400, 200), (10, 20, 30))
    exif = image.getexif()
    exif[0x0112] = orientation
    image.save(path, exif=exif)

    assert dims.get_dimensions(str(path)) == expected


def test_a_corrupt_exif_block_still_yields_dimensions(tmp_path: Path, monkeypatch):
    path = _write_png(tmp_path / "a.png", (640, 480))
    import PIL.Image as pil

    original_open = pil.open

    def broken_open(*args, **kwargs):
        image = original_open(*args, **kwargs)
        image.getexif = lambda: (_ for _ in ()).throw(ValueError("bad exif"))
        return image

    monkeypatch.setattr(pil, "open", broken_open)
    assert dims.get_dimensions(str(path)) == (640, 480)


def test_a_non_image_is_only_opened_once(tmp_path: Path, monkeypatch):
    # A folder of videos and sidecars would otherwise pay a failed open per file
    # on every listing — exactly the case the cache is for.
    bad = tmp_path / "notes.txt"
    bad.write_bytes(b"just text")
    assert dims.get_dimensions(str(bad)) is None

    import PIL.Image as pil

    monkeypatch.setattr(pil, "open", lambda *a, **k: pytest.fail("should be cached"))
    assert dims.get_dimensions(str(bad)) is None


def test_crossing_the_ceiling_evicts_the_oldest_not_everything(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(dims, "_CACHE_MAX", 8)
    paths = [_write_png(tmp_path / f"f{i}.png", (10 + i, 10)) for i in range(9)]
    for path in paths:
        dims.get_dimensions(str(path))

    cached = dims._CACHE
    assert len(cached) > 1  # a wipe would leave just the last entry
    assert str(paths[-1]) in cached
    assert str(paths[0]) not in cached


def test_a_transient_read_failure_is_not_remembered(tmp_path: Path, monkeypatch):
    # An I/O error says nothing about the contents. Caching it would suppress
    # this image's badge for the life of the process, since the file's
    # signature may never change again.
    path = _write_png(tmp_path / "a.png", (640, 480))
    import PIL.Image as pil

    original_open = pil.open
    monkeypatch.setattr(pil, "open", lambda *a, **k: (_ for _ in ()).throw(OSError("EMFILE")))
    assert dims.get_dimensions(str(path)) is None

    monkeypatch.setattr(pil, "open", original_open)
    assert dims.get_dimensions(str(path)) == (640, 480)
