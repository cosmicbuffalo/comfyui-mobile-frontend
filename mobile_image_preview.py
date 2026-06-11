"""On-the-fly, screen-sized WebP previews for the full-screen image viewer.

The viewer used to load ComfyUI's ``&preview=webp``, which re-encodes the image
at its *full* resolution. For high-res outputs (e.g. a 3072x4608 / ~25 MB Flux
PNG) that still streamed several MB and decoded a 14-megapixel image on the
phone, which is what made opening/swiping lag.

This renders a preview capped to the device's screen size (longest edge), and
caches the result on disk keyed by file identity + max edge so the expensive
source decode happens at most once per (image, size). Heavy deps (PIL) are
imported lazily so importing this module stays cheap.
"""

import hashlib
import io
import os

import binary_cache_io as _binary_cache_io

DEFAULT_MAX_EDGE = 2048
MIN_MAX_EDGE = 256
MAX_MAX_EDGE = 4096
PREVIEW_QUALITY = 85


def clamp_max_edge(value, default=DEFAULT_MAX_EDGE):
    """Coerce a client-supplied maxedge into a sane, bounded integer."""
    try:
        edge = int(value)
    except (TypeError, ValueError):
        return default
    return max(MIN_MAX_EDGE, min(MAX_MAX_EDGE, edge))


def _cache_dir():
    import folder_paths

    path = os.path.join(folder_paths.get_temp_directory(), 'mobile_image_previews')
    os.makedirs(path, exist_ok=True)
    return path


def _cache_path(file_path, max_edge):
    try:
        stat = os.stat(file_path)
        key = '{}|{}|{}|{}'.format(
            os.path.abspath(file_path), int(stat.st_mtime), stat.st_size, max_edge
        )
    except OSError:
        key = '{}|{}'.format(os.path.abspath(file_path), max_edge)
    # Non-security cache key; usedforsecurity=False keeps security scanners quiet.
    digest = hashlib.md5(key.encode('utf-8'), usedforsecurity=False).hexdigest()
    return os.path.join(_cache_dir(), digest + '.webp')


def get_cached(file_path, max_edge):
    """Return cached WebP bytes for (file, max_edge), or None if not cached."""
    try:
        path = _cache_path(file_path, max_edge)
        if os.path.exists(path):
            with open(path, 'rb') as handle:
                return handle.read()
    except OSError:
        pass
    return None


def store_cached(file_path, max_edge, data):
    # Atomic: a concurrent reader must never see (and the 24h browser cache
    # never pin) a half-written preview.
    _binary_cache_io.atomic_write_bytes(_cache_path(file_path, max_edge), data)


def render(file_path, max_edge):
    """Decode, downscale (longest edge <= max_edge), and encode to WebP.

    Synchronous (decode + resize + encode) — call via run_in_executor. Returns
    the encoded WebP bytes.
    """
    from PIL import Image, ImageOps

    with Image.open(file_path) as img:
        img = ImageOps.exif_transpose(img)
        if max(img.width, img.height) > max_edge:
            img.thumbnail((max_edge, max_edge), Image.LANCZOS)
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGBA' if 'A' in img.getbands() else 'RGB')
        buffer = io.BytesIO()
        img.save(buffer, format='WEBP', quality=PREVIEW_QUALITY, method=4)
        return buffer.getvalue()


def get_or_render(file_path, max_edge):
    """Cached-or-render WebP bytes for the given file at the given max edge."""
    cached = get_cached(file_path, max_edge)
    if cached is not None:
        return cached
    # Collapse concurrent misses for the same preview to a single render.
    with _binary_cache_io.render_lock(_cache_path(file_path, max_edge)):
        cached = get_cached(file_path, max_edge)
        if cached is not None:
            return cached
        data = render(file_path, max_edge)
        store_cached(file_path, max_edge, data)
        return data
