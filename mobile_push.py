"""Server-side generation-completion detection (push-notification spike).

The frontend currently only learns a prompt finished via the websocket
`executing(node=null)` message — which means nothing fires if no browser/app is
connected. For push notifications we need detection that runs inside the ComfyUI
process regardless of any client.

This module runs a small background task that watches ComfyUI's in-memory
history (`PromptServer.instance.prompt_queue.history`). An entry only lands there
*after* a prompt completes, so a new key == a finished generation. For now it
just logs each completion; wiring it to the push relay is the next step.

We poll-and-diff rather than hooking ComfyUI's execution internals on purpose:
it's resilient to ComfyUI version churn and needs no patching of core code.
"""
import asyncio

import server

try:
    import mobile_web_push as _mobile_web_push
except Exception:  # pragma: no cover - module should always be importable
    _mobile_web_push = None

try:
    import mobile_app_push as _mobile_app_push
except Exception:  # pragma: no cover - module should always be importable
    _mobile_app_push = None

try:
    import mobile_push_prefs as _mobile_push_prefs
except Exception:  # pragma: no cover - module should always be importable
    _mobile_push_prefs = None

from urllib.parse import urlencode

# How often to scan history. 1s is plenty for "your render is done" — the cost
# is a dict-keys snapshot and a set diff.
_POLL_INTERVAL_SECONDS = 1.0

_LOG_PREFIX = "[\033[34mMobile Push\033[0m]"


def _get_history():
    """Return ComfyUI's history dict, or None if the server isn't ready yet."""
    inst = getattr(server.PromptServer, "instance", None)
    if inst is None:
        return None
    prompt_queue = getattr(inst, "prompt_queue", None)
    if prompt_queue is None:
        return None
    return getattr(prompt_queue, "history", None)


def _extract_status(entry):
    """Best-effort 'success' / 'error' / 'unknown' from a history entry."""
    if not isinstance(entry, dict):
        return "unknown"
    status = entry.get("status")
    if isinstance(status, dict):
        status_str = status.get("status_str")
        if status_str:
            return status_str
        if status.get("completed") is True:
            return "success"
    return "unknown"


# History output nodes carry media under these keys; count the items, not the
# nodes (a workflow can have several preview/save/text nodes for one result).
_MEDIA_KEYS = ("images", "gifs", "videos", "video", "audio")


def _count_outputs(entry):
    """Count produced media items across all output nodes — NOT the number of
    output-producing nodes, which over-counts (e.g. 7 nodes for 1 saved image)."""
    if not isinstance(entry, dict):
        return 0
    outputs = entry.get("outputs")
    if not isinstance(outputs, dict):
        return 0
    count = 0
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        for key in _MEDIA_KEYS:
            value = node_output.get(key)
            if isinstance(value, list):
                count += len(value)
    return count


def _first_output_image(entry):
    """Return a thumbnail URL for the first output image, or None.

    History output images are {filename, subfolder, type}; the mobile thumbnail
    endpoint takes filename/subfolder/source (source == the image 'type').
    """
    if not isinstance(entry, dict):
        return None
    outputs = entry.get("outputs")
    if not isinstance(outputs, dict):
        return None
    for node_output in outputs.values():
        images = node_output.get("images") if isinstance(node_output, dict) else None
        if not images:
            continue
        first = images[0]
        if not isinstance(first, dict) or not first.get("filename"):
            continue
        image_type = first.get("type", "output")
        source = image_type if image_type in ("output", "input", "temp") else "output"
        query = urlencode({
            "filename": first.get("filename"),
            "subfolder": first.get("subfolder", ""),
            "source": source,
        })
        return f"/mobile/api/thumbnail?{query}"
    return None


async def _handle_completion(prompt_id, entry):
    """A generation just finished: log it, then fan out a web-push notification.

    pywebpush is blocking, so the actual send runs in the default executor to keep
    the event loop responsive.
    """
    status = _extract_status(entry)
    outputs = _count_outputs(entry)
    print(
        f"{_LOG_PREFIX} completion detected "
        f"prompt_id={prompt_id} status={status} outputs={outputs}",
        flush=True,
    )

    prefs = _mobile_push_prefs.get_prefs() if _mobile_push_prefs is not None else {}
    is_error = status == "error"
    # Respect the user's notify-on toggles before doing any work.
    if is_error and not prefs.get("notifyOnError", True):
        return
    if not is_error and not prefs.get("notifyOnComplete", True):
        return

    image_url = None
    # Deep-link target: web push uses this for the service-worker's
    # notification-click handler; app push forwards it in the payload so the
    # iOS WebView reload lands on the matching queue item.
    click_url = f"/mobile/?prompt_id={prompt_id}"
    if prefs.get("includeThumbnail", False):
        image_url = _first_output_image(entry)

    loop = asyncio.get_event_loop()

    # Web push (self-hosted, free tier) and app push (relay, native app) are
    # independent sinks — fire both; either may have zero recipients.
    if _mobile_web_push is not None and _mobile_web_push.is_available():
        try:
            result = await loop.run_in_executor(
                None, _mobile_web_push.send_completion,
                prompt_id, status, outputs, image_url, click_url,
            )
            if result.get("sent") or result.get("pruned"):
                print(
                    f"{_LOG_PREFIX} web push sent={result['sent']} "
                    f"pruned={result['pruned']} total={result['total']}",
                    flush=True,
                )
        except Exception as exc:
            print(f"{_LOG_PREFIX} web push dispatch error: {exc}", flush=True)

    if _mobile_app_push is not None and _mobile_app_push.is_available():
        try:
            result = await loop.run_in_executor(
                None, _mobile_app_push.send_completion,
                prompt_id, status, outputs, image_url, click_url,
            )
            if result.get("sent") or result.get("pruned"):
                print(
                    f"{_LOG_PREFIX} app push sent={result['sent']} "
                    f"pruned={result['pruned']} total={result['total']}",
                    flush=True,
                )
        except Exception as exc:
            print(f"{_LOG_PREFIX} app push dispatch error: {exc}", flush=True)


async def _poll_loop():
    # Seed `seen` with whatever's already in history on first pass so we don't
    # fire for completions that happened before the server came up.
    seen = set()
    seeded = False
    while True:
        try:
            history = _get_history()
            if history is not None:
                # Snapshot keys: history is mutated from the execution thread.
                keys = list(history.keys())
                if not seeded:
                    seen = set(keys)
                    seeded = True
                    print(
                        f"{_LOG_PREFIX} detection spike active; "
                        f"seeded {len(seen)} prior history entries "
                        f"(polling every {_POLL_INTERVAL_SECONDS}s)",
                        flush=True,
                    )
                else:
                    for prompt_id in keys:
                        if prompt_id not in seen:
                            asyncio.create_task(
                                _handle_completion(prompt_id, history.get(prompt_id))
                            )
                    # Drop ids no longer retained (history is size-capped) so the
                    # set can't grow without bound. prompt_ids are unique, so an
                    # evicted id never legitimately reappears.
                    seen = set(keys)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # never let the spike take down the server
            print(f"{_LOG_PREFIX} poll error: {exc}", flush=True)
        await asyncio.sleep(_POLL_INTERVAL_SECONDS)


async def on_startup(app):
    """aiohttp on_startup hook — launch the poller on the running event loop."""
    if app.get("mobile_push_task") is not None:
        return
    app["mobile_push_task"] = asyncio.create_task(_poll_loop())


async def on_cleanup(app):
    task = app.get("mobile_push_task")
    if task is not None:
        task.cancel()
