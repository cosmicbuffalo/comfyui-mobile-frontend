"""System/status routes.

Restart, CPU stats, history count, and queue metadata. Split out of
``__init__.py`` — handler bodies are unchanged.
"""

import asyncio
import os

import server
import mobile_queue_metadata as _mobile_queue_metadata
from aiohttp import web
from mobile_common import QUEUE_METADATA_CACHE_PATH
from restart_utils import build_restart_exec_args

# Matches HIDDEN_WORKFLOW_EXTRA_DATA_KEY in src/utils/workflowHidden.ts.
HIDDEN_WORKFLOW_EXTRA_DATA_KEY = 'mobile_hidden_workflow'

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

def _count_history(history):
    # prompt is ComfyUI's (number, prompt_id, prompt, extra_data, ...) tuple.
    hidden = sum(
        1 for item in history.values()
        if item['prompt'][3].get(HIDDEN_WORKFLOW_EXTRA_DATA_KEY) is True
    )
    return len(history), hidden

async def api_history_count(request):
    # The total number of runs in ComfyUI's in-memory history, and how many of
    # them came from hidden workflows. The frontend pages /history with
    # max_items, so it only knows the loaded count; this returns the real totals
    # without serializing any payloads.
    try:
        prompt_queue = server.PromptServer.instance.prompt_queue
        history = getattr(prompt_queue, 'history', None)
        if history is None:
            return web.json_response({"count": None})
        mutex = getattr(prompt_queue, 'mutex', None)
        if mutex is not None:
            with mutex:
                count, hidden_count = _count_history(history)
        else:
            count, hidden_count = _count_history(history)
        return web.json_response({"count": count, "hidden_count": hidden_count})
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


def register_routes(mobile_app):
    """Register the system/status routes on the mobile sub-app."""
    mobile_app.router.add_get('/api/cpu-stats', api_cpu_stats)
    mobile_app.router.add_get('/api/history-count', api_history_count)
    mobile_app.router.add_get('/api/queue-metadata', api_queue_metadata_get)
    mobile_app.router.add_post('/api/queue-metadata', api_queue_metadata_post)
    mobile_app.router.add_post('/api/queue-metadata/remap', api_queue_metadata_remap)
    mobile_app.router.add_post('/api/restart', api_restart_server)