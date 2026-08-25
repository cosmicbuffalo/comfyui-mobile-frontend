"""ComfyUI Mobile Frontend - extension entry point.

The mobile API used to live entirely in this one file; the route handlers
are now split by domain into the ``mobile_routes_*.py`` modules, each
exposing a ``register_routes(mobile_app)`` function. This file keeps the
wiring: it creates the mobile sub-application and its middlewares, installs
the desktop-facing ``/object_info`` remap middleware, mounts everything on
ComfyUI's main app, and registers the shared startup hooks.
"""
print("[Mobile Frontend] Loading custom node...")

import os
import sys
from importlib import import_module as _import_module

# ComfyUI loads custom nodes by file path from an arbitrary directory; make
# sure this directory is importable so the sibling modules below resolve
# by name.
_EXTENSION_DIR = os.path.dirname(os.path.abspath(__file__))
if _EXTENSION_DIR not in sys.path:
    sys.path.insert(0, _EXTENSION_DIR)

# NOTE: the import below is kept deliberately even though this branch does
# not use it - v3.1.1 still routes its favorites through that module, and
# deleting the import here would delete it over there on the next merge
# (git keeps the side that changed).
_mobile_file_favorites = _import_module("mobile_file_favorites")

# ComfyUI always provides the 'server' module; its absence means a bare
# Python environment (e.g. pytest, where conftest.py stubs the ComfyUI-only
# modules and the tests import the domain modules directly). In that case
# there is nothing to wire up, so the entry point must stay a no-op apart
# from the node mappings below — that also keeps this file importable as a
# package __init__ without the ComfyUI runtime present.
try:
    import server
    _COMFYUI_RUNTIME = True
except ModuleNotFoundError:
    _COMFYUI_RUNTIME = False

# Required for ComfyUI to recognize this as a custom node, even if it has no logic nodes
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


def _bootstrap():
    global web, mobile_app, redirect_to_mobile, setup_mobile_route

    import folder_paths
    from aiohttp import web

    import mobile_hidden_items as _mobile_hidden_items
    import mobile_input_aliases as _mobile_input_aliases
    import mobile_file_prefix_aliases as _mobile_file_prefix_aliases
    import mobile_file_state as _mobile_file_state
    from mobile_common import (
        DIST_DIR,
        EXTENSION_DIR,
        FILE_FAVORITES_CACHE_PATH,
        FILE_PREFIX_ALIASES_CACHE_PATH,
        FILE_STATE_CACHE_PATH,
        HIDDEN_ITEMS_CACHE_PATH,
        INPUT_ALIASES_CACHE_PATH,
        LEGACY_FILE_PREFIX_ALIASES_CACHE_PATHS,
        LEGACY_HIDDEN_ITEMS_CACHE_PATHS,
        LEGACY_INPUT_ALIASES_CACHE_PATHS,
    )
    import mobile_object_info
    import mobile_progress_ws as _mobile_progress_ws
    import mobile_push as _mobile_push
    import mobile_latent_shape as _mobile_latent_shape
    import mobile_routes_aliases
    import mobile_routes_files
    import mobile_routes_media
    import mobile_routes_models
    import mobile_routes_push
    import mobile_routes_system
    import mobile_static

    # Compress sizable JSON API responses on the fly. Model listings in
    # particular can be multiple MB of metadata (checkpoints/loras), and
    # shipping that uncompressed to a phone is the single biggest transfer
    # cost in the app; gzip cuts it ~5x. Static assets are served
    # pre-compressed by serve_asset as FileResponses (not web.Response), so
    # they never reach this branch, and any response that already declares
    # a Content-Encoding is left untouched to avoid double-compression.
    # Small bodies are skipped — the CPU isn't worth it.
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

    # Reject malformed JSON request bodies with a clean 400 up front. Every
    # write handler does `await request.json()` inside a broad
    # `except Exception -> 500`, so a truncated/garbage body would
    # otherwise surface as a 500 (wrong status, and noise that hides real
    # server errors). aiohttp caches the raw body bytes, not the parsed
    # result, so the handler's own request.json() parses again — cheap for
    # these small payloads, but not free. Only touches POST/PUT/PATCH
    # requests that declare a JSON content-type.
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


    # Redirect /mobile to /mobile/
    async def redirect_to_mobile(request):
        raise web.HTTPFound('/mobile/')


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

        mobile_routes_files.register_routes(mobile_app)
        mobile_routes_media.register_routes(mobile_app)
        mobile_routes_aliases.register_routes(mobile_app)
        mobile_routes_system.register_routes(mobile_app)
        mobile_routes_models.register_routes(mobile_app)
        mobile_routes_push.register_routes(mobile_app)

        # Live Activity progress channel: push-based, watches the same registry
        # main.py's per-prompt hook already populates and streams changes to
        # connected native-app clients over /mobile/ws/progress.
        mobile_app.router.add_get('/ws/progress', _mobile_progress_ws.api_progress_ws)
        mobile_app.router.add_get('/api/progress-ws/stats', _mobile_progress_ws.api_progress_ws_stats)

        # Static assets and the SPA catch-all must be registered last: the
        # catch-all route would shadow anything added after it.
        mobile_static.register_routes(mobile_app)

        server.PromptServer.instance.app.middlewares.append(
            mobile_object_info._object_info_alias_middleware
        )

        server.PromptServer.instance.app.router.add_get('/mobile', redirect_to_mobile)

        # Mount the sub-application at /mobile
        server.PromptServer.instance.app.add_subapp('/mobile', mobile_app)

        # Server-side completion detection (push-notification spike). Runs on the
        # main app's event loop so it works regardless of any client being connected.
        server.PromptServer.instance.app.on_startup.append(_mobile_push.on_startup)
        server.PromptServer.instance.app.on_cleanup.append(_mobile_push.on_cleanup)

        server.PromptServer.instance.app.on_startup.append(_mobile_progress_ws.on_startup)
        server.PromptServer.instance.app.on_cleanup.append(_mobile_progress_ws.on_cleanup)

        # Latent preview shape hints. Preview frames reach the client as a flat run
        # of N images whether they are a batch of N results or N frames of one
        # animation; this reads the tensor before anything flattens it and says
        # which, so the client can tile the first and animate the second.
        _mobile_latent_shape.install()

        print(f"[\033[34mMobile Frontend\033[0m] Mobile UI enabled at: \033[34m/mobile\033[0m")


    # Execute the setup
    setup_mobile_route()


if _COMFYUI_RUNTIME:
    _bootstrap()
