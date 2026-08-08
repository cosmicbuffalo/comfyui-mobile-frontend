"""Pixel dimensions for image files, read from headers and cached by mtime.

The queue card and outputs grid display a downscaled preview, so they cannot
measure a large output's real size from what they render — the preview endpoint
caps the long edge. This reads the true dimensions from the file itself.

Cheap on purpose: PIL is lazy, so ``Image.open(...).size`` parses the header and
never decodes pixels (~0.2ms for a multi-megabyte PNG). Results are cached
against the file's mtime+size, so a listing pays for each file once and a
replaced file is re-read.
"""
import os
import threading
from typing import Any

_LOCK = threading.Lock()
# path -> ((mtime_ns, size), (width, height) | None)
# A None result is cached too: a folder of videos and .txt sidecars would
# otherwise re-open every non-image on every listing, which is the case the
# cache exists for.
_CACHE: dict[str, tuple[tuple[int, int], tuple[int, int] | None]] = {}
# Bounded so a long browse over a huge library can't grow this without limit.
# Entries are pure derived data, so dropping them only costs a re-read.
_CACHE_MAX = 8192


def _signature(path: str) -> tuple[int, int] | None:
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return (int(stat.st_mtime_ns), int(stat.st_size))


_EXIF_ORIENTATION_TAG = 0x0112


def _exif_orientation(image: Any) -> int | None:
    """EXIF orientation, or None when absent/unreadable.

    Guarded end to end: a truncated EXIF block must cost a rotation, not the
    whole measurement.
    """
    try:
        exif = image.getexif()
    except Exception:
        return None
    if not exif:
        return None
    try:
        value = exif.get(_EXIF_ORIENTATION_TAG)
    except Exception:
        return None
    return value if isinstance(value, int) else None


def get_dimensions(path: str) -> tuple[int, int] | None:
    """Return ``(width, height)``, or None when the file isn't a readable image.

    Never raises: a corrupt or non-image file yields None so one bad file can't
    fail a whole batch.
    """
    signature = _signature(path)
    if signature is None:
        return None

    with _LOCK:
        cached = _CACHE.get(path)
        if cached is not None and cached[0] == signature:
            return cached[1]

    def remember(value: tuple[int, int] | None) -> tuple[int, int] | None:
        with _LOCK:
            if len(_CACHE) >= _CACHE_MAX and path not in _CACHE:
                # Evict the oldest entries rather than wiping the map: a browse
                # that crosses the ceiling would otherwise throw away every
                # measurement and re-read the folder the user is looking at.
                for stale in list(_CACHE)[: max(1, _CACHE_MAX // 4)]:
                    del _CACHE[stale]
            _CACHE[path] = (signature, value)
        return value

    try:
        from PIL import Image
    except Exception:
        return None

    try:
        with Image.open(path) as image:
            size = image.size
            orientation = _exif_orientation(image)
        if not (isinstance(size, tuple) and len(size) == 2):
            return remember(None)
        width, height = int(size[0]), int(size[1])
        # EXIF orientations 5-8 are the quarter turns. The browser applies them,
        # so a phone photo stored 4032x3024 displays as 3024x4032 — report what
        # the user actually sees.
        if orientation in (5, 6, 7, 8):
            width, height = height, width
    except getattr(Image, 'UnidentifiedImageError', ()):
        # Definitively not an image. Worth remembering — this is the
        # folder-of-videos-and-sidecars case the negative cache exists for.
        # (UnidentifiedImageError subclasses OSError, so it must be caught
        # before the transient branch below.)
        return remember(None)
    except OSError:
        # An I/O failure says nothing about the file's contents, so don't
        # memoize it: the signature may never change again, and caching the
        # miss would suppress this image's badge for the life of the process.
        return None
    except Exception:
        return remember(None)
    if width <= 0 or height <= 0:
        return remember(None)

    return remember((width, height))


def get_dimensions_for_paths(base_dir: str, rel_paths: list[str]) -> dict[str, Any]:
    """Map each readable relative path to ``{"width": w, "height": h}``.

    Paths that escape ``base_dir``, don't exist, or aren't images are simply
    absent from the result rather than raising — the caller renders nothing for
    them, which is the same outcome as before it asked.
    """
    from file_utils import safe_join

    result: dict[str, Any] = {}
    for rel_path in rel_paths:
        if not isinstance(rel_path, str) or not rel_path:
            continue
        full_path = safe_join(base_dir, rel_path)
        if full_path is None or not os.path.isfile(full_path):
            continue
        dimensions = get_dimensions(full_path)
        if dimensions is None:
            continue
        result[rel_path] = {"width": dimensions[0], "height": dimensions[1]}
    return result


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()
