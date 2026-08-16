print("[Mobile Frontend] Loading custom node...")
import asyncio
from collections import OrderedDict
import mimetypes
import os
import shutil
import threading
import time
import zlib
import server
from aiohttp import web
import folder_paths
import json
from PIL import Image
from importlib import import_module as _import_module
import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_file_utils = _import_module('file_utils')
_mobile_metadata = _import_module('mobile_metadata')
_mobile_queue_metadata = _import_module('mobile_queue_metadata')
_restart_utils = _import_module('restart_utils')
_model_metadata = _import_module('model_metadata')
_mobile_hidden_items = _import_module('mobile_hidden_items')
# Unused on this branch — the unified file-state store replaced every call site,
# and migrate_legacy reads file_favorites.json directly. Retained deliberately:
# v3.1.1 still routes its favorites through this module, and deleting the import
# here would delete it from that branch on the next merge (git takes the side
# that changed), leaving it calling a name that no longer exists.
_mobile_file_favorites = _import_module('mobile_file_favorites')
_mobile_file_state = _import_module('mobile_file_state')
_mobile_image_dimensions = _import_module('mobile_image_dimensions')
_mobile_input_aliases = _import_module('mobile_input_aliases')
_mobile_file_prefix_aliases = _import_module('mobile_file_prefix_aliases')
_mobile_video_thumbs = _import_module('mobile_video_thumbs')
_mobile_video_playback = _import_module('mobile_video_playback')
_mobile_image_preview = _import_module('mobile_image_preview')
_mobile_push = _import_module('mobile_push')
_mobile_web_push = _import_module('mobile_web_push')
_mobile_app_push = _import_module('mobile_app_push')
_mobile_push_prefs = _import_module('mobile_push_prefs')
# General per-server frontend preferences (e.g. autocomplete opt-in).
_mobile_app_prefs = _import_module('mobile_app_prefs')
list_files = _file_utils.list_files
entry_matches_name_or_path = _file_utils.entry_matches_name_or_path
_is_within_dir = _file_utils.is_within_dir
_safe_join = _file_utils.safe_join
resolve_metadata_path = _mobile_metadata.resolve_metadata_path
extract_workflow_from_metadata = _mobile_metadata.extract_workflow_from_metadata
get_cached_prompt_text = _mobile_metadata.get_cached_prompt_text
MetadataPathError = _mobile_metadata.MetadataPathError
build_restart_exec_args = _restart_utils.build_restart_exec_args

# Define the path to the built frontend files
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


