"""Push & preferences routes.

Web-push (browser notifications), native app push (targets, live-activity,
pairing), capabilities, and per-user prefs. Split out of ``__init__.py`` —
handler bodies are unchanged. ``pywebpush`` stays optional via
``mobile_web_push``.
"""

import asyncio
import functools

from aiohttp import web

import mobile_app_prefs as _mobile_app_prefs
import mobile_app_push as _mobile_app_push
import mobile_auth as _mobile_auth
import mobile_capabilities as _mobile_capabilities
import mobile_telemetry as _mobile_telemetry
import model_metadata as _model_metadata
import mobile_push_prefs as _mobile_push_prefs
import mobile_web_push as _mobile_web_push


def _push_owner():
    """Which account the calling request's push registrations belong to.

    None on a server with no accounts — and that is not a fallback, it is
    the honest answer there: with one user, "everyone's devices" and "this
    person's devices" are the same set, and the push modules read None
    exactly that way.

    Must be called from the handler, on the event loop: the auth ContextVar
    does not propagate into executor threads.

    Raises _UnresolvedViewer when the gate is on but cannot say who is asking.
    That state arrives as the same None, and the push modules read None as
    "every device on the server" -- so returning it would list, buzz and delete
    other accounts' registrations. Callers turn this into a 503 instead.
    """
    if _mobile_auth.viewer_unresolved():
        raise _UnresolvedViewer()
    try:
        user = _mobile_auth.current_user()
    except Exception:
        raise _UnresolvedViewer() from None
    return user.get("id") if user else None


class _UnresolvedViewer(Exception):
    """The gate is on and broken; no push request can be scoped safely."""


