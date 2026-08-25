"""Model-metadata provider routes (Lora Manager-compatible shapes).

``/api/models/health|list|preview|fetch`` for the mobile UI. Split out of
``__init__.py`` — handler bodies are unchanged.
"""

import asyncio
import os

import model_metadata as _model_metadata
import mobile_video_thumbs as _mobile_video_thumbs
from aiohttp import web
from mobile_common import _render_preview_thumbnail, _safe_int
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


def register_routes(mobile_app):
    """Register the model-metadata routes on the mobile sub-app."""
    mobile_app.router.add_get('/api/models/health-check', api_models_health)
    mobile_app.router.add_get('/api/models/previews', api_models_preview)
    mobile_app.router.add_get('/api/models/{prefix}/list', api_models_list)
    mobile_app.router.add_post('/api/models/{prefix}/fetch-all-civitai', api_models_fetch_all)
    mobile_app.router.add_get('/api/models/{prefix}/fetch-status', api_models_fetch_status)