"""Notification preferences (shared by web push and app push).

Server-side settings that gate whether a completion fires a notification and
what it contains. Historically one server-global file; on a multiuser server
that let any signed-in account silence everyone's pushes, so preferences are
now stored per account, keyed like the per-viewer file-state stores
(mobile_common._viewer_file_state_path):

- No accounts (auth off), no resolvable viewer, or an admin: the legacy
  global file, user/default/mobile/push/preferences.json — single-user
  installs keep their existing settings and admins keep the pre-auth back
  catalogue. It doubles as the server's baseline for accounts that never
  personalized.
- Everyone else: a sibling preferences.u_<id>.json holding their own values.

Reads layer defaults <- legacy store <- own store, so an account that never
wrote preferences behaves exactly as the server always has, and a personal
write only diverges that one account.
"""
import json

from json_cache_io import atomic_write_json
import os
import threading

import folder_paths

import mobile_auth as _mobile_auth
from mobile_viewer_scope import is_admin as _is_admin

_LOG_PREFIX = "[\033[34mMobile Push\033[0m]"

_DEFAULTS = {
    "notifyOnComplete": True,
    "notifyOnError": True,
    # Opt-in: include the output thumbnail in the notification.
    "includeThumbnail": False,
}

_lock = threading.Lock()
# path -> raw file contents (dict), lazily loaded. Missing files cache as {}
# so the completion gate isn't a stat-per-notification; set_prefs refreshes
# the entry it writes.
_stores = {}


def _push_dir():
    return os.path.join(folder_paths.get_user_directory(), "default", "mobile", "push")


def _prefs_path():
    """The legacy/global store (also the no-accounts and admin store)."""
    return os.path.join(_push_dir(), "preferences.json")


def _owner_prefs_path(owner):
    """One account's personal store. `owner` is a user id, never a dict."""
    return os.path.join(_push_dir(), f"preferences.u_{owner}.json")


def _viewer_prefs_path(viewer=None):
    """Which store this request reads/writes.

    Mirrors mobile_common._viewer_file_state_path: auth off, no viewer, or an
    admin -> the legacy global file; everyone else -> their own sibling file.
    Must be resolved on the event loop when `viewer` is omitted — the auth
    ContextVar does not survive an executor hop.
    """
    if not _mobile_auth.is_enabled():
        return _prefs_path()
    user = viewer if isinstance(viewer, dict) else _mobile_auth.current_user()
    if not isinstance(user, dict) or user.get("id") is None:
        # Auth is on but the viewer cannot be resolved: a broken gate. Like
        # mobile_common's quarantine store, writes must dead-end somewhere
        # nothing else reads -- never the server-wide legacy file.
        return os.path.join(_push_dir(), "preferences.__unresolved__.json")
    if _is_admin(user):
        return _prefs_path()
    return _owner_prefs_path(user["id"])


def _load_store_locked(path) -> dict:
    """Lazily load + cache one store's raw contents. The CALLER MUST already
    hold `_lock` — `threading.Lock` is non-reentrant, so re-acquiring it here
    would deadlock the thread, freezing the whole server when called from the
    event loop."""
    if path not in _stores:
        loaded = {}
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
            except Exception as exc:
                print(f"{_LOG_PREFIX} failed to read preferences, using defaults: {exc}", flush=True)
        _stores[path] = loaded if isinstance(loaded, dict) else {}
    return _stores[path]


def _effective_locked(path) -> dict:
    """Merged view for one store: defaults <- legacy store <- own store.

    The legacy layer is what keeps behavior continuous: an account that never
    personalized follows the server's pre-existing settings (and an admin —
    whose store IS the legacy file — sees exactly what they always saved),
    while a personal write snapshots the full effective view into the
    account's own file and diverges only that account from then on.
    """
    merged = dict(_DEFAULTS)
    legacy = _prefs_path()
    if path != legacy:
        merged.update(_load_store_locked(legacy))
    merged.update(_load_store_locked(path))
    return merged


def get_prefs(viewer=None) -> dict:
    """The calling viewer's preferences merged over defaults (so new keys get
    sane values without a migration). Resolve the viewer on the event loop."""
    path = _viewer_prefs_path(viewer)
    with _lock:
        return _effective_locked(path)


def set_prefs(updates, viewer=None) -> dict:
    """Merge updates (only known boolean keys) into the viewer's store and
    persist."""
    if not isinstance(updates, dict):
        return get_prefs(viewer)
    path = _viewer_prefs_path(viewer)
    with _lock:
        current = _effective_locked(path)
        for key in _DEFAULTS:
            if key in updates and isinstance(updates[key], bool):
                current[key] = updates[key]
        # Persist FIRST, then cache. The other order leaves the process serving
        # values that were never saved when the write fails (full or read-only
        # volume): the client sees a 500 while every later read — including the
        # completion-notification gate — reports the new value, silently
        # reverting on restart. Atomic for the same reason its sibling
        # mobile_app_prefs is: a truncated file is rejected by every later load.
        atomic_write_json(path, current, prefix=".preferences.")
        _stores[path] = current
        return dict(current)


def prefs_for_owner(owner) -> dict:
    """The prompt OWNER's effective preferences, for the completion gate.

    `owner` is the user id mobile_auth.prompt_owner resolved for the finished
    job, or None for unowned prompts and gate-off servers — those read the
    legacy store, which is exactly the pre-multiuser behavior. An owner who
    never personalized resolves through the legacy layer too, so their pushes
    keep following the server's standing settings; an admin owner writes the
    legacy store and lands on it the same way (their personal file never
    exists).
    """
    path = _prefs_path() if owner is None else _owner_prefs_path(owner)
    with _lock:
        return _effective_locked(path)
