import os

import mobile_image_preview as preview


def test_replaced_file_within_same_second_misses_preview_cache(tmp_path, monkeypatch):
    source = tmp_path / "reused.png"
    source.write_bytes(b"old")
    first_mtime_ns = 1_700_000_000_100_000_000
    os.utime(source, ns=(first_mtime_ns, first_mtime_ns))
    monkeypatch.setattr(preview, "_cache_dir", lambda: str(tmp_path))

    renders = []

    def render_first(_path, _max_edge):
        renders.append("first")
        return b"first-preview"

    monkeypatch.setattr(preview, "render", render_first)
    assert preview.get_or_render(str(source), 1280) == b"first-preview"

    # Same path, byte size, and whole-second mtime as the first file. The old
    # int(st_mtime)+size cache key treated this as the same source image.
    source.write_bytes(b"new")
    second_mtime_ns = first_mtime_ns + 1
    os.utime(source, ns=(second_mtime_ns, second_mtime_ns))

    def render_second(_path, _max_edge):
        renders.append("second")
        return b"second-preview"

    monkeypatch.setattr(preview, "render", render_second)
    assert preview.get_or_render(str(source), 1280) == b"second-preview"
    assert renders == ["first", "second"]


def test_same_execution_token_reuses_rendered_preview(tmp_path, monkeypatch):
    source = tmp_path / "stable.png"
    source.write_bytes(b"source")
    monkeypatch.setattr(preview, "_cache_dir", lambda: str(tmp_path))

    renders = []

    def render_once(_path, _max_edge):
        renders.append(True)
        return b"preview"

    monkeypatch.setattr(preview, "render", render_once)
    assert preview.get_or_render(str(source), 1280) == b"preview"
    assert preview.get_or_render(str(source), 1280) == b"preview"
    assert renders == [True]
