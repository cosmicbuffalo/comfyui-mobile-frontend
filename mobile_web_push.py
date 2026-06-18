"""Web Push (VAPID) for the mobile frontend — browser notifications on a finished
generation, with no relay and no third-party service.

How it works: the browser subscribes via its own vendor push service (Apple's
web.push.apple.com, Google's FCM, etc.) and hands us a subscription. We sign an
encrypted payload with our self-generated VAPID key and POST it directly to that
endpoint (outbound only — ComfyUI need not be internet-reachable). The vendor
wakes the page's service worker, which shows the notification.

State lives under ComfyUI's user-data dir (durable, not a regenerable cache):
  user/default/mobile/push/vapid.json          — our VAPID keypair
  user/default/mobile/push/subscriptions.json  — registered browser subscriptions

Sending is blocking (pywebpush uses requests), so callers on the event loop must
invoke send_completion via run_in_executor.
"""
import base64
import json
import os
import threading

import folder_paths

_LOG_PREFIX = "[\033[34mMobile Push\033[0m]"

# pywebpush / cryptography are optional — if the dep isn't installed the node
# must still load, with the push endpoints reporting themselves unavailable.
try:
    from pywebpush import webpush, WebPushException
    from py_vapid import Vapid01
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    _PUSH_AVAILABLE = True
    _IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - depends on environment
    _PUSH_AVAILABLE = False
    _IMPORT_ERROR = str(exc)

# Contact for the VAPID `sub` claim. Push services want a mailto:/https: here as
# a way to reach the sender; some (Apple) reject a non-FQDN like "localhost".
_VAPID_SUB = "mailto:push@comfyui-mobile-frontend.com"

_lock = threading.Lock()
_vapid = None  # cached {"private_pem": str, "public_key": str, "vapid_obj": Vapid01}
_subscriptions = None  # cached dict: endpoint -> subscription_info


def is_available():
    return _PUSH_AVAILABLE


def import_error():
    return _IMPORT_ERROR


def _push_dir():
    return os.path.join(folder_paths.get_user_directory(), "default", "mobile", "push")


def _vapid_path():
    return os.path.join(_push_dir(), "vapid.json")


def _subscriptions_path():
    return os.path.join(_push_dir(), "subscriptions.json")


def _b64url_nopad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _derive_public_key(private_pem: str) -> str:
    """Return the applicationServerKey: the uncompressed EC point (0x04||X||Y),
    base64url without padding — the exact form PushManager.subscribe expects."""
    private_key = serialization.load_pem_private_key(private_pem.encode("utf-8"), password=None)
    raw = private_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return _b64url_nopad(raw)


def _build_vapid(private_pem: str) -> dict:
    # pywebpush treats a bare PEM *string* as a raw base64 key and fails to parse
    # it — so hand it a Vapid01 object built from the PEM instead.
    return {
        "private_pem": private_pem,
        "public_key": _derive_public_key(private_pem),
        "vapid_obj": Vapid01.from_pem(private_pem.encode("utf-8")),
    }


def _load_or_create_vapid():
    """Load the persisted VAPID keypair, generating + saving one on first use."""
    global _vapid
    if _vapid is not None:
        return _vapid

    path = _vapid_path()
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            _vapid = _build_vapid(data["private_pem"])
            return _vapid
        except Exception as exc:
            print(f"{_LOG_PREFIX} failed to read VAPID key, regenerating: {exc}", flush=True)

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("utf-8")
    os.makedirs(_push_dir(), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"private_pem": private_pem}, f)
    _vapid = _build_vapid(private_pem)
    print(f"{_LOG_PREFIX} generated new VAPID keypair", flush=True)
    return _vapid


def _load_subscriptions():
    global _subscriptions
    if _subscriptions is not None:
        return _subscriptions
    path = _subscriptions_path()
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                _subscriptions = json.load(f)
        except Exception as exc:
            print(f"{_LOG_PREFIX} failed to read subscriptions, starting empty: {exc}", flush=True)
            _subscriptions = {}
    else:
        _subscriptions = {}
    return _subscriptions


