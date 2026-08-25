"""Show real input paths, rather than ``.mi-…`` aliases, on desktop.

Split out of ``__init__.py``. Desktop clients never call the mobile alias
endpoints, so they are shown an ``/object_info`` where ``input`` paths are
remapped back to the original file names. The middleware is installed on the
main ComfyUI app. Keep the helper names stable — ``tests/`` imports this
module by name.
"""

import asyncio
import json
import os
import threading
import time
import zlib
from collections import OrderedDict

import folder_paths
from aiohttp import web

import mobile_input_aliases as _mobile_input_aliases
from mobile_common import INPUT_ALIASES_CACHE_PATH

def _remap_alias_strings(value, mapping, drop=frozenset()):
    """Replace input aliases inside the lists used by /object_info combos.

    Live aliases become their real input-relative paths. Aliases in ``drop``
    (whose hard-link file no longer exists) disappear from combo lists. Aliases
    whose original path moved away but whose hard link is still present stay as
    they are, since they remain valid inputs. Unknown alias-shaped strings
    remain untouched. Returning original objects for
    unchanged subtrees avoids rebuilding a multi-megabyte object_info payload
    when no known alias is present.
    """
    if isinstance(value, list):
        alias_targets = {
            mapping[item]
            for item in value
            if isinstance(item, str) and item in mapping
        }
        seen_alias_targets = set()
        output = []
        changed = False
        for item in value:
            if isinstance(item, str) and item.startswith(_mobile_input_aliases.ALIAS_PREFIX):
                real_path = mapping.get(item)
                if real_path:
                    if real_path in seen_alias_targets:
                        changed = True
                        continue
                    seen_alias_targets.add(real_path)
                    output.append(real_path)
                    changed = True
                    continue
                if item in drop:
                    changed = True
                    continue
            if isinstance(item, str) and item in alias_targets:
                if item in seen_alias_targets:
                    changed = True
                    continue
                seen_alias_targets.add(item)
            remapped = _remap_alias_strings(item, mapping, drop)
            changed = changed or remapped is not item
            output.append(remapped)
        return output if changed else value
    if isinstance(value, dict):
        output = {}
        changed = False
        for key, item in value.items():
            remapped = _remap_alias_strings(item, mapping, drop)
            changed = changed or remapped is not item
            output[key] = remapped
        return output if changed else value
    return value


# /object_info can be several megabytes. Cache its rewritten bytes briefly so
# desktop clients do not repeatedly parse the same payload. The key changes
# with the alias file and upstream body; four entries bound the memory cost.
_OBJECT_INFO_REMAP_TTL_S = 60
_OBJECT_INFO_REMAP_MAX = 4
_object_info_remap_lock = threading.Lock()
_object_info_remap_cache = OrderedDict()


def _alias_cache_stamp():
    try:
        stat = os.stat(INPUT_ALIASES_CACHE_PATH)
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


def _object_info_remap_get(key):
    now = time.monotonic()
    with _object_info_remap_lock:
        entry = _object_info_remap_cache.get(key)
        if entry is None:
            return False, None
        expires_at, body = entry
        if expires_at <= now:
            del _object_info_remap_cache[key]
            return False, None
        _object_info_remap_cache.move_to_end(key)
        return True, body


def _object_info_remap_put(key, body):
    with _object_info_remap_lock:
        _object_info_remap_cache[key] = (
            time.monotonic() + _OBJECT_INFO_REMAP_TTL_S,
            body,
        )
        _object_info_remap_cache.move_to_end(key)
        while len(_object_info_remap_cache) > _OBJECT_INFO_REMAP_MAX:
            _object_info_remap_cache.popitem(last=False)


def _build_remapped_object_info(body):
    """Build a desktop-friendly /object_info body, or None if unchanged."""
    known = _mobile_input_aliases.known_aliases(INPUT_ALIASES_CACHE_PATH)
    if not known:
        return None
    input_dir = folder_paths.get_input_directory()
    live = _mobile_input_aliases.resolve_all_aliases(INPUT_ALIASES_CACHE_PATH, input_dir)
    # Only aliases whose own file is gone are dropped. An alias that no longer
    # resolves to its original path is still a valid hard-linked input, and
    # dropping it from /object_info would break otherwise-runnable workflows.
    gone = _mobile_input_aliases.missing_aliases(INPUT_ALIASES_CACHE_PATH, input_dir)
    payload = json.loads(body)
    remapped = _remap_alias_strings(payload, live, gone - set(live))
    if remapped is payload:
        return None
    return json.dumps(remapped).encode("utf-8")

@web.middleware
async def _object_info_alias_middleware(request, handler):
    """Show real input paths, rather than `.mi-…` aliases, on desktop."""
    path = request.path
    if path.startswith('/api/'):
        path = path[4:]
    if (
        request.method != 'GET'
        or not (path == '/object_info' or path.startswith('/object_info/'))
    ):
        return await handler(request)

    response = await handler(request)
    try:
        if getattr(response, 'status', 0) != 200:
            return response
        body = getattr(response, 'body', None)
        if not body:
            return response
        stamp = _alias_cache_stamp()
        if stamp is None:
            return response
        body = bytes(body)
        key = (stamp, len(body), zlib.crc32(body))
        hit, remapped = _object_info_remap_get(key)
        if not hit:
            loop = asyncio.get_running_loop()
            remapped = await loop.run_in_executor(
                None,
                _build_remapped_object_info,
                body,
            )
            _object_info_remap_put(key, remapped)
        if remapped is not None:
            response.body = remapped
        return response
    except Exception as error:
        print(f'[Mobile Frontend] object_info alias remap skipped: {error}')
        return response
