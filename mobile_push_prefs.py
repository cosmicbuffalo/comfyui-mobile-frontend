"""Notification preferences (shared by web push and app push).

Server-side, per-node settings that gate whether a completion fires a
notification and what it contains. Stored alongside the other push state in
user/default/mobile/push/preferences.json.
"""
import json
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


def get_prefs() -> dict:
    """Return current preferences merged over defaults (so new keys get sane
    values without a migration)."""
    global _prefs
    with _lock:
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
        return dict(_prefs)


def set_prefs(updates) -> dict:
    """Merge updates (only known boolean keys) and persist."""
    global _prefs
    if not isinstance(updates, dict):
        return get_prefs()
    with _lock:
        current = get_prefs()
        for key in _DEFAULTS:
            if key in updates and isinstance(updates[key], bool):
                current[key] = updates[key]
        _prefs = current
        os.makedirs(_push_dir(), exist_ok=True)
        with open(_prefs_path(), "w", encoding="utf-8") as f:
            json.dump(current, f)
        return dict(current)