def _gate_broken_response():
    return web.json_response(
        {"error": "auth_unavailable"}, status=503,
    )


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
            "subscriptions": _mobile_web_push.subscription_count(_push_owner()),
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
        owner = _push_owner()
        if not _mobile_web_push.add_subscription(subscription, locale, owner=owner):
            host = _mobile_web_push.refused_host(subscription)
            if host:
                # The operator is the only one who can fix this, and the log is
                # where they will look, so name the host and the setting.
                print(f"[Mobile Push] refused a subscription to {host}: not a known "
                      f"push service. If this is the browser's real push service, "
                      f"add {host} to COMFYUI_MOBILE_WEB_PUSH_HOSTS and restart ComfyUI.",
                      flush=True)
                return web.json_response(
                    {"error": "endpoint_not_allowed", "host": host}, status=400)
            return web.json_response({"error": "invalid_subscription"}, status=400)
        return web.json_response({"ok": True, "subscriptions": _mobile_web_push.subscription_count(owner)})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_push_unsubscribe(request):
    try:
        body = await request.json()
        endpoint = body.get("endpoint") if isinstance(body, dict) else None
        removed = _mobile_web_push.remove_subscription(endpoint, owner=_push_owner())
        return web.json_response({"ok": True, "removed": removed})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_push_unsubscribe_all(request):
    """Shed every push subscription belonging to the calling account.

    The logout sweep on shared devices. Owner-scoped by construction; with no
    resolvable owner there is nothing safe to sweep (no accounts means no
    logout, and an unresolvable viewer on a gated server must not be able to
    clear anyone's registrations), so the answer is simply zero.
    """
    try:
        owner = _push_owner()
        if owner is None:
            return web.json_response({"ok": True, "removed": 0})
        removed = _mobile_web_push.remove_owned_subscriptions(owner)
        return web.json_response({"ok": True, "removed": removed})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_push_test(request):
    """Send a test notification to all subscriptions — used by the UI's
    'send test' button to confirm the whole pipeline works."""
    try:
        if not _mobile_web_push.is_available():
            return web.json_response({"error": "push_unavailable"}, status=503)
        # Resolve the owner here, on the event loop — the auth ContextVar
        # does not propagate into the executor thread.
        owner = _push_owner()
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, functools.partial(_mobile_web_push.send_test, owner=owner))
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
        return web.json_response({"targets": _mobile_app_push.list_targets(_push_owner())})
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
        owner = _push_owner()
        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(
            None,
            functools.partial(
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
                owner=owner,
            ),
        )
        if not ok:
            return web.json_response({"error": "invalid_target"}, status=400)
        return web.json_response({"ok": True, "targets": _mobile_app_push.target_count(owner)})
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
            owner=_push_owner(),
            server_id=body.get("server_id") if isinstance(body, dict) else None,
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
            owner=_push_owner(),
            server_id=body.get("server_id") if isinstance(body, dict) else None,
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
        owner = _push_owner()
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, functools.partial(_mobile_app_push.send_test, owner=owner))
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_push_prefs_get(request):
    try:
        # Resolve the viewer here, on the event loop, and hand it down — the
        # store choice must not depend on a ContextVar surviving any hop.
        viewer = _mobile_auth.current_user()
        return web.json_response(_mobile_push_prefs.get_prefs(viewer=viewer))
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_push_prefs_set(request):
    try:
        body = await request.json()
        # Per-account store: a non-admin's write lands in their own file, so
        # a demo/public account can no longer silence the whole server's
        # completion pushes by flipping the shared preferences.
        viewer = _mobile_auth.current_user()
        return web.json_response(
            _mobile_push_prefs.set_prefs(body, viewer=viewer))
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
        # These preferences are genuinely server-wide (they configure this
        # ComfyUI instance for every client), so unlike the per-account push
        # preferences above the store stays global and the WRITE is gated:
        # an authenticated non-public account (`can_manage_hidden` is the
        # established proxy for that), so a demo/public login cannot flip
        # settings for everyone. Reads stay open — clients need the values
        # to render. Telemetry and CivitAI lookups are narrower still: below,
        # only an admin may change them.
        if not _mobile_auth.can_manage_hidden(_mobile_auth.current_user()):
            return web.json_response({"error": "forbidden"}, status=403)
        # When the environment decides telemetry, the setting is not the
        # operator's to flip from a browser; ignore it rather than store a
        # value that would silently do nothing. Under multiuser it is also
        # server-wide, so only an admin may flip it.
        if isinstance(body, dict) and (_mobile_telemetry.env_override() is not None
                                       or not _mobile_auth.may_change_server_settings()):
            body = {k: v for k, v in body.items() if k != _mobile_telemetry.PREF_KEY}
        if isinstance(body, dict) and (_model_metadata.env_override() is not None
                                       or not _mobile_auth.may_change_server_settings()):
            body = {k: v for k, v in body.items() if k != _model_metadata.PREF_KEY}
        prefs = _mobile_app_prefs.set_prefs(body)
        if not _mobile_telemetry.is_enabled():
            # Off means the install id goes now, not at the next flush.
            _mobile_telemetry.forget()
        return web.json_response(prefs)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_telemetry_status(request):
    """Whether telemetry is on, whether the environment decided that, and
    whether this user is barred from changing it (multiuser, not an admin)."""
    try:
        return web.json_response({
            **_mobile_telemetry.status(),
            "adminOnly": not _mobile_auth.may_change_server_settings(),
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


def _refuse_when_unscopable(handler):
    """Turn an unresolvable viewer into a 503 rather than a scoped-to-everyone
    answer.

    Wrapped at registration rather than inside each handler on purpose: every
    one of them already ends in a broad ``except Exception -> 500``, which
    would swallow _UnresolvedViewer into an opaque error while still, by luck,
    failing closed. Catching it out here keeps that guarantee deliberate and
    reports a status the client can act on.
    """
    async def wrapper(request):
        try:
            return await handler(request)
        except _UnresolvedViewer:
            return _gate_broken_response()
    wrapper.__name__ = getattr(handler, "__name__", "wrapper")
    return wrapper


def register_routes(mobile_app):
    """Register the push & prefs routes on the mobile sub-app."""
    # Register API routes
    mobile_app.router.add_get('/api/capabilities', api_capabilities)
    mobile_app.router.add_get('/api/push/config', _refuse_when_unscopable(api_push_config))
    mobile_app.router.add_post('/api/push/subscribe', _refuse_when_unscopable(api_push_subscribe))
    mobile_app.router.add_post('/api/push/unsubscribe', _refuse_when_unscopable(api_push_unsubscribe))
    mobile_app.router.add_post('/api/push/unsubscribe-all', _refuse_when_unscopable(api_push_unsubscribe_all))
    mobile_app.router.add_post('/api/push/test', _refuse_when_unscopable(api_push_test))
    mobile_app.router.add_get('/api/push/app-targets', _refuse_when_unscopable(api_push_app_targets_get))
    mobile_app.router.add_post('/api/push/app-targets', _refuse_when_unscopable(api_push_app_targets_add))
    mobile_app.router.add_post('/api/push/app-targets/remove', _refuse_when_unscopable(api_push_app_targets_remove))
    mobile_app.router.add_post('/api/push/app-targets/live-activity/remove', _refuse_when_unscopable(api_push_app_live_activity_remove))
    mobile_app.router.add_post('/api/push/app-test', _refuse_when_unscopable(api_push_app_test))
    mobile_app.router.add_get('/api/push/preferences', _refuse_when_unscopable(api_push_prefs_get))
    mobile_app.router.add_post('/api/push/preferences', _refuse_when_unscopable(api_push_prefs_set))
    mobile_app.router.add_get('/api/preferences', _refuse_when_unscopable(api_app_prefs_get))
    mobile_app.router.add_post('/api/preferences', _refuse_when_unscopable(api_app_prefs_set))
    mobile_app.router.add_get('/api/telemetry', _refuse_when_unscopable(api_telemetry_status))

    print(f"[Mobile Frontend] app push pairing {'enabled' if _app_push_pairing_enabled else 'disabled'}")
