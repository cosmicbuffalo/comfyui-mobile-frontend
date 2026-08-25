"""Push & preferences routes.

Web-push (browser notifications), native app push (targets, live-activity,
pairing), capabilities, and per-user prefs. Split out of ``__init__.py`` —
handler bodies are unchanged. ``pywebpush`` stays optional via
``mobile_web_push``.
"""

import asyncio
from aiohttp import web

import mobile_app_prefs as _mobile_app_prefs
import mobile_app_push as _mobile_app_push
import mobile_capabilities as _mobile_capabilities
import mobile_push_prefs as _mobile_push_prefs
import mobile_web_push as _mobile_web_push
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
# Pairing is on by default. mobile_app_push refuses any relay outside an
# allowlist (the official relay, plus whatever the admin adds via
# COMFYUI_MOBILE_APP_PUSH_RELAYS), so a paired client can only steer
# completion events at an origin the administrator already trusts, and no
# env var is needed before notifications work. Administrators who want it
# off entirely set COMFYUI_MOBILE_APP_PUSH=0.
_app_push_pairing_enabled = _mobile_app_push.pairing_enabled()

async def api_capabilities(request):
    """Stable native-app compatibility contract.

    The app probes this before requesting notification permission or
    opening the installer, so an installed-but-disabled node is distinct
    from an absent/outdated one.
    """
    try:
        return web.json_response(_mobile_capabilities.build_capabilities(
            app_push_available=_mobile_app_push.is_available(),
            app_push_pairing_enabled=_app_push_pairing_enabled,
            relay_origins=_mobile_app_push.allowed_relay_origins(),
        ))
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

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
            body.get("live_activity"),
            body.get("server_label"),
            body.get("frequent_updates"),
            body.get("relevance_score"),
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
            body.get("notifications_only") if isinstance(body, dict) else False,
        )
        return web.json_response({"ok": True, "removed": removed})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_push_app_live_activity_remove(request):
    if not _app_push_pairing_enabled:
        return web.json_response({"error": "app_push_pairing_disabled"}, status=403)
    try:
        body = await request.json()
        removed = _mobile_app_push.remove_live_activity_target(
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


def register_routes(mobile_app):
    """Register the push & prefs routes on the mobile sub-app."""
    # Register API routes
    mobile_app.router.add_get('/api/capabilities', api_capabilities)
    mobile_app.router.add_get('/api/push/config', api_push_config)
    mobile_app.router.add_post('/api/push/subscribe', api_push_subscribe)
    mobile_app.router.add_post('/api/push/unsubscribe', api_push_unsubscribe)
    mobile_app.router.add_post('/api/push/test', api_push_test)
    mobile_app.router.add_get('/api/push/app-targets', api_push_app_targets_get)
    mobile_app.router.add_post('/api/push/app-targets', api_push_app_targets_add)
    mobile_app.router.add_post('/api/push/app-targets/remove', api_push_app_targets_remove)
    mobile_app.router.add_post('/api/push/app-targets/live-activity/remove', api_push_app_live_activity_remove)
    mobile_app.router.add_post('/api/push/app-test', api_push_app_test)
    mobile_app.router.add_get('/api/push/preferences', api_push_prefs_get)
    mobile_app.router.add_post('/api/push/preferences', api_push_prefs_set)
    mobile_app.router.add_get('/api/preferences', api_app_prefs_get)
    mobile_app.router.add_post('/api/preferences', api_app_prefs_set)

    print(f"[Mobile Frontend] app push pairing {'enabled' if _app_push_pairing_enabled else 'disabled'}")
