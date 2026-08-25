"""Shared constants and helpers for the mobile-frontend route modules.

Extracted from the extension's ``__init__.py`` — one home for the cache-path
constants and the small source/directory helpers several route domains use,
so the route modules neither duplicate them nor import each other for it.
"""

import os

import folder_paths
from PIL import Image

import mobile_video_thumbs as _mobile_video_thumbs

EXTENSION_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(EXTENSION_DIR, "dist")
# Regenerable, machine-local runtime caches live under a single .cache/ dir
# (gitignored) rather than scattered at the extension root.
CACHE_DIR = os.path.join(EXTENSION_DIR, ".cache")
QUEUE_METADATA_CACHE_PATH = os.path.join(CACHE_DIR, "queue_metadata_cache.json")

# Hidden marks and alias mappings are durable user state, not regenerable caches:
# e.g. the file-prefix map is the only record of a workflow's real output prefix
# behind its `mp-…` alias, so wiping .cache/ on a custom-node update would lose
# it. Keep them in ComfyUI's user-data area and migrate any legacy copies once.
_MOBILE_USERDATA_DIR = os.path.join(folder_paths.get_user_directory(), "default", "mobile")
HIDDEN_ITEMS_CACHE_PATH = os.path.join(_MOBILE_USERDATA_DIR, "hidden_items.json")
FILE_FAVORITES_CACHE_PATH = os.path.join(_MOBILE_USERDATA_DIR, "file_favorites.json")
# Unified favorite/reject/hidden state (content-hash identity). The two paths
# above are left in place after migration for rollback safety (not deleted).
FILE_STATE_CACHE_PATH = os.path.join(_MOBILE_USERDATA_DIR, "file_state.json")
INPUT_ALIASES_CACHE_PATH = os.path.join(_MOBILE_USERDATA_DIR, "input_aliases.json")
FILE_PREFIX_ALIASES_CACHE_PATH = os.path.join(_MOBILE_USERDATA_DIR, "file_prefix_aliases.json")
LEGACY_HIDDEN_ITEMS_CACHE_PATHS = [
    os.path.join(EXTENSION_DIR, "hidden_items_cache.json"),
    os.path.join(CACHE_DIR, "hidden_items_cache.json"),
]
LEGACY_INPUT_ALIASES_CACHE_PATHS = [
    os.path.join(EXTENSION_DIR, "input_aliases_cache.json"),
    os.path.join(CACHE_DIR, "input_aliases_cache.json"),
]
LEGACY_FILE_PREFIX_ALIASES_CACHE_PATHS = [
    os.path.join(EXTENSION_DIR, "file_prefix_aliases_cache.json"),
    os.path.join(CACHE_DIR, "file_prefix_aliases_cache.json"),
]

def _safe_int(value, default):
    """Parse an int from a query param, falling back to default on junk input so
    a malformed ?limit=abc degrades gracefully instead of raising a 500."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


_ASSET_SOURCES = ('output', 'input', 'temp')


def _source_base_dir(source):
    """Resolve the base directory for an asset ``source``.

    Anything that isn't input or temp resolves to the output directory, so an
    unrecognised source can never escape it.
    """
    if source == 'input':
        return folder_paths.get_input_directory()
    if source == 'temp':
        return folder_paths.get_temp_directory()
    return folder_paths.get_output_directory()


def _read_pnginfo_metadata(path):
    """Open an image and return its merged info/text metadata dict, closing the
    file handle. Synchronous (PIL parse + file I/O) — call via run_in_executor
    so it doesn't block the aiohttp event loop, and use `with` so the handle
    isn't leaked until GC.
    """
    with Image.open(path) as img:
        metadata = dict(img.info)
        text = getattr(img, 'text', None)
        if isinstance(text, dict):
            metadata.update(text)
    return metadata


def _render_image_thumbnail(path):
    """Open + downscale/encode an image thumbnail, closing the file handle.
    Synchronous (decode + resize + re-encode) — call via run_in_executor.
    Returns (body_bytes, content_type).
    """
    with Image.open(path) as img:
        return _mobile_video_thumbs.encode_thumbnail(img)


def _render_preview_thumbnail(path, width):
    """Downscale a still-image model preview to fit ~`width` px, for the model
    dropdown rows (which show a tiny thumbnail — serving the full-res file there
    wastes bandwidth/decode). Synchronous — call via run_in_executor.
    Returns (body_bytes, content_type).
    """
    with Image.open(path) as img:
        return _mobile_video_thumbs.encode_thumbnail(img, size=(width, width))
