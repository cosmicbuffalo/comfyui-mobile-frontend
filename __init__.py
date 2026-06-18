print("[Mobile Frontend] Loading custom node...")
import asyncio
import mimetypes
import os
import shutil
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
_mobile_input_aliases = _import_module('mobile_input_aliases')
_mobile_file_prefix_aliases = _import_module('mobile_file_prefix_aliases')
_mobile_video_thumbs = _import_module('mobile_video_thumbs')
_mobile_image_preview = _import_module('mobile_image_preview')
# Push notifications: native-app delivery via a relay (mobile_app_push) and
# self-hosted web-push (mobile_web_push). mobile_push polls history and fans
# out completions to both sinks; mobile_push_prefs stores the user toggles.
_mobile_push = _import_module('mobile_push')
_mobile_web_push = _import_module('mobile_web_push')
_mobile_app_push = _import_module('mobile_app_push')
_mobile_push_prefs = _import_module('mobile_push_prefs')
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


def _source_base_dir(source, *, allow_temp=False):
    """Resolve the base directory for an asset ``source``.

    Most endpoints only distinguish 'input' from output (anything that isn't
    'input' maps to the output dir), so 'temp' is served from output unless
    ``allow_temp`` is set. The few endpoints that genuinely serve temp assets
    pass ``allow_temp=True`` to get the temp dir.
    """
    if source == 'input':
        return folder_paths.get_input_directory()
    if allow_temp and source == 'temp':
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

    # Create a sub-application for the mobile frontend
    mobile_app = web.Application()

    async def api_list_files(request):
        try:
            query = request.rel_url.query
            source = query.get('source', 'output')
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
                    dirs_only=dirs_only
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

                # Apply manually-hidden state (independent of the dot-prefix hiding
                # already handled inside list_files). Do not prune missing paths
                # here: a listing is a read, and folders can be transiently absent
                # while external tools move/mount/generate them.
                hidden_set = _mobile_hidden_items.get_hidden_paths(HIDDEN_ITEMS_CACHE_PATH, source)

                def _path_is_hidden(rel_path):
                    # Hidden if the path itself or any ancestor is hidden — by a
                    # dot-prefixed segment or by a manual hidden-set entry. This makes
                    # everything nested under a hidden folder render as hidden too.
                    if not rel_path:
                        return False
                    parts = rel_path.split('/')
                    if any(seg.startswith('.') for seg in parts):
                        return True
                    for i in range(1, len(parts) + 1):
                        if '/'.join(parts[:i]) in hidden_set:
                            return True
                    return False

                for r in results:
                    rel = r.get('path', '')
                    # `hiddenSelf`: this exact item is in the hidden set (can be
                    # unhidden directly). `hidden`: effectively hidden for display,
                    # including inheritance from a hidden ancestor.
                    if rel in hidden_set:
                        r['hiddenSelf'] = True
                    if _path_is_hidden(rel):
                        r['hidden'] = True
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
                if os.path.isdir(target_path):
                    shutil.rmtree(target_path)
                else:
                    os.remove(target_path)
                # Clean up any leftover hidden-state trace for this item (and,
                # for a folder, its descendants).
                _mobile_hidden_items.remove_path(HIDDEN_ITEMS_CACHE_PATH, source, filepath)
                return True

            loop = asyncio.get_event_loop()
            deleted = await loop.run_in_executor(None, _delete_target)
            if deleted:
                return web.json_response({"success": True})
            return web.json_response({"error": "File not found"}, status=404)
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
            video_extensions = ['.mp4', '.mov', '.webm', '.mkv']

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
            if ext in ['.mp4', '.mov', '.webm', '.mkv']:
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

            base_dir = _source_base_dir(source, allow_temp=True)
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

    async def api_set_hidden(request):
        try:
            data = await request.json()
            path = data.get('path')
            source = data.get('source', 'output')
            hidden = bool(data.get('hidden'))
            if not path:
                return web.json_response({"error": "No path provided"}, status=400)
            _mobile_hidden_items.set_hidden(HIDDEN_ITEMS_CACHE_PATH, source, path, hidden)
            return web.json_response({"success": True})
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
                    _mobile_hidden_items.rename_path(HIDDEN_ITEMS_CACHE_PATH, asset_source, rel, new_rel)

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
            _mobile_hidden_items.rename_path(HIDDEN_ITEMS_CACHE_PATH, source, path, new_rel)
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
                # shutil.copy2 into a directory path raises IsADirectoryError,
                # which the broad handler below would turn into an opaque 500.
                return web.json_response({"error": "Destination is a directory"}, status=409)

            def _copy_to_input():
                # Always a physical copy (possibly multi-GB video); keep it off
                # the event loop.
                os.makedirs(os.path.dirname(dst_path), exist_ok=True)
                shutil.copy2(src_path, dst_path)

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
            # Optional ?w= downscaled thumbnail for still images — the dropdown
            # rows only need a ~44px preview, so serving the full-res file there is
            # wasteful. Videos and invalid widths fall through to the original; a
            # decode failure also falls back rather than erroring. The day-long
            # client cache means repeat views don't re-render.
            width = _safe_int(request.query.get('w'), 0)
            is_video = path.lower().endswith(('.mp4', '.webm', '.mov', '.mkv'))
            if width > 0 and not is_video:
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

    # Register API routes
    mobile_app.router.add_get('/api/cpu-stats', api_cpu_stats)
    mobile_app.router.add_get('/api/history-count', api_history_count)
    mobile_app.router.add_get('/api/queue-metadata', api_queue_metadata_get)
    mobile_app.router.add_post('/api/queue-metadata', api_queue_metadata_post)
    mobile_app.router.add_post('/api/queue-metadata/remap', api_queue_metadata_remap)
    mobile_app.router.add_get('/api/files', api_list_files)
    mobile_app.router.add_delete('/api/files', api_delete_file)
    mobile_app.router.add_post('/api/files/hidden', api_set_hidden)
    mobile_app.router.add_post('/api/input-aliases', api_create_input_aliases)
    mobile_app.router.add_post('/api/file-prefix-aliases', api_create_file_prefix_aliases)
    mobile_app.router.add_post('/api/file-prefix-aliases/resolve', api_resolve_file_prefix_aliases)
    mobile_app.router.add_get('/api/thumbnail', api_get_thumbnail)
    mobile_app.router.add_get('/api/preview', api_get_preview)
    mobile_app.router.add_get('/api/file-metadata', api_file_metadata)
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
            if subscription is None and isinstance(body, dict) and "endpoint" in body:
                subscription = body
            if not _mobile_web_push.add_subscription(subscription):
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
            result = await loop.run_in_executor(
                None, _mobile_web_push.send_to_all,
                "Test notification", "Push notifications are working \U0001f389", {"test": True},
            )
            return web.json_response(result)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # --- App push targets (native app pairs automatically via these) ---
    async def api_push_app_targets_get(request):
        try:
            return web.json_response({"targets": _mobile_app_push.list_targets()})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_app_targets_add(request):
        """Called by the native app on pairing — registers a relay + pairing code
        so this server notifies that device on completion."""
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return web.json_response({"error": "invalid_body"}, status=400)
            ok = _mobile_app_push.add_target(
                body.get("relay_url"),
                body.get("pairing_code"),
                body.get("label"),
                body.get("added"),
                server_id=body.get("server_id"),
            )
            if not ok:
                return web.json_response({"error": "invalid_target"}, status=400)
            return web.json_response({"ok": True, "targets": _mobile_app_push.target_count()})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_push_app_targets_remove(request):
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

    # Register API routes — these must register before the SPA catchall below,
    # otherwise '/api/push/*' GETs would be swallowed by the index.html fallback.
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

    # Serve index.html for root and all non-API routes (SPA)
    mobile_app.router.add_get('/', serve_index)
    mobile_app.router.add_get('/{path:.*}', serve_index)

    # Redirect /mobile to /mobile/
    async def redirect_to_mobile(request):
        raise web.HTTPFound('/mobile/')

    server.PromptServer.instance.app.router.add_get('/mobile', redirect_to_mobile)

    # Mount the sub-application at /mobile
    server.PromptServer.instance.app.add_subapp('/mobile', mobile_app)

    # Push completion detection runs on the main app's event loop so it works
    # regardless of any client being connected — start/stop with the server.
    server.PromptServer.instance.app.on_startup.append(_mobile_push.on_startup)
    server.PromptServer.instance.app.on_cleanup.append(_mobile_push.on_cleanup)

    print(f"[\033[34mMobile Frontend\033[0m] Mobile UI enabled at: \033[34m/mobile\033[0m")

# Execute the setup
setup_mobile_route()

# Required for ComfyUI to recognize this as a custom node, even if it has no logic nodes
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
