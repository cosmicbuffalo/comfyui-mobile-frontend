"""Duration metadata for output videos, cached by file identity.

The outputs grid renders still-image posters, so the browser has no media
element from which to read a video's duration.  This module probes only the
videos the client is about to show and caches the result by mtime + size.
"""

import math
import os
import threading
from typing import Any


_LOCK = threading.Lock()
# path -> ((mtime_ns, size), duration_seconds | None)
_CACHE: dict[str, tuple[tuple[int, int], float | None]] = {}
_CACHE_MAX = 4096


def _signature(path: str) -> tuple[int, int] | None:
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return (int(stat.st_mtime_ns), int(stat.st_size))


def _valid_duration(value: Any) -> float | None:
    try:
        seconds = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return seconds if math.isfinite(seconds) and seconds > 0 else None


def _probe_with_pyav(path: str) -> float | None:
    try:
        import av
    except Exception:
        return None

    try:
        with av.open(path) as container:
            stream = next((item for item in container.streams if item.type == 'video'), None)
            if stream is None:
                return None

            # The video stream is preferable to the container because a long
            # trailing audio track should not inflate the visible clip length.
            stream_duration = getattr(stream, 'duration', None)
            time_base = getattr(stream, 'time_base', None)
            if stream_duration is not None and time_base is not None:
                duration = _valid_duration(stream_duration * time_base)
                if duration is not None:
                    return duration

            container_duration = getattr(container, 'duration', None)
            if container_duration is not None:
                duration = _valid_duration(container_duration / av.time_base)
                if duration is not None:
                    return duration

            frames = getattr(stream, 'frames', None)
            rate = getattr(stream, 'average_rate', None)
            if frames and rate:
                return _valid_duration(frames / rate)
    except Exception:
        return None
    return None


def _probe_with_cv2(path: str) -> float | None:
    """Fallback for installations where PyAV cannot probe a particular file."""
    try:
        import cv2
    except Exception:
        return None

    capture = cv2.VideoCapture(path)
    try:
        if not capture.isOpened():
            return None
        frames = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        fps = capture.get(cv2.CAP_PROP_FPS)
        if frames and fps:
            return _valid_duration(frames / fps)
    except Exception:
        return None
    finally:
        capture.release()
    return None


def get_duration(path: str) -> float | None:
    """Return a video's duration in seconds, or ``None`` when unavailable."""
    signature = _signature(path)
    if signature is None:
        return None

    with _LOCK:
        cached = _CACHE.get(path)
        if cached is not None and cached[0] == signature:
            return cached[1]

    duration = _probe_with_pyav(path)
    if duration is None:
        duration = _probe_with_cv2(path)

    with _LOCK:
        if len(_CACHE) >= _CACHE_MAX and path not in _CACHE:
            for stale in list(_CACHE)[: max(1, _CACHE_MAX // 4)]:
                del _CACHE[stale]
        _CACHE[path] = (signature, duration)
    return duration


def get_durations_for_paths(base_dir: str, rel_paths: list[str]) -> dict[str, float]:
    """Return durations keyed by safe relative path, skipping unreadable files."""
    from file_utils import safe_join

    result: dict[str, float] = {}
    for rel_path in rel_paths:
        if not isinstance(rel_path, str) or not rel_path:
            continue
        full_path = safe_join(base_dir, rel_path)
        if full_path is None or not os.path.isfile(full_path):
            continue
        duration = get_duration(full_path)
        if duration is not None:
            result[rel_path] = duration
    return result


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()
