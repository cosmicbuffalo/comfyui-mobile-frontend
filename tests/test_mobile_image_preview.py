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


def test_previews_cache_hard_only_with_a_cache_bust_token(tmp_path, monkeypatch):
    """An input overwritten in place keeps its URL; without `cb` it must revalidate."""
    import asyncio
    from types import SimpleNamespace

    import mobile_routes_media as routes

    class FakeWeb:
        @staticmethod
        def Response(status=200, body=None, content_type=None, headers=None, text=None):
            return SimpleNamespace(status=status, headers=headers or {})

    (tmp_path / 'ref.png').write_bytes(b'pixels')
    monkeypatch.setattr(routes, 'web', FakeWeb)
    monkeypatch.setattr(routes, '_source_base_dir', lambda source: str(tmp_path))
    monkeypatch.setattr(routes._mobile_image_preview, 'get_or_render', lambda path, edge: b'webp')
    monkeypatch.setattr(routes, '_render_image_thumbnail', lambda path: (b'webp', 'image/webp'))

    def get(handler, **query):
        return asyncio.run(handler(SimpleNamespace(query=query))).headers['Cache-Control']

    assert get(routes.api_get_preview, filename='ref.png', type='input') == 'no-cache'
    assert get(routes.api_get_preview, filename='ref.png', type='input', cb='7') == 'public, max-age=86400'
    assert get(routes.api_get_thumbnail, filename='ref.png', source='input') == 'no-cache'
    assert get(routes.api_get_thumbnail, filename='ref.png', source='input', cb='7') == 'public, max-age=86400'
