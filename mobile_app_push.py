"""App push targets — notifications delivered to the native app via the relay.

This is the paid/native path, parallel to the self-hosted web push in
mobile_web_push.py. Instead of sending directly to a browser, the node POSTs a
completion event to the push relay (a service the app maker controls), which
holds the APNs key and fans out to the paired devices.

A "target" is one device's pairing identity: {relay_url, pairing_code, label}.
The node stores a list, so one server can notify several devices, and the same
device can be paired with several servers (each server keeps its own list).

Pairing is automatic: when the user adds this server in the app, the app calls
POST /mobile/api/push/app-targets with its relay URL + pairing code — no typing.

Sending is blocking (requests), so callers on the event loop must invoke
send_completion / send_test via run_in_executor.
"""
import json
import os
import threading

import folder_paths

_LOG_PREFIX = "[\033[34mMobile Push\033[0m]"

try:
    import requests  # pulled in by pywebpush; also used widely by ComfyUI
    _REQUESTS_AVAILABLE = True
except Exception:  # pragma: no cover
    _REQUESTS_AVAILABLE = False

_lock = threading.Lock()
_targets = None  # cached list of {relay_url, pairing_code, label, added}


def is_available():
    return _REQUESTS_AVAILABLE


def _push_dir():
    return os.path.join(folder_paths.get_user_directory(), "default", "mobile", "push")


def _targets_path():
    return os.path.join(_push_dir(), "app_targets.json")


def _load_targets():
    global _targets
    if _targets is not None:
        return _targets
    path = _targets_path()
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            _targets = loaded if isinstance(loaded, list) else []
        except Exception as exc:
            print(f"{_LOG_PREFIX} failed to read app targets, starting empty: {exc}", flush=True)
            _targets = []
    else:
        _targets = []
    return _targets


def _save_targets():
    os.makedirs(_push_dir(), exist_ok=True)
    with open(_targets_path(), "w", encoding="utf-8") as f:
        json.dump(_targets, f)


def _valid_relay_url(url) -> bool:
    # Relay must be an https endpoint we POST events to (the app supplies it).
    return isinstance(url, str) and url.startswith("https://") and len(url) < 2048


def list_targets():
    """Return a sanitized view (no full pairing code) for display in the UI."""
    with _lock:
        targets = _load_targets()
        return [
            {
                "label": t.get("label") or "Device",
                "relay_url": t.get("relay_url"),
                # Only the tail of the code, enough to distinguish devices.
                "code_hint": (t.get("pairing_code") or "")[-4:],
                "added": t.get("added"),
            }
            for t in targets
        ]


def target_count() -> int:
    with _lock:
        return len(_load_targets())


def add_target(relay_url, pairing_code, label=None, added=None,
               server_id=None) -> bool:
    if not _valid_relay_url(relay_url):
        return False
    if not isinstance(pairing_code, str) or not pairing_code.strip():
        return False
    pairing_code = pairing_code.strip()
    with _lock:
        targets = _load_targets()
        # Dedupe by (relay_url, pairing_code) so re-pairing updates in place.
        targets = [
            t for t in targets
            if not (t.get("relay_url") == relay_url and t.get("pairing_code") == pairing_code)
        ]
        entry = {
            "relay_url": relay_url,
            "pairing_code": pairing_code,
            "label": (label or "Device") if isinstance(label, str) else "Device",
            "added": added,
        }
        # Carried through to the relay's /event POST so the iOS app can route
        # a notification tap to the right server when several are paired.
        if isinstance(server_id, str) and server_id:
            entry["server_id"] = server_id
        targets.append(entry)
        _targets[:] = targets
        _save_targets()
    return True


def remove_target(pairing_code, relay_url=None) -> int:
    if not isinstance(pairing_code, str) or not pairing_code:
        return 0
    with _lock:
        targets = _load_targets()
        before = len(targets)
        remaining = [
            t for t in targets
            if not (
                t.get("pairing_code") == pairing_code
                and (relay_url is None or t.get("relay_url") == relay_url)
            )
        ]
        removed = before - len(remaining)
        if removed:
            _targets[:] = remaining
            _save_targets()
    return removed


def _post_event(target, payload) -> str:
    """POST one event to a target's relay. Returns 'ok', 'gone', or 'error'."""
    url = target.get("relay_url", "").rstrip("/") + "/event"
    body = dict(payload)
    body["pairing_code"] = target.get("pairing_code")
    # Forward the server_id (if registered) so the relay can include it in the
    # push payload and the app can route the tap.
    server_id = target.get("server_id")
    if server_id:
        body["server_id"] = server_id
    try:
        resp = requests.post(url, json=body, timeout=10)
        if resp.status_code == 200:
            return "ok"
        # Relay reports an unknown/empty pairing — the device unpaired or the
        # pairing expired; safe to forget this target.
        if resp.status_code == 404:
            return "gone"
        print(f"{_LOG_PREFIX} app push relay returned {resp.status_code} for {url}", flush=True)
        return "error"
    except Exception as exc:
        print(f"{_LOG_PREFIX} app push request failed: {exc}", flush=True)
        return "error"


def _send(payload) -> dict:
    if not _REQUESTS_AVAILABLE:
        return {"sent": 0, "pruned": 0, "total": 0}
    with _lock:
        targets = list(_load_targets())
    if not targets:
        return {"sent": 0, "pruned": 0, "total": 0}

    sent = 0
    dead = []
    for target in targets:
        result = _post_event(target, payload)
        if result == "ok":
            sent += 1
        elif result == "gone":
            dead.append((target.get("relay_url"), target.get("pairing_code")))

    if dead:
        with _lock:
            current = _load_targets()
            remaining = [
                t for t in current
                if (t.get("relay_url"), t.get("pairing_code")) not in dead
            ]
            _targets[:] = remaining
            _save_targets()

    return {"sent": sent, "pruned": len(dead), "total": len(targets)}


def send_completion(prompt_id: str, status: str, outputs: int,
                    image_url: str = None, click_url: str = None) -> dict:
    # The relay formats the notification copy from status/prompt_id, so the node
    # only forwards the facts. image_url is passed through for a future iOS
    # Notification Service Extension (rich media); text-only until then.
    payload = {"prompt_id": prompt_id, "status": status, "outputs": outputs}
    if image_url:
        payload["image"] = image_url
    if click_url:
        payload["url"] = click_url
    return _send(payload)


def send_test() -> dict:
    return _send({
        "status": "test",
        "title": "Test notification",
        "body": "Push notifications are working \U0001f389",
    })