def _save_subscriptions():
    os.makedirs(_push_dir(), exist_ok=True)
    with open(_subscriptions_path(), "w", encoding="utf-8") as f:
        json.dump(_subscriptions, f)


def get_public_key() -> str:
    """The applicationServerKey the frontend passes to PushManager.subscribe."""
    with _lock:
        return _load_or_create_vapid()["public_key"]


def subscription_count() -> int:
    with _lock:
        return len(_load_subscriptions())


def _endpoint_of(subscription) -> str:
    if isinstance(subscription, dict):
        endpoint = subscription.get("endpoint")
        if isinstance(endpoint, str) and endpoint.startswith("http"):
            return endpoint
    return ""


def add_subscription(subscription) -> bool:
    """Store a PushSubscription ({endpoint, keys:{p256dh, auth}}). Idempotent —
    keyed by endpoint, so re-subscribing the same browser updates in place."""
    endpoint = _endpoint_of(subscription)
    keys = subscription.get("keys") if isinstance(subscription, dict) else None
    if not endpoint or not isinstance(keys, dict) or "p256dh" not in keys or "auth" not in keys:
        return False
    with _lock:
        subs = _load_subscriptions()
        subs[endpoint] = subscription
        _save_subscriptions()
    return True


def remove_subscription(endpoint: str) -> bool:
    if not isinstance(endpoint, str) or not endpoint:
        return False
    with _lock:
        subs = _load_subscriptions()
        if endpoint in subs:
            del subs[endpoint]
            _save_subscriptions()
            return True
    return False


def _send_one(subscription, payload_json: str, vapid_obj):
    """Send to a single subscription. Returns 'ok', 'gone', or 'error'."""
    try:
        webpush(
            subscription_info=subscription,
            data=payload_json,
            vapid_private_key=vapid_obj,
            vapid_claims={"sub": _VAPID_SUB},
            ttl=600,
        )
        return "ok"
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        # 404/410 mean the subscription is permanently dead (unsubscribed,
        # browser data cleared) — caller should forget it.
        if status in (404, 410):
            return "gone"
        print(f"{_LOG_PREFIX} push send failed (status={status}): {exc}", flush=True)
        return "error"
    except Exception as exc:
        print(f"{_LOG_PREFIX} push send error: {exc}", flush=True)
        return "error"


def send_to_all(title: str, body: str, data=None) -> dict:
    """Blocking — fan a notification out to every subscription, pruning dead ones.
    Call via loop.run_in_executor from async code."""
    if not _PUSH_AVAILABLE:
        return {"sent": 0, "pruned": 0, "total": 0}
    with _lock:
        vapid = _load_or_create_vapid()
        subs = dict(_load_subscriptions())  # snapshot; send outside the lock
    if not subs:
        return {"sent": 0, "pruned": 0, "total": 0}

    payload = {"title": title, "body": body}
    if data:
        payload["data"] = data
    payload_json = json.dumps(payload)

    sent = 0
    dead = []
    for endpoint, subscription in subs.items():
        result = _send_one(subscription, payload_json, vapid["vapid_obj"])
        if result == "ok":
            sent += 1
        elif result == "gone":
            dead.append(endpoint)

    if dead:
        with _lock:
            current = _load_subscriptions()
            for endpoint in dead:
                current.pop(endpoint, None)
            _save_subscriptions()

    return {"sent": sent, "pruned": len(dead), "total": len(subs)}


def send_completion(prompt_id: str, status: str, outputs: int,
                    image_url: str = None, click_url: str = None) -> dict:
    """Build + send the 'generation finished' notification. image_url (optional)
    is shown in the notification; click_url is opened when it's tapped."""
    if status == "error":
        title = "Generation failed"
        body = "A generation errored on your ComfyUI server."
    else:
        title = "Render complete"
        body = f"Your generation finished with {outputs} output(s)." if outputs else "Your generation finished."
    data = {"prompt_id": prompt_id, "status": status}
    if image_url:
        data["image"] = image_url
    if click_url:
        data["url"] = click_url
    return send_to_all(title, body, data=data)
