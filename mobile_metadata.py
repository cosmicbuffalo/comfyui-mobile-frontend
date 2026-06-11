import json
import os
from typing import Any

IMAGE_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp', '.gif')
VIDEO_EXTENSIONS = ('.mp4', '.mov', '.webm', '.mkv')


# In-memory cache for the prompt JSON text of a file, keyed by absolute path.
# Each entry stores (mtime, prompt_text_lower). Lookups verify the cached
# mtime against the file's current mtime so edits/replacements invalidate the
# entry transparently. Bounded by ComfyUI's process lifetime.
_PROMPT_TEXT_CACHE: dict[str, tuple[float, str]] = {}
# Cap the cache so repeated prompt searches over large output folders can't grow
# it without bound for the life of the process.
_PROMPT_TEXT_CACHE_MAX = 4096


def _read_prompt_text(full_path: str) -> str:
    """Read the embedded prompt JSON text from a PNG and return it lowercased.

    Returns an empty string for non-PNG files or for files that can't be read.
    PNGs from ComfyUI store the prompt under the `prompt` tEXt chunk; we read
    just that chunk via Pillow's Image.info, which doesn't decode pixels and
    keeps per-file cost low.
    """
    ext = os.path.splitext(full_path)[1].lower()
    if ext != '.png':
        return ''
    try:
        from PIL import Image
        with Image.open(full_path) as img:
            metadata = img.info
            prompt_value = metadata.get('prompt', '')
            if isinstance(prompt_value, bytes):
                prompt_value = prompt_value.decode('utf-8', errors='ignore')
            if not isinstance(prompt_value, str):
                prompt_value = str(prompt_value)
            return prompt_value.lower()
    except Exception:
        return ''


def get_cached_prompt_text(full_path: str) -> str:
    """Return the cached lowercased prompt JSON text for a file, refreshing
    the cache when the file's mtime has changed since the last read.
    """
    try:
        mtime = os.path.getmtime(full_path)
    except OSError:
        return ''
    cached = _PROMPT_TEXT_CACHE.get(full_path)
    if cached is not None and cached[0] == mtime:
        return cached[1]
    text = _read_prompt_text(full_path)
    if (
        len(_PROMPT_TEXT_CACHE) >= _PROMPT_TEXT_CACHE_MAX
        and full_path not in _PROMPT_TEXT_CACHE
    ):
        # Coarse eviction: drop the oldest-inserted ~10% (dict preserves order).
        for key in list(_PROMPT_TEXT_CACHE)[: _PROMPT_TEXT_CACHE_MAX // 10]:
            del _PROMPT_TEXT_CACHE[key]
    _PROMPT_TEXT_CACHE[full_path] = (mtime, text)
    return text


def clear_prompt_text_cache() -> None:
    """Drop the in-memory cache. Useful in tests."""
    _PROMPT_TEXT_CACHE.clear()


class MetadataPathError(ValueError):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


def resolve_metadata_path(
    filepath: str,
    source: str,
    input_dir: str,
    output_dir: str,
) -> str:
    if not filepath:
        raise MetadataPathError("No path provided", 400)

    base_dir = input_dir if source == 'input' else output_dir
    base_dir_real = os.path.realpath(base_dir)
    target_path = os.path.abspath(os.path.join(base_dir_real, filepath))

    # Separator-aware containment on realpath'd paths: rejects same-prefix sibling
    # dirs (e.g. output_secret vs output) and symlink escapes, which a bare
    # startswith on abspath would let through.
    target_real = os.path.realpath(target_path)
    if target_real != base_dir_real and not target_real.startswith(base_dir_real + os.sep):
        raise MetadataPathError("Access denied", 403)

    if not os.path.exists(target_path):
        raise MetadataPathError("File not found", 404)

    if os.path.isdir(target_path):
        raise MetadataPathError("Folder metadata not supported", 400)

    ext = os.path.splitext(target_path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        base_name = os.path.splitext(os.path.basename(target_path))[0]
        folder_path = os.path.dirname(target_path)
        for image_ext in IMAGE_EXTENSIONS:
            candidate = os.path.join(folder_path, base_name + image_ext)
            if os.path.exists(candidate):
                return candidate
        raise MetadataPathError("No image metadata found for video", 404)

    if ext not in IMAGE_EXTENSIONS:
        raise MetadataPathError("Unsupported file type", 400)

    return target_path


def extract_workflow_from_metadata(metadata: dict[str, Any]) -> Any | None:
    workflow_value = metadata.get('workflow') or metadata.get('Workflow')
    if isinstance(workflow_value, bytes):
        workflow_value = workflow_value.decode('utf-8', errors='ignore')
    if workflow_value:
        try:
            return json.loads(workflow_value) if isinstance(workflow_value, str) else workflow_value
        except Exception:
            pass

    prompt_value = metadata.get('prompt') or metadata.get('Prompt')
    if isinstance(prompt_value, bytes):
        prompt_value = prompt_value.decode('utf-8', errors='ignore')
    if not prompt_value:
        return None

    try:
        prompt_data = json.loads(prompt_value)
    except Exception:
        return None

    extra_pnginfo = prompt_data.get('extra_pnginfo', {})
    if isinstance(extra_pnginfo, str):
        try:
            extra_pnginfo = json.loads(extra_pnginfo)
        except Exception:
            extra_pnginfo = {}
    return (
        extra_pnginfo.get('workflow')
        or prompt_data.get('workflow')
        or prompt_data.get('workflow_v2')
    )
