"""Media-serving routes.

Thumbnails, previews, direct video playback, image metadata/dimensions, and
workflow availability. Video responses preserve the original bytes; optional
conversion support, if it returns in the future, lives outside this package.
"""

import asyncio
import json
import mimetypes
import os

import server
import folder_paths
import file_utils as _file_utils
from file_utils import safe_join as _safe_join
from mobile_metadata import (
    MetadataPathError,
    extract_prompt_from_metadata,
    extract_workflow_from_metadata,
    resolve_metadata_path,
)
import mobile_image_dimensions as _mobile_image_dimensions
import mobile_image_preview as _mobile_image_preview
import mobile_push as _mobile_push
import mobile_video_metadata as _mobile_video_metadata
import mobile_video_thumbs as _mobile_video_thumbs
from aiohttp import web
from mobile_common import (
    _ASSET_SOURCES,
    _read_pnginfo_metadata,
    _render_image_thumbnail,
    _source_base_dir,
)
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


async def api_video_durations(request):
    """Durations for a batch of videos currently rendered in the file grid."""
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
        durations = await loop.run_in_executor(
            None,
            _mobile_video_metadata.get_durations_for_paths,
            base_dir,
            paths[:512],
        )
        return web.json_response({"durations": durations})
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
        prompt = extract_prompt_from_metadata(metadata)

        if not workflow:
            return web.json_response({"error": "No workflow metadata found"}, status=404)

        return web.json_response({"workflow": workflow, "prompt": prompt})
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

        # Listing clients include the file's cacheToken in this URL, so a
        # reused path gets a new browser entry while scroll-backs for the
        # same file still avoid re-downloading and re-decoding it.
        cache_headers = {'Cache-Control': 'public, max-age=86400'}

        # A video's still is always its own first frame. This used to prefer
        # any image sharing the video's basename (VHS writes one beside each
        # output), but a folder is free to hold an unrelated `clip.png` next
        # to `clip.mp4` -- common in input/ -- and the video then showed that
        # picture until it was played. The decode is CPU-heavy, so it runs off
        # the event loop; the helper caches the frame and dedupes concurrent
        # decodes of the same video.
        if _mobile_video_thumbs.is_video(filename):
            loop = asyncio.get_event_loop()
            rendered = await loop.run_in_executor(
                None, _mobile_video_thumbs.get_or_render_thumbnail, file_path
            )
            if rendered is None:
                return web.Response(status=400, text="No thumbnail image found for video", headers=no_store)
            return web.Response(body=rendered, content_type='image/jpeg', headers=cache_headers)

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
    14-megapixel original. Cached on disk per source-file identity + maxedge;
    the client URL separately carries its per-execution identity."""
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
            # The client includes a per-execution `cb` identity, so repeat
            # views can cache hard without a reused output path inheriting
            # an older run's preview.
            headers={'Cache-Control': 'public, max-age=86400'},
        )
    except Exception:
        return web.Response(status=500, headers=no_store)

async def api_get_playable_video(request):
    """Serve the original video with byte-range support.

    Versions through 3.3.2 remuxed or transcoded incompatible media in a child
    process. Registry release 3.3.3 deliberately contains no process-launching
    conversion path; browsers receive the original bytes and report a playback
    error when they cannot decode them.
    """
    no_store = {'Cache-Control': 'no-store'}
    try:
        filename = request.query.get('filename')
        subfolder = request.query.get('subfolder', '')
        source = request.query.get('type', request.query.get('source', 'output'))

        if not filename:
            return web.Response(status=400, text='filename is required', headers=no_store)
        if source not in _ASSET_SOURCES:
            return web.Response(status=400, text='invalid asset source', headers=no_store)
        if not _mobile_video_thumbs.is_video(filename):
            return web.Response(status=415, text='unsupported video type', headers=no_store)

        base_dir = _source_base_dir(source)
        file_path = _safe_join(base_dir, subfolder, filename)
        if file_path is None:
            return web.Response(status=403, headers=no_store)
        if not os.path.isfile(file_path):
            return web.Response(status=404, headers=no_store)

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
            file_path,
            headers={
                # aiohttp FileResponse implements Range/If-Range and emits
                # ETag/Last-Modified.
                'Cache-Control': cache_control,
                # The response is never converted, so its declared type must
                # follow the original extension rather than promise MP4.
                'Content-Type': mimetypes.guess_type(file_path)[0] or 'video/mp4',
                # Saving straight from the video element (long-press → Save,
                # "Save video as…") otherwise names the file after the last
                # URL path segment — "playable.mp4". Keep the source name.
                'Content-Disposition': _file_utils.content_disposition(filename),
                'X-Mobile-Video-Mode': 'direct',
            },
        )
    except Exception as exc:
        print('[Mobile Frontend] Playable video error: {}'.format(exc))
        return web.Response(status=500, headers=no_store)


def register_routes(mobile_app):
    """Register the media-serving routes on the mobile sub-app."""
    mobile_app.router.add_get('/api/thumbnail', api_get_thumbnail)
    mobile_app.router.add_get('/api/preview', api_get_preview)
    mobile_app.router.add_get('/api/video/playable', api_get_playable_video)
    mobile_app.router.add_get('/api/file-metadata', api_file_metadata)
    mobile_app.router.add_post('/api/file-dimensions', api_file_dimensions)
    mobile_app.router.add_post('/api/video-durations', api_video_durations)
    mobile_app.router.add_get('/api/workflow-availability', api_workflow_availability)
    mobile_app.router.add_get('/api/image-metadata', api_image_metadata)