def setup_mobile_route():
    if not os.path.exists(DIST_DIR):
        print(f"[\033[33mMobile Frontend\033[0m] 'dist' directory not found. Please run 'npm run build' in {EXTENSION_DIR}")
        return

    # One-time migration of durable user state (hidden marks + alias maps) from
    # old .cache/ (or root) locations so an earlier install's data survives.
    _mobile_hidden_items.migrate_legacy_cache(
        HIDDEN_ITEMS_CACHE_PATH,
        LEGACY_HIDDEN_ITEMS_CACHE_PATHS,
    )
    _mobile_input_aliases.migrate_legacy_cache(
        INPUT_ALIASES_CACHE_PATH,
        LEGACY_INPUT_ALIASES_CACHE_PATHS,
    )
    _mobile_file_prefix_aliases.migrate_legacy_cache(
        FILE_PREFIX_ALIASES_CACHE_PATH,
        LEGACY_FILE_PREFIX_ALIASES_CACHE_PATHS,
    )
    # One-time structural migration into the unified favorite/reject/hidden
    # state file. Runs after the legacy hidden-items migration above so
    # HIDDEN_ITEMS_CACHE_PATH is already merged/durable by the time this reads
    # it. file_favorites.json / hidden_items.json are left on disk afterward.
    _mobile_file_state.migrate_legacy(
        FILE_STATE_CACHE_PATH,
        favorites_path=FILE_FAVORITES_CACHE_PATH,
        hidden_path=HIDDEN_ITEMS_CACHE_PATH,
        hidden_legacy_paths=tuple(LEGACY_HIDDEN_ITEMS_CACHE_PATHS),
        base_dirs={
            'output': folder_paths.get_output_directory(),
            'input': folder_paths.get_input_directory(),
            'temp': folder_paths.get_temp_directory(),
        },
    )

    # Compress sizable JSON API responses on the fly. Model listings in
    # particular can be multiple MB of metadata (checkpoints/loras), and shipping
    # that uncompressed to a phone is the single biggest transfer cost in the app;
    # gzip cuts it ~5x. Static assets are served pre-compressed by serve_asset as
    # FileResponses (not web.Response), so they never reach this branch, and any
    # response that already declares a Content-Encoding is left untouched to avoid
    # double-compression. Small bodies are skipped — the CPU isn't worth it.
    @web.middleware
    async def _compress_json_responses(request, handler):
        response = await handler(request)
        try:
            if (
                isinstance(response, web.Response)
                and response.body is not None
                and 'Content-Encoding' not in response.headers
                and (response.content_type or '').startswith('application/json')
                and len(response.body) > 1024
            ):
                response.enable_compression()
        except Exception:
            # Compression is a best-effort optimization; never fail a request for it.
            pass
        return response

    # Reject malformed JSON request bodies with a clean 400 up front. Every write
    # handler does `await request.json()` inside a broad `except Exception -> 500`,
    # so a truncated/garbage body would otherwise surface as a 500 (wrong status,
    # and noise that hides real server errors). aiohttp caches the raw body bytes,
    # not the parsed result, so the handler's own request.json() parses again —
    # cheap for these small payloads, but not free. Only touches
    # POST/PUT/PATCH requests that declare a JSON content-type.
    @web.middleware
    async def _reject_malformed_json(request, handler):
        if (
            request.method in ('POST', 'PUT', 'PATCH')
            and 'application/json' in request.headers.get('Content-Type', '')
            and request.can_read_body
        ):
            try:
                parsed = await request.json()
            except Exception:
                return web.json_response({"error": "Invalid JSON body"}, status=400)
            # Every write endpoint reads the body as an object (data.get(...)); a
            # top-level array/scalar would otherwise blow up on .get() as a 500.
            if not isinstance(parsed, dict):
                return web.json_response(
                    {"error": "Request body must be a JSON object"}, status=400
                )
        return await handler(request)

    # Create a sub-application for the mobile frontend
    mobile_app = web.Application(
        middlewares=[_reject_malformed_json, _compress_json_responses]
    )

    async def api_list_files(request):
        try:
            query = request.rel_url.query
            source = query.get('source', 'output')
            if source not in _ASSET_SOURCES:
                return web.json_response({"error": "source must be output/input/temp"}, status=400)
            base_dir = _source_base_dir(source)
            subpath = query.get('path', '')
            recursive = query.get('recursive', 'false').lower() == 'true'
            dirs_only = query.get('dirsOnly', 'false').lower() == 'true'
            show_hidden = query.get('showHidden', 'false').lower() == 'true'
            search = query.get('search', '').lower()
            prompt_search = query.get('prompt', '').lower()
            # `q` is a combined-search query that matches filename OR embedded
            # prompt JSON. Implies recursion. Used by the outputs panel's
            # "search prompts" submit flow so a single query string finds
            # results across both naming conventions and prompt content.
            combined_search = query.get('q', '').lower()
            start_date = query.get('startDate') # ms timestamp
            end_date = query.get('endDate')     # ms timestamp
            limit = _safe_int(query.get('limit'), 0)
            offset = _safe_int(query.get('offset'), 0)

            # Security check for path traversal
            target_path = _safe_join(base_dir, subpath)
            if target_path is None:
                return web.json_response({"error": "Access denied"}, status=403)

            if not os.path.exists(target_path):
                return web.json_response({"error": "Path not found"}, status=404)

            # All of the filesystem work below — the recursive walk in list_files,
            # the per-file PNG-metadata reads for prompt/combined search, and the
            # hidden-state pass — is synchronous and can be heavy on a large
            # outputs folder. Run it in a thread so it never blocks the aiohttp
            # event loop (which would freeze queue progress, websockets, and every
            # other client for the duration of a search/listing).
            def _build_listing():
                # Manual hidden-state needs to be known before list_files walks
                # the tree so recursive folder counts exclude hidden descendants
                # in the same way the final listing does.
                # Only verified current hidden paths may be used to pre-filter
                # exact files. Directory inheritance remains path-based via
                # hidden_set, while a replaced file at an old hidden path is
                # retained for content-aware annotation below.
                # One load, one verification pass: the verified paths pre-filter
                # exact files while the directory paths carry inheritance, and
                # fetching them separately parsed the state file twice per
                # listing (it reaches 350KB+ on a well-used install).
                verified_hidden, hidden_set = _mobile_file_state.get_hidden_listing_view(
                    FILE_STATE_CACHE_PATH,
                    source,
                    base_dir,
                )
                verified_hidden_set = set(verified_hidden)
                # `search` already filters by filename inside list_files. For the
                # combined `q` case we want the union (filename OR prompt match),
                # so don't pre-filter by filename here — apply both checks after.
                results = list_files(
                    base_dir, target_path,
                    recursive=recursive or bool(prompt_search) or bool(combined_search),
                    show_hidden=show_hidden,
                    search='' if combined_search else search,
                    start_date=start_date,
                    end_date=end_date,
                    dirs_only=dirs_only,
                    hidden_paths=verified_hidden_set
                )
                if source == 'input':
                    # Alias files must remain at the input root so stock Load Image
                    # accepts them, but they are implementation details and should
                    # never be moved or deleted through the mobile file browser.
                    results = [
                        r for r in results
                        if not (r.get('path') or '').startswith(_mobile_input_aliases.ALIAS_PREFIX)
                    ]

                # Additional prompt search filter (requires reading image metadata).
                # Backed by an mtime-keyed in-memory cache so repeat searches don't
                # re-open every file. Matches the lowercased prompt JSON text as a
                # substring against the lowercased query.
                if prompt_search:
                    results = [
                        r for r in results
                        if prompt_search in get_cached_prompt_text(os.path.join(base_dir, r['path']))
                    ]

                # Combined search: filename OR prompt JSON match.
                if combined_search:
                    def matches_combined(entry):
                        if entry_matches_name_or_path(entry, combined_search, subpath):
                            return True
                        return combined_search in get_cached_prompt_text(
                            os.path.join(base_dir, entry['path'])
                        )
                    results = [r for r in results if matches_combined(r)]

                # Dot-prefixed segments are always hidden, independent of any
                # manual state — annotate this first so it's visible even when
                # show_hidden=True (list_files already excludes dot-hidden
                # entries when show_hidden=False, so this only ever matters for
                # display in the show_hidden=True case).
                for r in results:
                    rel = r.get('path', '')
                    if rel and any(seg.startswith('.') for seg in rel.split('/')):
                        r['hidden'] = True

                # Single content-hash-aware pass: sets favorite/rejected/
                # hiddenSelf/hidden flags, rediscovers entries whose file moved
                # externally, and applies hidden's folder inheritance via
                # hidden_set. Do not prune missing paths here: a listing is a
                # read, and folders can be transiently absent while external
                # tools move/mount/generate them.
                _mobile_file_state.annotate_listing(
                    FILE_STATE_CACHE_PATH,
                    source,
                    base_dir,
                    results,
                    hidden_set,
                )
                if not show_hidden:
                    results = [r for r in results if not r.get('hidden')]

                total = len(results)
                if limit > 0:
                    results = results[offset:offset+limit]
                return results, total

            loop = asyncio.get_event_loop()
            results, total = await loop.run_in_executor(None, _build_listing)

            return web.json_response({
                "files": results,
                "total": total,
                "offset": offset,
                "limit": limit
            })
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_delete_file(request):
        try:
            data = await request.json()
            filepath = data.get('path')
            source = data.get('source', 'output')
            if not filepath:
                return web.json_response({"error": "No path provided"}, status=400)
            if source not in _ASSET_SOURCES:
                return web.json_response({"error": "source must be output/input/temp"}, status=400)
            
            base_dir = _source_base_dir(source)
            target_path = _safe_join(base_dir, filepath)

            if target_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            
            # Refuse to delete the source root itself ({"path": "."} resolves
            # to the base dir and would rmtree the whole output/input tree).
            if os.path.realpath(target_path) == os.path.realpath(base_dir):
                return web.json_response({"error": "Access denied"}, status=403)

            def _delete_target():
                # Recursive folder deletes are O(files) of disk work; run off
                # the event loop so they don't freeze every other request
                # (including generation progress websockets).
                if not os.path.exists(target_path):
                    return False
                removal_plan = _mobile_file_state.plan_remove_path(
                    FILE_STATE_CACHE_PATH,
                    source,
                    base_dir,
                    filepath,
                )
                if os.path.isdir(target_path):
                    shutil.rmtree(target_path)
                else:
                    os.remove(target_path)
                # Remove only identities verified at this path before deletion.
                # A moved original whose old name was reused keeps its state.
                _mobile_file_state.remove_path(
                    FILE_STATE_CACHE_PATH,
                    source,
                    filepath,
                    removal_plan,
                )
                return True

            loop = asyncio.get_event_loop()
            deleted = await loop.run_in_executor(None, _delete_target)
            if deleted:
                return web.json_response({"success": True})
            return web.json_response({"error": "File not found"}, status=404)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_file_dimensions(request):
        """True pixel dimensions for a batch of images.

        Batched and client-driven rather than folded into the listing: this
        backend returns a whole folder at once, so measuring every file there
        would add a per-image open to a request that can carry thousands. The
        client asks only for what it is about to show.
        """
        try:
            data = await request.json()
            source = data.get('source', 'output')
            paths = data.get('paths')
            if source not in _ASSET_SOURCES:
                return web.json_response({"error": "source must be output/input/temp"}, status=400)
            if not isinstance(paths, list):
                return web.json_response({"error": "paths must be a list"}, status=400)
            base_dir = _source_base_dir(source)
            loop = asyncio.get_event_loop()
            dimensions = await loop.run_in_executor(
                None,
                _mobile_image_dimensions.get_dimensions_for_paths,
                base_dir,
                paths[:512],
            )
            return web.json_response({"dimensions": dimensions})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_file_metadata(request):
        try:
            filepath = request.query.get('path', '')
            source = request.query.get('source', 'output')
            metadata_path = resolve_metadata_path(
                filepath,
                source,
                folder_paths.get_input_directory(),
                folder_paths.get_output_directory(),
            )

            loop = asyncio.get_event_loop()
            metadata = await loop.run_in_executor(None, _read_pnginfo_metadata, metadata_path)
            workflow = extract_workflow_from_metadata(metadata)

            if not workflow:
                return web.json_response({"error": "No workflow metadata found"}, status=404)

            return web.json_response({"workflow": workflow})
        except MetadataPathError as e:
            return web.json_response({"error": str(e)}, status=e.status_code)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_workflow_availability(request):
        try:
            filepath = request.query.get('path', '')
            source = request.query.get('source', 'output')
            metadata_path = resolve_metadata_path(
                filepath,
                source,
                folder_paths.get_input_directory(),
                folder_paths.get_output_directory(),
            )

            loop = asyncio.get_event_loop()
            metadata = await loop.run_in_executor(None, _read_pnginfo_metadata, metadata_path)
            workflow = extract_workflow_from_metadata(metadata)
            return web.json_response({"available": bool(workflow)})
        except MetadataPathError as e:
            return web.json_response({"error": str(e)}, status=e.status_code)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_image_metadata(request):
        try:
            filepath = request.query.get('path', '')
            if not filepath:
                return web.json_response({"error": "No path provided"}, status=400)

            source = request.query.get('source', 'output')
            base_dir = _source_base_dir(source)
            target_path = _safe_join(base_dir, filepath)

            if target_path is None:
                return web.json_response({"error": "Access denied"}, status=403)

            if not os.path.exists(target_path):
                return web.json_response({"error": "File not found"}, status=404)

            if os.path.isdir(target_path):
                return web.json_response({"error": "Folder metadata not supported"}, status=400)

            ext = os.path.splitext(target_path)[1].lower()
            image_extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
            video_extensions = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi']

            metadata_path = target_path
            if ext in video_extensions:
                base_name = os.path.splitext(os.path.basename(target_path))[0]
                folder_path = os.path.dirname(target_path)
                matching_image = None
                for img_ext in image_extensions:
                    candidate = os.path.join(folder_path, base_name + img_ext)
                    if os.path.exists(candidate):
                        matching_image = candidate
                        break
                if not matching_image:
                    return web.json_response({"error": "No image metadata found for video"}, status=404)
                metadata_path = matching_image
            elif ext not in image_extensions:
                return web.json_response({"error": "Unsupported file type"}, status=400)

            loop = asyncio.get_event_loop()
            metadata = await loop.run_in_executor(None, _read_pnginfo_metadata, metadata_path)

            prompt_data = None
            prompt_str = metadata.get('prompt') or metadata.get('Prompt')
            if isinstance(prompt_str, bytes):
                prompt_str = prompt_str.decode('utf-8', errors='ignore')
            if prompt_str:
                try:
                    prompt_data = json.loads(prompt_str) if isinstance(prompt_str, str) else prompt_str
                except Exception:
                    prompt_data = None

            workflow = None
            workflow_str = metadata.get('workflow') or metadata.get('Workflow')
            if isinstance(workflow_str, bytes):
                workflow_str = workflow_str.decode('utf-8', errors='ignore')
            if workflow_str:
                try:
                    workflow = json.loads(workflow_str) if isinstance(workflow_str, str) else workflow_str
                except Exception:
                    workflow = None

            if not workflow and isinstance(prompt_data, dict):
                extra_pnginfo = prompt_data.get('extra_pnginfo', {})
                if isinstance(extra_pnginfo, str):
                    try:
                        extra_pnginfo = json.loads(extra_pnginfo)
                    except Exception:
                        extra_pnginfo = {}
                workflow = (
                    extra_pnginfo.get('workflow')
                    or prompt_data.get('workflow')
                    or prompt_data.get('workflow_v2')
                )

            return web.json_response({
                "prompt": prompt_data,
                "workflow": workflow
            })
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_get_thumbnail(request):
        # Don't let a transient miss/error (e.g. a file not yet flushed to disk,
        # a decode failure) get cached by the browser's heuristic freshness.
        no_store = {'Cache-Control': 'no-store'}
        try:
            prompt_id = request.query.get('prompt_id')
            if prompt_id:
                # Push-notification path: the payload carries only prompt_id
                # (opaque, no filename), so resolve it against ComfyUI's own
                # history server-side rather than trusting a client-supplied
                # filename/subfolder.
                inst = getattr(server.PromptServer, "instance", None)
                queue = getattr(inst, "prompt_queue", None)
                history = getattr(queue, "history", None)
                entry = history.get(prompt_id) if isinstance(history, dict) else None
                image = _mobile_push.find_first_output_image(entry) if entry is not None else None
                if image is None:
                    return web.Response(status=404, headers=no_store)
                filename = image['filename']
                subfolder = image['subfolder']
                source = image['source']
            else:
                filename = request.query.get('filename')
                subfolder = request.query.get('subfolder', '')
                source = request.query.get('source', 'output')

            if not filename:
                return web.Response(status=400, headers=no_store)

            base_dir = _source_base_dir(source)
            file_path = _safe_join(base_dir, subfolder, filename)

            if file_path is None:
                return web.Response(status=403, headers=no_store)

            if not os.path.exists(file_path):
                return web.Response(status=404, headers=no_store)

            # Output/input filenames are write-once, so a rendered thumbnail is
            # safe to cache hard — scroll-backs and panel reopens then hit the
            # browser cache instead of re-downloading + re-decoding server-side.
            cache_headers = {'Cache-Control': 'public, max-age=86400'}

            # For videos, look for an image with the same name
            ext = os.path.splitext(filename)[1].lower()
            if _mobile_video_thumbs.is_video(filename):
                base_name = os.path.splitext(filename)[0]
                folder_path = os.path.join(base_dir, subfolder) if subfolder else base_dir
                image_extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

                # Look for matching image file
                matching_image = None
                for img_ext in image_extensions:
                    candidate = os.path.join(folder_path, base_name + img_ext)
                    if os.path.exists(candidate):
                        matching_image = candidate
                        break

                if not matching_image:
                    # No sidecar image: extract a frame from the video itself and
                    # serve it (cached) so the grid shows a real thumbnail. The
                    # decode is CPU-heavy, so run it off the event loop; the
                    # helper dedupes concurrent decodes of the same video.
                    loop = asyncio.get_event_loop()
                    rendered = await loop.run_in_executor(
                        None, _mobile_video_thumbs.get_or_render_thumbnail, file_path
                    )
                    if rendered is None:
                        return web.Response(status=400, text="No thumbnail image found for video", headers=no_store)
                    return web.Response(body=rendered, content_type='image/jpeg', headers=cache_headers)

                file_path = matching_image

            loop = asyncio.get_event_loop()
            body, content_type = await loop.run_in_executor(
                None, _render_image_thumbnail, file_path
            )
            return web.Response(body=body, content_type=content_type, headers=cache_headers)
        except Exception as e:
            return web.Response(status=500, headers=no_store)

    async def api_get_preview(request):
        """Screen-sized WebP preview of a full-resolution output/input image.

        Mirrors ComfyUI's /view query params (filename/subfolder/type) plus a
        `maxedge` cap, so the viewer can load a device-sized image instead of a
        14-megapixel original. Cached on disk per (file, maxedge)."""
        # Error responses must not be cached: a 404 for a not-yet-flushed file
        # is heuristically cacheable and would stick (same class of bug as the
        # thumbnail no-store fix).
        no_store = {'Cache-Control': 'no-store'}
        try:
            filename = request.query.get('filename')
            subfolder = request.query.get('subfolder', '')
            source = request.query.get('type', 'output')
            max_edge = _mobile_image_preview.clamp_max_edge(
                request.query.get('maxedge')
            )

            if not filename:
                return web.Response(status=400, headers=no_store)

            base_dir = _source_base_dir(source)
            file_path = _safe_join(base_dir, subfolder, filename)

            if file_path is None:
                return web.Response(status=403, headers=no_store)
            if not os.path.exists(file_path):
                return web.Response(status=404, headers=no_store)

            loop = asyncio.get_event_loop()
            body = await loop.run_in_executor(
                None, _mobile_image_preview.get_or_render, file_path, max_edge
            )
            return web.Response(
                body=body,
                content_type='image/webp',
                # Output filenames are write-once, so the rendered preview is safe
                # to cache hard — repeat views / swipe-backs hit the browser cache.
                headers={'Cache-Control': 'public, max-age=86400'},
            )
        except Exception:
            return web.Response(status=500, headers=no_store)

    async def api_get_playable_video(request):
        """Serve an original or cached browser-safe MP4 with byte-range support."""
        no_store = {'Cache-Control': 'no-store'}
        try:
            filename = request.query.get('filename')
            subfolder = request.query.get('subfolder', '')
            source = request.query.get('type', request.query.get('source', 'output'))

            if not filename:
                return web.Response(status=400, text='filename is required', headers=no_store)
            if source not in _ASSET_SOURCES:
                return web.Response(status=400, text='invalid asset source', headers=no_store)
            if not _mobile_video_playback.is_video(filename):
                return web.Response(status=415, text='unsupported video type', headers=no_store)

            base_dir = _source_base_dir(source)
            file_path = _safe_join(base_dir, subfolder, filename)
            if file_path is None:
                return web.Response(status=403, headers=no_store)
            if not os.path.isfile(file_path):
                return web.Response(status=404, headers=no_store)

            loop = asyncio.get_event_loop()
            playable = await loop.run_in_executor(
                None, _mobile_video_playback.get_or_prepare, file_path
            )
            # This URL is keyed only by filename/subfolder/type, and ComfyUI
            # reuses output filenames after a delete — so a far-future max-age is
            # only safe when the caller supplied a cache-bust token that makes the
            # URL unique to this file's identity. The client's token map is
            # in-memory and empty after a reload, so without this a regenerated
            # file replays the deleted one's bytes for a day (including into
            # "Save video as…"). no-cache still stores and revalidates against the
            # ETag below, so repeat opens cost a 304 rather than a full refetch.
            cache_control = (
                'private, max-age=86400'
                if request.query.get('cb')
                else 'private, no-cache'
            )
            return web.FileResponse(
                playable.path,
                headers={
                    # aiohttp FileResponse implements Range/If-Range and emits
                    # ETag/Last-Modified.
                    'Cache-Control': cache_control,
                    # Only a prepared file is guaranteed to be MP4. When the
                    # original is served as-is (mode 'unprepared') it can be
                    # webm/mkv/mov/avi, and mislabelling it video/mp4 makes any
                    # engine that trusts the declared type refuse to play it —
                    # /view derived this from the extension, so match that.
                    'Content-Type': (
                        mimetypes.guess_type(file_path)[0] or 'video/mp4'
                        if playable.mode == 'unprepared'
                        else 'video/mp4'
                    ),
                    # Saving straight from the video element (long-press → Save,
                    # "Save video as…") otherwise names the file after the last
                    # URL path segment — "playable.mp4". The served bytes may be
                    # a remuxed cache copy, so name it after the original.
                    'Content-Disposition': _file_utils.content_disposition(filename),
                    'X-Mobile-Video-Mode': playable.mode,
                },
            )
        except _mobile_video_playback.PlaybackPreparationError as exc:
            # Preparation failed (decode error, worker killed by signal, timeout).
            # The client routes ALL video through this endpoint with no fallback
            # to /view, so refusing here makes a file unplayable that 3.0.x
            # served straight from disk. Hand over the original bytes and let the
            # browser decide — same outcome as before this gateway existed.
            print('[Mobile Frontend] Could not prepare video {} ({}); serving it as-is.'.format(
                request.query.get('filename', ''), exc
            ))
            try:
                return web.FileResponse(
                    file_path,
                    headers={
                        'Cache-Control': 'private, no-cache',
                        'Content-Type': mimetypes.guess_type(file_path)[0] or 'video/mp4',
                        'Content-Disposition': _file_utils.content_disposition(filename),
                        'X-Mobile-Video-Mode': 'unprepared',
                    },
                )
            except Exception:
                pass
            return web.Response(
                status=422,
                text='Video could not be prepared for browser playback',
                headers=no_store,
            )
        except Exception as exc:
            print('[Mobile Frontend] Playable video error: {}'.format(exc))
            return web.Response(status=500, headers=no_store)

    async def api_get_file_state(request):
        try:
            source = request.rel_url.query.get('source', 'output')
            if source not in _ASSET_SOURCES:
                return web.json_response({"error": "source must be output/input/temp"}, status=400)
            base_dir = _source_base_dir(source)
            loop = asyncio.get_event_loop()
            state = await loop.run_in_executor(
                None,
                _mobile_file_state.get_all,
                FILE_STATE_CACHE_PATH,
                source,
                base_dir,
            )
            return web.json_response(state)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_set_file_state(request):
        try:
            data = await request.json()
            path = data.get('path')
            source = data.get('source', 'output')
            state = data.get('state')
            value = data.get('value')
            if not path:
                return web.json_response({"error": "No path provided"}, status=400)
            if state not in _mobile_file_state.STATES:
                return web.json_response({"error": "state must be one of favorite/reject/hidden"}, status=400)
            if not isinstance(value, bool):
                return web.json_response({"error": "value must be a boolean"}, status=400)
            if source not in _ASSET_SOURCES:
                return web.json_response({"error": "source must be output/input/temp"}, status=400)
            base_dir = _source_base_dir(source)
            target_path = _safe_join(base_dir, path)
            if target_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            loop = asyncio.get_event_loop()
            applied = await loop.run_in_executor(
                None,
                _mobile_file_state.set_state,
                FILE_STATE_CACHE_PATH,
                source,
                state,
                base_dir,
                path,
                value,
            )
            if not applied:
                if state == 'reject' and os.path.isdir(target_path):
                    return web.json_response({"error": "Directories cannot be rejected"}, status=400)
                return web.json_response(
                    {"error": "File is not ready or changed while being read; retry"},
                    status=409,
                )
            return web.json_response({"ok": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # --- Temporary back-compat shims for the old three routes (§7/§14 of the
    # file-state spec) — forward to the unified module so a stale client or
    # bookmarked call keeps working across the transition. Remove once no
    # shipped client calls them.
    async def api_set_hidden(request):
        try:
            data = await request.json()
            path = data.get('path')
            source = data.get('source', 'output')
            hidden = bool(data.get('hidden'))
            if not path:
                return web.json_response({"error": "No path provided"}, status=400)
            if source not in _ASSET_SOURCES:
                return web.json_response({"error": "source must be output/input/temp"}, status=400)
            base_dir = _source_base_dir(source)
            target_path = _safe_join(base_dir, path)
            if target_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            loop = asyncio.get_event_loop()
            applied = await loop.run_in_executor(
                None,
                _mobile_file_state.set_state,
                FILE_STATE_CACHE_PATH,
                source,
                'hidden',
                base_dir,
                path,
                hidden,
            )
            if not applied:
                return web.json_response(
                    {"error": "File is not ready or changed while being read; retry"},
                    status=409,
                )
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_get_file_favorites(request):
        try:
            source = request.rel_url.query.get('source', 'output')
            if source not in _ASSET_SOURCES:
                return web.json_response({"error": "source must be output/input/temp"}, status=400)
            base_dir = _source_base_dir(source)
            loop = asyncio.get_event_loop()
            favorites = await loop.run_in_executor(
                None,
                _mobile_file_state.get_paths,
                FILE_STATE_CACHE_PATH,
                source,
                'favorite',
                base_dir,
            )
            return web.json_response({"favorites": favorites})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_set_file_favorite(request):
        try:
            data = await request.json()
            path = data.get('path')
            source = data.get('source', 'output')
            favorite = data.get('favorite')
            if not path:
                return web.json_response({"error": "No path provided"}, status=400)
            if not isinstance(favorite, bool):
                return web.json_response({"error": "favorite must be a boolean"}, status=400)
            if source not in _ASSET_SOURCES:
                return web.json_response({"error": "source must be output/input/temp"}, status=400)
            base_dir = _source_base_dir(source)
            target_path = _safe_join(base_dir, path)
            if target_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            loop = asyncio.get_event_loop()
            applied = await loop.run_in_executor(
                None,
                _mobile_file_state.set_state,
                FILE_STATE_CACHE_PATH,
                source,
                'favorite',
                base_dir,
                path,
                favorite,
            )
            if not applied:
                return web.json_response(
                    {"error": "File is not ready or changed while being read; retry"},
                    status=409,
                )
            favorites = await loop.run_in_executor(
                None,
                _mobile_file_state.get_paths,
                FILE_STATE_CACHE_PATH,
                source,
                'favorite',
                base_dir,
            )
            return web.json_response({"favorites": favorites})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_create_input_aliases(request):
        try:
            data = await request.json()
            paths = data.get('paths')
            if not isinstance(paths, list) or not paths:
                return web.json_response({"error": "No input paths provided"}, status=400)
            aliases = _mobile_input_aliases.ensure_aliases(
                INPUT_ALIASES_CACHE_PATH,
                folder_paths.get_input_directory(),
                paths,
            )
            return web.json_response({"aliases": aliases})
        except (ValueError, FileNotFoundError) as e:
            return web.json_response({"error": str(e)}, status=400)
        except OSError as e:
            return web.json_response({"error": str(e)}, status=409)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_resolve_input_aliases(request):
        try:
            data = await request.json()
            aliases = data.get('aliases')
            if not isinstance(aliases, list):
                return web.json_response({"error": "Invalid aliases"}, status=400)
            resolved = _mobile_input_aliases.resolve_aliases(
                INPUT_ALIASES_CACHE_PATH,
                folder_paths.get_input_directory(),
                aliases,
            )
            return web.json_response({"resolved": resolved})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_create_file_prefix_aliases(request):
        try:
            data = await request.json()
            prefixes = data.get('prefixes')
            if not isinstance(prefixes, list) or not prefixes:
                return web.json_response({"error": "No filename prefixes provided"}, status=400)
            aliases = _mobile_file_prefix_aliases.ensure_aliases(
                FILE_PREFIX_ALIASES_CACHE_PATH,
                prefixes,
            )
            return web.json_response({"aliases": aliases})
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_resolve_file_prefix_aliases(request):
        try:
            data = await request.json()
            aliases = data.get('aliases')
            if not isinstance(aliases, list):
                return web.json_response({"error": "Invalid aliases"}, status=400)
            resolved = _mobile_file_prefix_aliases.resolve_aliases(
                FILE_PREFIX_ALIASES_CACHE_PATH,
                aliases,
            )
            return web.json_response({"resolved": resolved})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_move_files(request):
        try:
            data = await request.json()
            sources = data.get('sources')
            destination = data.get('destination', '')
            source = data.get('source', 'output')
            if not sources or not isinstance(sources, list):
                return web.json_response({"error": "No sources provided"}, status=400)

            base_dir = _source_base_dir(source)
            dest_path = _safe_join(base_dir, destination)
            if dest_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            if not os.path.exists(dest_path):
                return web.json_response({"error": "Destination not found"}, status=404)
            if not os.path.isdir(dest_path):
                return web.json_response({"error": "Destination must be a folder"}, status=400)

            # Validate every path on the loop; do the disk work in an executor —
            # a move can degrade to a full copy+delete across mounts and would
            # otherwise block every other request for its duration.
            asset_source = source
            move_specs = []
            for rel in sources:
                src_path = _safe_join(base_dir, rel)
                if src_path is None:
                    return web.json_response({"error": "Access denied"}, status=403)
                move_specs.append((rel, src_path))

            def _move_all():
                for rel, src_path in move_specs:
                    if not os.path.exists(src_path):
                        continue
                    target = os.path.join(dest_path, os.path.basename(src_path))
                    shutil.move(src_path, target)
                    # Keep hidden state attached to the item across the move.
                    new_rel = os.path.relpath(target, os.path.abspath(base_dir))
                    _mobile_file_state.rename_path(
                        FILE_STATE_CACHE_PATH,
                        asset_source,
                        rel,
                        new_rel,
                        base_dir,
                    )

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _move_all)

            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    def _resolve_workflows_path(rel_path):
        """Resolve a path under the (default) user's workflows dir, guarding
        against traversal. Returns (abs_path, base_dir) or (None, base_dir)."""
        base_dir = os.path.realpath(
            os.path.join(folder_paths.get_user_directory(), 'default', 'workflows')
        )
        # realpath (not abspath) so a symlink inside the workflows dir can't
        # point destructive operations outside the sandbox.
        target = os.path.realpath(os.path.join(base_dir, rel_path))
        # Must stay strictly inside the workflows dir (never the dir itself).
        if target == base_dir or os.path.commonpath([base_dir, target]) != base_dir:
            return None, base_dir
        return target, base_dir

    async def api_create_workflow_folder(request):
        try:
            data = await request.json()
            path = (data.get('path') or '').strip().strip('/')
            if not path:
                return web.json_response({"error": "No path provided"}, status=400)
            target, _ = _resolve_workflows_path(path)
            if target is None:
                return web.json_response({"error": "Access denied"}, status=403)
            if os.path.exists(target):
                return web.json_response({"error": "A file or folder with that name already exists"}, status=409)
            os.makedirs(target, exist_ok=False)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_delete_workflow_folder(request):
        try:
            path = (request.query.get('path') or '').strip().strip('/')
            if not path:
                return web.json_response({"error": "No path provided"}, status=400)
            target, _ = _resolve_workflows_path(path)
            if target is None:
                return web.json_response({"error": "Access denied"}, status=403)
            if not os.path.isdir(target):
                return web.json_response({"error": "Folder not found"}, status=404)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, shutil.rmtree, target)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_mkdir(request):
        try:
            data = await request.json()
            path = data.get('path')
            source = data.get('source', 'output')
            if not path:
                return web.json_response({"error": "No path provided"}, status=400)

            base_dir = _source_base_dir(source)
            target_path = _safe_join(base_dir, path)
            if target_path is None:
                return web.json_response({"error": "Access denied"}, status=403)

            os.makedirs(target_path, exist_ok=True)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_rename_file(request):
        try:
            data = await request.json()
            path = data.get('path')
            new_name = (data.get('newName') or '').strip()
            source = data.get('source', 'output')

            if not path:
                return web.json_response({"error": "No path provided"}, status=400)
            if not new_name:
                return web.json_response({"error": "No new name provided"}, status=400)
            if '/' in new_name or '\\' in new_name or new_name in ('.', '..'):
                return web.json_response({"error": "Invalid name"}, status=400)

            base_dir = _source_base_dir(source)
            src_path = _safe_join(base_dir, path)
            if src_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            if not os.path.exists(src_path):
                return web.json_response({"error": "Source not found"}, status=404)

            dst_path = os.path.abspath(os.path.join(os.path.dirname(src_path), new_name))
            if not _is_within_dir(base_dir, dst_path):
                return web.json_response({"error": "Access denied"}, status=403)
            if os.path.exists(dst_path):
                return web.json_response({"error": "A file or folder with that name already exists"}, status=409)

            os.rename(src_path, dst_path)
            # Keep hidden state attached to the item across the rename.
            new_rel = os.path.relpath(dst_path, os.path.abspath(base_dir))
            _mobile_file_state.rename_path(
                FILE_STATE_CACHE_PATH,
                source,
                path,
                new_rel,
                base_dir,
            )
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_copy_file_to_input(request):
        try:
            data = await request.json()
            path = data.get('path')
            source = data.get('source', 'output')
            overwrite = bool(data.get('overwrite', True))

            if not path:
                return web.json_response({"error": "No path provided"}, status=400)
            if source not in ('output', 'temp'):
                return web.json_response({"error": "Source must be output or temp"}, status=400)

            if source == 'temp':
                source_dir = folder_paths.get_temp_directory()
            else:
                source_dir = folder_paths.get_output_directory()
            input_dir = folder_paths.get_input_directory()

            src_path = _safe_join(source_dir, path)
            if src_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            if not os.path.exists(src_path):
                return web.json_response({"error": "Source not found"}, status=404)
            if os.path.isdir(src_path):
                return web.json_response({"error": "Source must be a file"}, status=400)

            filename = os.path.basename(src_path)
            if not filename:
                return web.json_response({"error": "Invalid filename"}, status=400)

            dst_path = _safe_join(input_dir, filename)
            if dst_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            if os.path.exists(dst_path) and not overwrite:
                return web.json_response({"error": "Destination already exists"}, status=409)
            if os.path.isdir(dst_path):
                # Materializing onto a directory path would raise deep in
                # link_or_copy and the broad handler would turn it into an opaque
                # 500; reject it up front with a clear status instead.
                return web.json_response({"error": "Destination is a directory"}, status=409)

            def _copy_to_input():
                # Prefer a hard link (no extra disk use, instant even for a
                # multi-GB video) when input shares a filesystem with the source;
                # fall back to a real copy across volumes or link-less filesystems.
                # Either way it's filesystem work, so keep it off the event loop.
                return _file_utils.link_or_copy(src_path, dst_path)

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _copy_to_input)
            return web.json_response({
                "name": filename,
                "subfolder": "",
                "type": "input"
            })
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_restart_server(request):
        try:
            data = await request.json()
            confirm = data.get('confirm', False)

            if not confirm:
                return web.json_response({"error": "Restart requires confirm=true"}, status=400)

            response = web.json_response({
                "success": True,
                "message": "ComfyUI is restarting",
            })

            async def delayed_restart():
                await asyncio.sleep(0.5)
                executable, argv = build_restart_exec_args()
                os.execv(executable, argv)

            asyncio.create_task(delayed_restart())
            return response
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_cpu_stats(request):
        try:
            import psutil
            cpu_percent = psutil.cpu_percent(interval=None)
            return web.json_response({"cpu_percent": cpu_percent})
        except ImportError:
            return web.json_response({"cpu_percent": None})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_history_count(request):
        # The total number of runs in ComfyUI's in-memory history. The frontend
        # pages /history with max_items, so it only knows the loaded count; this
        # returns the real total cheaply (just len, no payload serialization).
        try:
            prompt_queue = server.PromptServer.instance.prompt_queue
            history = getattr(prompt_queue, 'history', None)
            if history is None:
                return web.json_response({"count": None})
            mutex = getattr(prompt_queue, 'mutex', None)
            if mutex is not None:
                with mutex:
                    count = len(history)
            else:
                count = len(history)
            return web.json_response({"count": count})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_queue_metadata_get(request):
        try:
            prompt_ids = request.query.getall('prompt_id', [])
            if not prompt_ids:
                ids_param = request.query.get('ids', '')
                prompt_ids = [item for item in ids_param.split(',') if item]
            metadata = _mobile_queue_metadata.get_prompt_metadata(
                QUEUE_METADATA_CACHE_PATH,
                prompt_ids if prompt_ids else None,
            )
            return web.json_response({"prompts": metadata})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_queue_metadata_post(request):
        try:
            data = await request.json()
            prompt_id = data.get('promptId')
            if not isinstance(prompt_id, str) or not prompt_id.strip():
                return web.json_response({"error": "promptId is required"}, status=400)
            entry = _mobile_queue_metadata.upsert_prompt_metadata(
                QUEUE_METADATA_CACHE_PATH,
                prompt_id.strip(),
                data,
            )
            return web.json_response({"prompt": entry})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_queue_metadata_remap(request):
        try:
            data = await request.json()
            old_prompt_id = data.get('oldPromptId')
            new_prompt_id = data.get('newPromptId')
            if not isinstance(old_prompt_id, str) or not old_prompt_id.strip():
                return web.json_response({"error": "oldPromptId is required"}, status=400)
            if not isinstance(new_prompt_id, str) or not new_prompt_id.strip():
                return web.json_response({"error": "newPromptId is required"}, status=400)
            entry = _mobile_queue_metadata.remap_prompt_metadata(
                QUEUE_METADATA_CACHE_PATH,
                old_prompt_id.strip(),
                new_prompt_id.strip(),
            )
            return web.json_response({"prompt": entry})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # --- Standalone model-metadata provider (Lora Manager-compatible) -------- #
    # These power the rich model picker for users without Lora Manager. The
    # frontend prefers LM's own /api/lm endpoints when present and only falls
    # back to these. Responses match LM's shape so the same client code works.

    async def api_models_health(request):
        # Always available — we're built into the mobile frontend.
        return web.json_response({"status": "ok", "standalone": True})

    async def api_models_list(request):
        try:
            prefix = request.match_info.get('prefix', '')
            page = _safe_int(request.query.get('page'), 1)
            page_size = _safe_int(request.query.get('page_size'), 500)
            # The first scan walks every model root + reads a sidecar per file;
            # keep it off the event loop (cached for subsequent pages).
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, _model_metadata.list_models, prefix, page, page_size
            )
            return web.json_response(result)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_models_preview(request):
        try:
            path = request.query.get('path', '')
            if not path:
                return web.Response(status=400)
            if not _model_metadata.is_within_model_roots(path):
                return web.Response(status=403)
            # Only serve image/video preview files — never arbitrary files (e.g.
            # model weights or config sidecars) that happen to live under a model root.
            if not any(path.lower().endswith(ext) for ext in _model_metadata.PREVIEW_EXTENSIONS):
                return web.Response(status=403)
            if not os.path.isfile(path):
                return web.Response(status=404)
            # Optional ?w= thumbnail for model-picker rows. Still images are
            # downscaled directly; videos return a cached extracted frame so a
            # picker with many animated previews doesn't create many simultaneous
            # range requests and decoders. Invalid widths fall through to the
            # original. The day-long client cache avoids repeat rendering.
            width = _safe_int(request.query.get('w'), 0)
            is_video = path.lower().endswith(('.mp4', '.webm', '.mov', '.mkv'))
            if width > 0 and is_video:
                loop = asyncio.get_event_loop()
                rendered = await loop.run_in_executor(
                    None, _mobile_video_thumbs.get_or_render_thumbnail, path
                )
                if rendered is not None:
                    thumb = web.Response(body=rendered, content_type='image/jpeg')
                    thumb.headers['Cache-Control'] = 'public, max-age=86400'
                    return thumb
                # Never fall through and return the original video to an <img>
                # thumbnail request. Besides failing to decode as an image, a
                # non-faststart MP4 could make the browser fetch the entire file.
                return web.Response(
                    status=400,
                    text='Unable to render video thumbnail',
                    headers={'Cache-Control': 'no-store'},
                )
            elif width > 0:
                try:
                    loop = asyncio.get_event_loop()
                    body, content_type = await loop.run_in_executor(
                        None, _render_preview_thumbnail, path, min(width, 512)
                    )
                    thumb = web.Response(body=body, content_type=content_type)
                    thumb.headers['Cache-Control'] = 'public, max-age=86400'
                    return thumb
                except Exception:
                    pass
            response = web.FileResponse(path)
            response.headers['Cache-Control'] = 'public, max-age=86400'
            return response
        except Exception:
            return web.Response(status=500)

    async def api_models_fetch_all(request):
        try:
            prefix = request.match_info.get('prefix', '')
            if prefix not in _model_metadata.PREFIX_FOLDER_KEYS:
                return web.json_response({"error": "unknown prefix"}, status=400)
            force = False
            if request.can_read_body:
                try:
                    body = await request.json()
                    force = bool(body.get('force', False))
                except Exception:
                    force = False
            # If a pass is already running, just report it. Otherwise mark it
            # running synchronously (dedupe), launch in the background, and return
            # immediately so the client can poll fetch-status for progress.
            status = _model_metadata.get_fetch_status(prefix)
            if status['running']:
                return web.json_response(status)
            _model_metadata.mark_running(prefix)
            asyncio.create_task(
                _model_metadata.fetch_all_civitai(prefix, force=force)
            )
            return web.json_response(
                {"running": True, "total": 0, "processed": 0, "updated": 0}
            )
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_models_fetch_status(request):
        try:
            prefix = request.match_info.get('prefix', '')
            return web.json_response(_model_metadata.get_fetch_status(prefix))
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # --- Web Push (browser notifications on generation completion) ---
    async def api_push_config(request):
        """Frontend reads this to get the VAPID public key (applicationServerKey)
        it needs to subscribe, plus whether push is available at all."""
        try:
            if not _mobile_web_push.is_available():
                return web.json_response({"enabled": False, "reason": _mobile_web_push.import_error()})
            return web.json_response({
                "enabled": True,
                "vapidPublicKey": _mobile_web_push.get_public_key(),
                "subscriptions": _mobile_web_push.subscription_count(),
            })
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_subscribe(request):
        try:
            if not _mobile_web_push.is_available():
                return web.json_response({"error": "push_unavailable"}, status=503)
            body = await request.json()
            # Accept either {subscription: {...}} or the raw PushSubscription JSON.
            subscription = body.get("subscription") if isinstance(body, dict) else None
            locale = body.get("locale") if isinstance(body, dict) else None
            if subscription is None and isinstance(body, dict) and "endpoint" in body:
                subscription = body
            if not _mobile_web_push.add_subscription(subscription, locale):
                return web.json_response({"error": "invalid_subscription"}, status=400)
            return web.json_response({"ok": True, "subscriptions": _mobile_web_push.subscription_count()})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_unsubscribe(request):
        try:
            body = await request.json()
            endpoint = body.get("endpoint") if isinstance(body, dict) else None
            removed = _mobile_web_push.remove_subscription(endpoint)
            return web.json_response({"ok": True, "removed": removed})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_test(request):
        """Send a test notification to all subscriptions — used by the UI's
        'send test' button to confirm the whole pipeline works."""
        try:
            if not _mobile_web_push.is_available():
                return web.json_response({"error": "push_unavailable"}, status=503)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _mobile_web_push.send_test)
            return web.json_response(result)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # --- App push targets (native app pairs automatically via these) ---
    # The pairing write endpoints accept an arbitrary https URL that this
    # server then POSTs completion events to — an SSRF/exfiltration surface
    # with zero legitimate callers until the native app ships. Off by
    # default; app developers/testers opt in with COMFYUI_MOBILE_APP_PUSH=1.
    _app_push_pairing_enabled = os.environ.get(
        "COMFYUI_MOBILE_APP_PUSH", ""
    ).strip().lower() in ("1", "true", "yes", "on")

    async def api_push_app_targets_get(request):
        # Gated with the writes: this lists the registered relay URLs and pairing
        # state. With the feature off there is no legitimate caller, and leaving
        # a read open discloses exactly what the write gate exists to protect.
        if not _app_push_pairing_enabled:
            return web.json_response({"error": "app_push_pairing_disabled"}, status=403)
        try:
            return web.json_response({"targets": _mobile_app_push.list_targets()})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_app_targets_add(request):
        """Called by the native app on pairing — registers a relay + pairing code
        so this server notifies that device on completion."""
        if not _app_push_pairing_enabled:
            return web.json_response({"error": "app_push_pairing_disabled"}, status=403)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return web.json_response({"error": "invalid_body"}, status=400)
            # add_target now verifies the pairing code against the relay
            # (blocking `requests` call) before persisting it — off the
            # event loop, same as the other relay-touching handlers below.
            loop = asyncio.get_running_loop()
            ok = await loop.run_in_executor(
                None,
                _mobile_app_push.add_target,
                body.get("relay_url"),
                body.get("pairing_code"),
                body.get("label"),
                body.get("added"),
                body.get("server_id"),
            )
            if not ok:
                return web.json_response({"error": "invalid_target"}, status=400)
            return web.json_response({"ok": True, "targets": _mobile_app_push.target_count()})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_app_targets_remove(request):
        if not _app_push_pairing_enabled:
            return web.json_response({"error": "app_push_pairing_disabled"}, status=403)
        try:
            body = await request.json()
            removed = _mobile_app_push.remove_target(
                body.get("pairing_code") if isinstance(body, dict) else None,
                body.get("relay_url") if isinstance(body, dict) else None,
            )
            return web.json_response({"ok": True, "removed": removed})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_app_test(request):
        # Gated too: this fires a POST at every configured relay, which is the
        # outbound request the pairing gate is meant to prevent.
        if not _app_push_pairing_enabled:
            return web.json_response({"error": "app_push_pairing_disabled"}, status=403)
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _mobile_app_push.send_test)
            return web.json_response(result)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_prefs_get(request):
        try:
            return web.json_response(_mobile_push_prefs.get_prefs())
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_prefs_set(request):
        try:
            body = await request.json()
            return web.json_response(_mobile_push_prefs.set_prefs(body))
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_app_prefs_get(request):
        try:
            return web.json_response(_mobile_app_prefs.get_prefs())
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_app_prefs_set(request):
        try:
            body = await request.json()
            return web.json_response(_mobile_app_prefs.set_prefs(body))
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # Register API routes
    mobile_app.router.add_get('/api/push/config', api_push_config)
    mobile_app.router.add_post('/api/push/subscribe', api_push_subscribe)
    mobile_app.router.add_post('/api/push/unsubscribe', api_push_unsubscribe)
    mobile_app.router.add_post('/api/push/test', api_push_test)
    mobile_app.router.add_get('/api/push/app-targets', api_push_app_targets_get)
    mobile_app.router.add_post('/api/push/app-targets', api_push_app_targets_add)
    mobile_app.router.add_post('/api/push/app-targets/remove', api_push_app_targets_remove)
    mobile_app.router.add_post('/api/push/app-test', api_push_app_test)
    mobile_app.router.add_get('/api/push/preferences', api_push_prefs_get)
    mobile_app.router.add_post('/api/push/preferences', api_push_prefs_set)
    mobile_app.router.add_get('/api/preferences', api_app_prefs_get)
    mobile_app.router.add_post('/api/preferences', api_app_prefs_set)
    mobile_app.router.add_get('/api/cpu-stats', api_cpu_stats)
    mobile_app.router.add_get('/api/history-count', api_history_count)
    mobile_app.router.add_get('/api/queue-metadata', api_queue_metadata_get)
    mobile_app.router.add_post('/api/queue-metadata', api_queue_metadata_post)
    mobile_app.router.add_post('/api/queue-metadata/remap', api_queue_metadata_remap)
    mobile_app.router.add_get('/api/files', api_list_files)
    mobile_app.router.add_delete('/api/files', api_delete_file)
    mobile_app.router.add_get('/api/files/state', api_get_file_state)
    mobile_app.router.add_post('/api/files/state', api_set_file_state)
    # Back-compat shims — see api_set_hidden/api_get_file_favorites/
    # api_set_file_favorite above. No client on THIS branch calls them (the
    # unified /api/files/state replaced all three), but v3.1.1's client still
    # does, so they stay until that branch moves over.
    mobile_app.router.add_post('/api/files/hidden', api_set_hidden)
    mobile_app.router.add_get('/api/files/favorites', api_get_file_favorites)
    mobile_app.router.add_post('/api/files/favorites', api_set_file_favorite)
    mobile_app.router.add_post('/api/input-aliases', api_create_input_aliases)
    mobile_app.router.add_post('/api/input-aliases/resolve', api_resolve_input_aliases)
    mobile_app.router.add_post('/api/file-prefix-aliases', api_create_file_prefix_aliases)
    mobile_app.router.add_post('/api/file-prefix-aliases/resolve', api_resolve_file_prefix_aliases)
    mobile_app.router.add_get('/api/thumbnail', api_get_thumbnail)
    mobile_app.router.add_get('/api/preview', api_get_preview)
    mobile_app.router.add_get('/api/video/playable', api_get_playable_video)
    mobile_app.router.add_get('/api/file-metadata', api_file_metadata)
    mobile_app.router.add_post('/api/file-dimensions', api_file_dimensions)
    mobile_app.router.add_get('/api/workflow-availability', api_workflow_availability)
    mobile_app.router.add_get('/api/image-metadata', api_image_metadata)
    mobile_app.router.add_post('/api/files/move', api_move_files)
    mobile_app.router.add_post('/api/files/mkdir', api_mkdir)
    mobile_app.router.add_post('/api/files/rename', api_rename_file)
    mobile_app.router.add_post('/api/workflows/folder', api_create_workflow_folder)
    mobile_app.router.add_delete('/api/workflows/folder', api_delete_workflow_folder)
    mobile_app.router.add_post('/api/files/copy-to-input', api_copy_file_to_input)
    mobile_app.router.add_post('/api/restart', api_restart_server)
    mobile_app.router.add_get('/api/models/health-check', api_models_health)
    mobile_app.router.add_get('/api/models/previews', api_models_preview)
    mobile_app.router.add_get('/api/models/{prefix}/list', api_models_list)
    mobile_app.router.add_post('/api/models/{prefix}/fetch-all-civitai', api_models_fetch_all)
    mobile_app.router.add_get('/api/models/{prefix}/fetch-status', api_models_fetch_status)
    # Handler to serve index.html for SPA routing (non-API routes only)
    async def serve_index(request):
        # Don't serve index.html for API routes. request.path is the full path
        # (e.g. "/mobile/api/..."), so match "/api/" anywhere rather than only at
        # the start — otherwise an unregistered API route falls through to the SPA
        # and returns HTML with a 200, which breaks JSON clients/health probes.
        path = request.path
        if '/api/' in path:
            return web.Response(status=404, text='Not found')
        response = web.FileResponse(os.path.join(DIST_DIR, "index.html"))
        response.headers['Cache-Control'] = 'no-cache'
        return response

    # Serve static assets (must be before catch-all).
    #
    # We don't use web.static here because we want two things ComfyUI's defaults
    # work against: (1) serve a precompressed .br/.gz sibling when the client
    # accepts it — Vite emits a single ~1 MB JS chunk and brotli takes it to
    # ~250 KB on the wire (siblings are generated by scripts/compress-assets.mjs
    # at build time); (2) cache aggressively — asset filenames are content-hashed
    # by Vite, so a new build always yields a new URL, making the bytes safely
    # immutable. ComfyUI's cache middleware stamps `no-cache` on .js/.css via
    # setdefault(), so we must set Cache-Control explicitly here to win.
    ASSETS_DIR = os.path.realpath(os.path.join(DIST_DIR, 'assets'))

    async def serve_asset(request):
        rel = request.match_info.get('path', '')
        full = os.path.realpath(os.path.join(ASSETS_DIR, rel))
        # Reject path traversal outside the assets dir.
        if full != ASSETS_DIR and not full.startswith(ASSETS_DIR + os.sep):
            return web.Response(status=403, text='Forbidden')
        if not os.path.isfile(full):
            return web.Response(status=404, text='Not found')

        # Vary on every response (compressed and uncompressed) so a shared cache
        # never hands an identity-encoded body to a br/gzip client or vice versa.
        headers = {
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Vary': 'Accept-Encoding',
        }
        content_type = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        accept_encoding = request.headers.get('Accept-Encoding', '')

        # Prefer brotli, then gzip, falling back to the raw file. Content-Type is
        # forced from the ORIGINAL filename so the .br/.gz extension doesn't make
        # aiohttp report application/gzip etc.
        for encoding, suffix in (('br', '.br'), ('gzip', '.gz')):
            if encoding in accept_encoding and os.path.isfile(full + suffix):
                response = web.FileResponse(full + suffix, headers=headers)
                response.content_type = content_type
                response.headers['Content-Encoding'] = encoding
                return response

        return web.FileResponse(full, headers=headers)

    mobile_app.router.add_get('/assets/{path:.*}', serve_asset)

    # Serve specific root-level static files that Vite emits to the dist root
    # (PWA manifest, service worker, icons). These need explicit routes: the SPA
    # catch-all below would otherwise return index.html for them. The service
    # worker MUST be served from /mobile/ (not /mobile/assets/) so its scope can
    # cover the whole app, and with no-cache so updates are picked up.
    _ROOT_STATIC_FILES = {
        'sw.js': ('application/javascript', 'no-cache'),
        'manifest.webmanifest': ('application/manifest+json', 'no-cache'),
        'vite.svg': ('image/svg+xml', 'public, max-age=86400'),
        'icon-192.png': ('image/png', 'public, max-age=86400'),
        'icon-512.png': ('image/png', 'public, max-age=86400'),
        'icon-180.png': ('image/png', 'public, max-age=86400'),
        'icon-maskable-512.png': ('image/png', 'public, max-age=86400'),
    }

    async def serve_root_static(request):
        name = os.path.basename(request.path)
        meta = _ROOT_STATIC_FILES.get(name)
        if meta is None:
            return web.Response(status=404, text='Not found')
        full = os.path.join(DIST_DIR, name)
        if not os.path.isfile(full):
            return web.Response(status=404, text='Not found')
        content_type, cache_control = meta
        headers = {'Cache-Control': cache_control}
        if name == 'sw.js':
            headers['Service-Worker-Allowed'] = '/mobile/'
        response = web.FileResponse(full, headers=headers)
        response.content_type = content_type
        return response

    for _name in _ROOT_STATIC_FILES:
        mobile_app.router.add_get('/' + _name, serve_root_static)

    # Serve index.html for root and all non-API routes (SPA)
    mobile_app.router.add_get('/', serve_index)
    mobile_app.router.add_get('/{path:.*}', serve_index)

    # Redirect /mobile to /mobile/
    async def redirect_to_mobile(request):
        raise web.HTTPFound('/mobile/')

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

    server.PromptServer.instance.app.middlewares.append(_object_info_alias_middleware)

    server.PromptServer.instance.app.router.add_get('/mobile', redirect_to_mobile)

    # Mount the sub-application at /mobile
    server.PromptServer.instance.app.add_subapp('/mobile', mobile_app)

    # Server-side completion detection (push-notification spike). Runs on the
    # main app's event loop so it works regardless of any client being connected.
    server.PromptServer.instance.app.on_startup.append(_mobile_push.on_startup)
    server.PromptServer.instance.app.on_cleanup.append(_mobile_push.on_cleanup)

    print(f"[\033[34mMobile Frontend\033[0m] Mobile UI enabled at: \033[34m/mobile\033[0m")

# Execute the setup
setup_mobile_route()

# Required for ComfyUI to recognize this as a custom node, even if it has no logic nodes
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
