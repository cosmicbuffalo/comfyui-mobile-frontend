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
from urllib.parse import urlsplit

import folder_paths
from json_cache_io import atomic_write_json

_LOG_PREFIX = "[\033[34mMobile Push\033[0m]"

try:
    import requests  # pulled in by pywebpush; also used widely by ComfyUI
    _REQUESTS_AVAILABLE = True
except Exception:  # pragma: no cover
    _REQUESTS_AVAILABLE = False

_lock = threading.Lock()
_targets = None  # cached list of {relay_url, pairing_code, label, added}

# App builds use this relay. Self-hosted/development relays must be opted in by
# the ComfyUI administrator as a comma-separated list of HTTPS origins; a web
# client cannot turn this completion-event POST endpoint into arbitrary SSRF.
_OFFICIAL_RELAY_ORIGIN = "https://comfyui-mobile-frontend-push.cosmicbuffalo.workers.dev"
_EXTRA_RELAYS_ENV = "COMFYUI_MOBILE_APP_PUSH_RELAYS"
_PAIRING_ENV = "COMFYUI_MOBILE_APP_PUSH"

# Ceiling on paired devices. See add_target for why this exists.
MAX_TARGETS = 16

_TRUTHY = ("1", "true", "yes", "on")
_FALSEY = ("0", "false", "no", "off")


def pairing_enabled() -> bool:
    """Whether the pairing endpoints accept writes.

    On by default: the relay allowlist means a paired client can only direct
    completion events at an origin the administrator already trusts, so there
    is no reason to require an env var before notifications work.
    Administrators who want it off set the var to a false value — unset and
    blank both mean "never touched it", i.e. the default.

    Threat model (explicit): ComfyUI has no accounts, so any client that can
    reach these endpoints can already queue prompts, read every output via
    /view, and delete files. Registering a pairing lets such a client receive
    completion events (prompt id, status, output count) it could already
    observe directly — nothing more. That is why pairing does not add its own
    user-confirmation step; operators exposing ComfyUI to untrusted clients
    should authenticate at the proxy layer or set the var to 0. Documented in
    CUEFORGE_PRIVACY.md under "Turning it off".
    """
    raw = os.environ.get(_PAIRING_ENV)
    if raw is None:
        return True
    raw = raw.strip().lower()
    if raw in _FALSEY:
        return False
    if raw in _TRUTHY:
        return True
    # Unparseable (including blank) is not a decision — don't read it as one.
    return True


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
    # Atomic: a crash or full disk mid-write would otherwise leave truncated
    # JSON that every later load rejects, silently unpairing every device.
    atomic_write_json(_targets_path(), _targets, prefix=".app_targets.")


def _https_origin(url) -> str | None:
    """Return a canonical HTTPS origin, rejecting credentials and URL paths."""
    if not isinstance(url, str) or not url or url != url.strip() or len(url) >= 2048:
        return None
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme.lower() != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            return None
        port = parsed.port
    except ValueError:
        return None
    host = parsed.hostname.lower()
    # urlsplit strips IPv6 brackets from hostname; restore them in the origin.
    if ":" in host:
        host = f"[{host}]"
    return f"https://{host}{f':{port}' if port not in (None, 443) else ''}"


def _allowed_relay_origins() -> set[str]:
    allowed = {_OFFICIAL_RELAY_ORIGIN}
    for configured in os.environ.get(_EXTRA_RELAYS_ENV, "").split(","):
        origin = _https_origin(configured.strip())
        if origin:
            allowed.add(origin)
    return allowed


def allowed_relay_origins() -> list[str]:
    """Relay origins accepted by this server, for the app capability probe."""
    return sorted(_allowed_relay_origins())


def _normalize_relay_url(url) -> str | None:
    origin = _https_origin(url)
    if origin is None or origin not in _allowed_relay_origins():
        return None
    return origin


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


def _verify_pairing(relay_url: str, pairing_code: str) -> bool:
    """Best-effort check that `pairing_code` is a real, known pairing on
    `relay_url` before this server starts sending it every completion.

    Without this, any non-empty string would be accepted: a typo or garbage
    code self-heals after one wasted POST (the relay's 404 prunes it via
    `_send`), but a code an attacker actually controls — paired with their
    own device via the relay's own /pair flow — would sit there
    indefinitely, and this server would notify them of every completion
    forever. The relay has no dedicated "does this exist" endpoint, so this
    reuses the /event path with a test-style payload — which doubles as the
    pairing-confirmation push a legitimate new pairing wants anyway.

    Fails OPEN on anything other than a definitive rejection — a relay
    hiccup during verification shouldn't block a legitimate pairing the way
    it would if this call itself became a new point of failure. Both 404
    (unknown_pairing) and 400 (invalid_pairing_code — the relay rejects a
    pairing code that doesn't even match its expected shape) are definitive:
    verified live against the production relay, a malformed code comes back
    400, not 404, and both mean this code will never work no matter how
    long it sits in the target list. Calls `requests.post` directly rather
    than going through `_post_event` so it can tell those apart instead of
    collapsing everything non-200 into the same "error" bucket that
    function's regular send-path callers want.
    """
    if not _REQUESTS_AVAILABLE:
        return True
    url = relay_url + "/event"
    body = {
        "pairing_code": pairing_code,
        "status": "test",
        "title": "CueForge paired",
        "body": "This device will be notified when a generation finishes.",
    }
    try:
        resp = requests.post(url, json=body, timeout=10)
    except Exception as exc:
        print(f"{_LOG_PREFIX} pairing verification request failed, allowing: {exc}", flush=True)
        return True
    if resp.status_code in (400, 404):
        return False
    if resp.status_code != 200:
        print(
            f"{_LOG_PREFIX} pairing verification got {resp.status_code} from "
            f"the relay, allowing (not a definitive rejection)",
            flush=True,
        )
    return True


