"""Input-alias & file-prefix-alias routes, plus copy-to-input.

Split out of ``__init__.py`` — handler bodies are unchanged. The alias
*storage* modules (``mobile_input_aliases``, ``mobile_file_prefix_aliases``)
are unchanged; only the route handlers move.
"""

import asyncio
import os

import folder_paths
import file_utils as _file_utils
from file_utils import safe_join as _safe_join
import mobile_input_aliases as _mobile_input_aliases
import mobile_file_prefix_aliases as _mobile_file_prefix_aliases
from aiohttp import web
from file_utils import link_or_copy
from mobile_common import FILE_PREFIX_ALIASES_CACHE_PATH, INPUT_ALIASES_CACHE_PATH
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


def register_routes(mobile_app):
    """Register the alias routes on the mobile sub-app."""
    mobile_app.router.add_post('/api/input-aliases', api_create_input_aliases)
    mobile_app.router.add_post('/api/input-aliases/resolve', api_resolve_input_aliases)
    mobile_app.router.add_post('/api/file-prefix-aliases', api_create_file_prefix_aliases)
    mobile_app.router.add_post('/api/file-prefix-aliases/resolve', api_resolve_file_prefix_aliases)
    mobile_app.router.add_post('/api/files/copy-to-input', api_copy_file_to_input)