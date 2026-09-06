import os
from pathlib import Path

import mobile_video_metadata as metadata


def setup_function():
    metadata.clear_cache()


def teardown_function():
    metadata.clear_cache()


def test_duration_is_cached_by_file_identity(tmp_path: Path, monkeypatch):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"video-one")
    monkeypatch.setattr(metadata, "_probe_with_pyav", lambda _path: 5.47)
    monkeypatch.setattr(metadata, "_probe_with_cv2", lambda _path: None)

    assert metadata.get_duration(str(video)) == 5.47

    def fail_probe(_path):
        raise AssertionError("cached duration should not be probed again")

    monkeypatch.setattr(metadata, "_probe_with_pyav", fail_probe)
    assert metadata.get_duration(str(video)) == 5.47


def test_replaced_video_is_probed_again(tmp_path: Path, monkeypatch):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"old")
    durations = iter((5.0, 10.0))
    monkeypatch.setattr(metadata, "_probe_with_pyav", lambda _path: next(durations))
    monkeypatch.setattr(metadata, "_probe_with_cv2", lambda _path: None)

    assert metadata.get_duration(str(video)) == 5.0
    video.write_bytes(b"new-video")
    os.utime(video, ns=(1, 2))
    assert metadata.get_duration(str(video)) == 10.0


def test_batch_skips_missing_failed_and_escaping_paths(tmp_path: Path, monkeypatch):
    output = tmp_path / "output"
    output.mkdir()
    (output / "good.mp4").write_bytes(b"good")
    (output / "bad.mp4").write_bytes(b"bad")
    (tmp_path / "outside.mp4").write_bytes(b"outside")

    monkeypatch.setattr(
        metadata,
        "get_duration",
        lambda path: 10.0 if path.endswith("good.mp4") else None,
    )

    assert metadata.get_durations_for_paths(
        str(output),
        ["good.mp4", "bad.mp4", "missing.mp4", "../outside.mp4"],
    ) == {"good.mp4": 10.0}


def test_invalid_probe_result_uses_fallback(tmp_path: Path, monkeypatch):
    video = tmp_path / "clip.webm"
    video.write_bytes(b"video")
    monkeypatch.setattr(metadata, "_probe_with_pyav", lambda _path: None)
    monkeypatch.setattr(metadata, "_probe_with_cv2", lambda _path: 2.25)

    assert metadata.get_duration(str(video)) == 2.25