def _without_target(targets, relay_url, pairing_code):
    """Drop any existing entry for this (relay_url, pairing_code), so re-pairing
    a known device updates it in place instead of growing the list."""
    return [
        t for t in targets
        if not (
            _normalize_relay_url(t.get("relay_url")) == relay_url
            and t.get("pairing_code") == pairing_code
        )
    ]


def _refuse_if_full(deduped_targets) -> bool:
    """Cap check on an already-deduped list (so re-pairing a stored device is
    never at capacity). Entries whose relay no longer satisfies the allowlist
    are never POSTed to (_post_event treats them as gone) — they're ghosts
    awaiting pruning, so counting them would let a narrowed allowlist refuse
    every new pairing until some completion happens to prune the old entries."""
    live = sum(
        1 for t in deduped_targets
        if _normalize_relay_url(t.get("relay_url")) is not None
    )
    if live < MAX_TARGETS:
        return False
    print(
        f"{_LOG_PREFIX} refusing to add target: already at the "
        f"{MAX_TARGETS}-device limit",
        flush=True,
    )
    return True


def add_target(relay_url, pairing_code, label=None, added=None,
               server_id=None) -> bool:
    relay_url = _normalize_relay_url(relay_url)
    if relay_url is None:
        return False
    if not isinstance(pairing_code, str) or not pairing_code.strip():
        return False
    pairing_code = pairing_code.strip()

    # Check the cap BEFORE verifying, not after. Every completion POSTs once
    # per target, so an unbounded list turns this server into a relay-hammering
    # amplifier and drags out every finished generation — but _verify_pairing
    # is itself an outbound relay request that delivers a real push to the
    # paired device. Verifying first would leave that traffic uncapped: anyone
    # who can reach this endpoint could spend a relay round-trip (and buzz
    # someone's phone, if they know their code) on every call, even when the
    # add is certain to be refused. Reject rather than evict: silently dropping
    # a working device to make room for a new one is worse than refusing.
    with _lock:
        if _refuse_if_full(_without_target(_load_targets(), relay_url, pairing_code)):
            return False

    if not _verify_pairing(relay_url, pairing_code):
        print(
            f"{_LOG_PREFIX} refusing to add target: relay reports unknown pairing code",
            flush=True,
        )
        return False

    with _lock:
        # Re-check under the lock — the list can have changed while the
        # verification request was in flight.
        targets = _without_target(_load_targets(), relay_url, pairing_code)
        if _refuse_if_full(targets):
            return False
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


def _relay_match_keys(value):
    """Comparison keys for unpairing. Deliberately allowlist-independent: an
    administrator can narrow COMFYUI_MOBILE_APP_PUSH_RELAYS after devices have
    paired, and unpairing only ever removes a push destination, so a relay
    falling off the allowlist must not strand its entries as unremovable.

    Two keys, either may match:
    - the canonical HTTPS origin when the URL parses as one (handles trailing
      slash, case, an explicit :443 — on whichever side has them)
    - the trimmed, case-folded raw spelling, for legacy stored values that
      don't parse as a bare origin (e.g. a path-bearing relay written by a
      release that predates the origin rule)
    The keys are type-tagged so an origin can never equal a raw spelling."""
    keys = set()
    if isinstance(value, str):
        origin = _https_origin(value.strip())
        if origin:
            keys.add(("origin", origin))
        raw = value.strip().rstrip("/").casefold()
        if raw:
            keys.add(("raw", raw))
    return keys


def remove_target(pairing_code, relay_url=None) -> int:
    if not isinstance(pairing_code, str) or not pairing_code:
        return 0
    if relay_url is None:
        request_keys = None  # no relay given: match the code on any relay
    else:
        request_keys = _relay_match_keys(relay_url)
        if not request_keys:
            # A relay WAS given but is unusable (empty string, junk). Matching
            # nothing here is load-bearing: falling through to match-any would
            # turn a malformed request into "unpair this code everywhere".
            return 0

    def matches_relay(stored) -> bool:
        if request_keys is None:
            return True
        return bool(request_keys & _relay_match_keys(stored.get("relay_url")))

    with _lock:
        targets = _load_targets()
        before = len(targets)
        remaining = [
            t for t in targets
            if not (t.get("pairing_code") == pairing_code and matches_relay(t))
        ]
        removed = before - len(remaining)
        if removed:
            _targets[:] = remaining
            _save_targets()
    return removed


def _post_event(target, payload) -> str:
    """POST one event to a target's relay. Returns 'ok', 'gone', or 'error'."""
    relay_url = _normalize_relay_url(target.get("relay_url"))
    if relay_url is None:
        # Prune targets written by older releases if they no longer satisfy the
        # relay allowlist. Most importantly, never POST to them.
        return "gone"
    url = relay_url + "/event"
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
