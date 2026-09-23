"""The playable-video route serves original bytes and launches nothing.

Registry policy flags any process launch reachable from a route, so 3.3.3
removed server-side remux/transcode. These tests pin down what the route does
instead: the original file under its real MIME type, with the same cache and
error contract the client relied on before. Byte ranges come from aiohttp's
FileResponse, which is stubbed here (see conftest.py), so the tests assert the
handler hands the original path to it.
"""
import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

import mobile_routes_media as routes


ROOT = Path(__file__).resolve().parent.parent


def test_converter_implementation_is_not_shipped():
    assert not (ROOT / 'mobile_video_playback.py').exists()
    assert not (ROOT / 'mobile_video_worker.py').exists()


class _FakeWeb:
    """Records the response the handler builds instead of sending it."""

    @staticmethod
    def FileResponse(path, headers=None):
        return SimpleNamespace(kind='file', status=200, path=path, headers=headers or {})

    @staticmethod
    def Response(status=200, text=None, headers=None):
        return SimpleNamespace(kind='plain', status=status, text=text, headers=headers or {})


@pytest.fixture
def output_dir(tmp_path, monkeypatch):
    for name in ('clip.webm', 'clip.mp4'):
        (tmp_path / name).write_bytes(b'video bytes')
    (tmp_path / 'notes.txt').write_bytes(b'not a video')
    monkeypatch.setattr(routes, 'web', _FakeWeb)
    monkeypatch.setattr(routes, '_source_base_dir', lambda source: str(tmp_path))
    return tmp_path


def _get(query):
    return asyncio.run(routes.api_get_playable_video(SimpleNamespace(query=query)))


def test_serves_the_original_file_under_its_own_type(output_dir):
    response = _get({'filename': 'clip.webm'})

    assert response.kind == 'file'
    assert Path(response.path) == output_dir / 'clip.webm'
    # A webm labelled video/mp4 is refused by engines that trust the header.
    assert response.headers['Content-Type'] == 'video/webm'
    assert response.headers['X-Mobile-Video-Mode'] == 'direct'
    assert 'clip.webm' in response.headers['Content-Disposition']


def test_long_cache_only_with_a_cache_bust_token(output_dir):
    plain = _get({'filename': 'clip.mp4'})
    busted = _get({'filename': 'clip.mp4', 'cb': 'abc123'})

    assert plain.headers['Cache-Control'] == 'private, no-cache'
    assert busted.headers['Cache-Control'] == 'private, max-age=86400'


@pytest.mark.parametrize(
    'query, expected',
    [
        ({}, 400),
        ({'filename': 'clip.mp4', 'type': 'models'}, 400),
        ({'filename': 'notes.txt'}, 415),
        ({'filename': 'gone.mp4'}, 404),
        ({'filename': 'clip.mp4', 'subfolder': '../..'}, 403),
    ],
)
def test_rejects_bad_requests(output_dir, query, expected):
    response = _get(query)

    assert response.kind == 'plain'
    assert response.status == expected
    assert response.headers['Cache-Control'] == 'no-store'
