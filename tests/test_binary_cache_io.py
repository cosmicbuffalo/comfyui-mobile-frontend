import os
import threading

from binary_cache_io import atomic_write_bytes, render_lock


def test_atomic_write_round_trips(tmp_path):
    path = str(tmp_path / "thumb.jpg")
    atomic_write_bytes(path, b"image-bytes")
    with open(path, "rb") as handle:
        assert handle.read() == b"image-bytes"


def test_atomic_write_leaves_no_temp_files(tmp_path):
    path = str(tmp_path / "thumb.jpg")
    atomic_write_bytes(path, b"data")
    assert os.listdir(str(tmp_path)) == ["thumb.jpg"]


def test_atomic_write_overwrites_existing(tmp_path):
    path = str(tmp_path / "thumb.jpg")
    atomic_write_bytes(path, b"old")
    atomic_write_bytes(path, b"new")
    with open(path, "rb") as handle:
        assert handle.read() == b"new"


def test_atomic_write_swallows_unwritable_dir(tmp_path):
    # Mirrors store_cached's historical never-raise contract.
    atomic_write_bytes(str(tmp_path / "missing-dir" / "thumb.jpg"), b"data")


def test_render_lock_same_key_returns_same_lock():
    assert render_lock("/cache/a.webp") is render_lock("/cache/a.webp")
    assert render_lock("/cache/a.webp") is not render_lock("/cache/b.webp")


def test_render_lock_collapses_concurrent_renders():
    renders = []
    results = []
    barrier = threading.Barrier(4)

    def get_or_render():
        barrier.wait()
        cached = renders[-1] if renders else None
        if cached is None:
            with render_lock("/cache/herd.webp"):
                cached = renders[-1] if renders else None
                if cached is None:
                    renders.append(b"rendered")
                    cached = b"rendered"
        results.append(cached)

    threads = [threading.Thread(target=get_or_render) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert renders == [b"rendered"]
    assert results == [b"rendered"] * 4
