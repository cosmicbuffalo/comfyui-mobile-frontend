"""Extract a representative still frame from a video file for use as a thumbnail.

Used by the /mobile/api/thumbnail endpoint when a video has no sidecar image
(an image with the same basename). Heavy decoding deps are imported lazily and
each backend is tried in turn, so the node still loads (and image thumbnails
still work) even when no video backend is available.

Extracted frames are cached as JPEGs under ComfyUI's temp directory, keyed by
the source path + mtime + size, so repeated grid loads don't re-decode.
"""

import hashlib
import io
import os

import binary_cache_io as _binary_cache_io

# Kept in sync with the video extensions recognized by api_get_thumbnail.
VIDEO_EXTENSIONS = ('.mp4', '.mov', '.webm', '.mkv')


def is_video(filename):
    return os.path.splitext(filename)[1].lower() in VIDEO_EXTENSIONS


def _cache_dir():
    import folder_paths

    path = os.path.join(folder_paths.get_temp_directory(), 'mobile_video_thumbs')
    os.makedirs(path, exist_ok=True)
    return path


def _cache_path(file_path):
    try:
        stat = os.stat(file_path)
        key = '{}|{}|{}'.format(os.path.abspath(file_path), int(stat.st_mtime), stat.st_size)
    except OSError:
        key = os.path.abspath(file_path)
    # Non-security cache key; usedforsecurity=False keeps security scanners quiet.
    digest = hashlib.md5(key.encode('utf-8'), usedforsecurity=False).hexdigest()
    return os.path.join(_cache_dir(), digest + '.jpg')


def get_cached_thumbnail(file_path):
    """Return cached JPEG bytes for this video, or None if not cached."""
    try:
        path = _cache_path(file_path)
        if os.path.exists(path):
            with open(path, 'rb') as handle:
                return handle.read()
    except OSError:
        pass
    return None


def store_cached_thumbnail(file_path, data):
    # Atomic: a concurrent reader must never see (and the 24h browser cache
    # never pin) a half-written thumbnail.
    _binary_cache_io.atomic_write_bytes(_cache_path(file_path), data)


def get_or_render_thumbnail(file_path, size=(300, 300)):
    """Cached-or-render JPEG thumbnail bytes for a video, or None on failure.

    Synchronous (frame decode) — call via run_in_executor. Concurrent misses
    for the same video collapse to a single decode.
    """
    cached = get_cached_thumbnail(file_path)
    if cached is not None:
        return cached
    with _binary_cache_io.render_lock(_cache_path(file_path)):
        cached = get_cached_thumbnail(file_path)
        if cached is not None:
            return cached
        data = render_thumbnail(file_path, size)
        if data is not None:
            store_cached_thumbnail(file_path, data)
        return data


def encode_thumbnail(img, size=(300, 300), force_jpeg=False):
    """Orient, downscale to `size`, and encode a PIL image to thumbnail bytes.

    Returns (bytes, content_type). Images with transparency are saved as PNG to
    preserve the alpha channel, unless `force_jpeg` is set (used for opaque video
    frames so the on-disk cache stays a single format).
    """
    from PIL import ImageOps

    img = ImageOps.exif_transpose(img)
    img.thumbnail(size)

    buffer = io.BytesIO()
    has_alpha = img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info)
    if has_alpha and not force_jpeg:
        img.save(buffer, format='PNG')
        return buffer.getvalue(), 'image/png'
    if img.mode != 'RGB':
        img = img.convert('RGB')
    img.save(buffer, format='JPEG', quality=80)
    return buffer.getvalue(), 'image/jpeg'


def render_thumbnail(file_path, size=(300, 300)):
    """Extract a frame and return JPEG bytes downscaled to `size`, or None."""
    frame = _extract_frame(file_path)
    if frame is None:
        return None
    data, _ = encode_thumbnail(frame, size, force_jpeg=True)
    return data


def _extract_frame(file_path):
    """Return a PIL.Image of an early frame, trying each backend until one works."""
    for backend in (_frame_cv2, _frame_av, _frame_imageio):
        try:
            frame = backend(file_path)
            if frame is not None:
                return frame
        except Exception:
            continue
    return None


def _frame_cv2(file_path):
    import cv2
    from PIL import Image

    capture = cv2.VideoCapture(file_path)
    try:
        if not capture.isOpened():
            return None
        ok, frame = capture.read()
        if not ok or frame is None:
            return None
        return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    finally:
        capture.release()


def _frame_av(file_path):
    import av

    with av.open(file_path) as container:
        stream = next((s for s in container.streams if s.type == 'video'), None)
        if stream is None:
            return None
        for frame in container.decode(stream):
            return frame.to_image()
    return None


def _frame_imageio(file_path):
    import imageio.v3 as iio
    from PIL import Image

    return Image.fromarray(iio.imread(file_path, index=0))
