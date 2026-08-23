import os
from pathlib import Path

import mobile_video_thumbs


def test_cache_key_uses_nanosecond_mtime(tmp_path: Path, monkeypatch):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"aaaa")
    os.utime(video, ns=(1_000_000_000, 1_000_000_001))
    monkeypatch.setattr(mobile_video_thumbs, "_cache_dir", lambda: str(cache_dir))

    first = mobile_video_thumbs._cache_path(str(video))
    video.write_bytes(b"bbbb")
    os.utime(video, ns=(1_000_000_000, 1_000_000_002))
    second = mobile_video_thumbs._cache_path(str(video))

    assert first != second


def test_cache_key_changes_when_path_is_reused_with_preserved_mtime(
    tmp_path: Path,
    monkeypatch,
):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"old-video")
    original_stat = video.stat()
    monkeypatch.setattr(mobile_video_thumbs, "_cache_dir", lambda: str(cache_dir))

    first = mobile_video_thumbs._cache_path(str(video))
    video.rename(tmp_path / "moved-old.mp4")
    video.write_bytes(b"new-video")
    os.utime(video, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
    second = mobile_video_thumbs._cache_path(str(video))

    assert second != first
