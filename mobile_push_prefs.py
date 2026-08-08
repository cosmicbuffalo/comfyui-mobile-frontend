"""Notification preferences (shared by web push and app push).

Server-side, per-node settings that gate whether a completion fires a
notification and what it contains. Stored alongside the other push state in
user/default/mobile/push/preferences.json.
"""
import json

from json_cache_io import atomic_write_json
import os
import threading

import folder_paths

_LOG_PREFIX = "[\033[34mMobile Push\033[0m]"

_DEFAULTS = {
    "notifyOnComplete": True,
    "notifyOnError": True,
    # Opt-in: include the output thumbnail in the notification.
    "includeThumbnail": False,
}

_lock = threading.Lock()
_prefs = None


def _push_dir():
    return os.path.join(folder_paths.get_user_directory(), "default", "mobile", "push")


def _prefs_path():
    return os.path.join(_push_dir(), "preferences.json")


def _load_prefs_locked() -> dict:
    """Lazily load + cache preferences merged over defaults. The CALLER MUST
    already hold `_lock` — `threading.Lock` is non-reentrant, so re-acquiring it
    here (as the old get_prefs() did when called from set_prefs) deadlocks the
    thread, freezing the whole server when set_prefs runs on the event loop."""
    global _prefs
    if _prefs is None:
        path = _prefs_path()
        loaded = {}
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
            except Exception as exc:
                print(f"{_LOG_PREFIX} failed to read preferences, using defaults: {exc}", flush=True)
        _prefs = {**_DEFAULTS, **(loaded if isinstance(loaded, dict) else {})}
    return _prefs


def get_prefs() -> dict:
    """Return current preferences merged over defaults (so new keys get sane
    values without a migration)."""
    with _lock:
        return dict(_load_prefs_locked())


def set_prefs(updates) -> dict:
    """Merge updates (only known boolean keys) and persist."""
    global _prefs
    if not isinstance(updates, dict):
        return get_prefs()
    with _lock:
        current = dict(_load_prefs_locked())
        for key in _DEFAULTS:
            if key in updates and isinstance(updates[key], bool):
                current[key] = updates[key]
        # Persist FIRST, then cache. The other order leaves the process serving
        # values that were never saved when the write fails (full or read-only
        # volume): the client sees a 500 while every later read — including the
        # completion-notification gate — reports the new value, silently
        # reverting on restart. Atomic for the same reason its sibling
        # mobile_app_prefs is: a truncated file is rejected by every later load.
        atomic_write_json(_prefs_path(), current, prefix=".preferences.")
        _prefs = current
        return dict(current)
