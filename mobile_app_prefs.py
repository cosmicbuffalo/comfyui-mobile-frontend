"""General mobile-frontend preferences (per ComfyUI server).

Server-side, per-server settings that aren't device-specific — they apply to
every client hitting this ComfyUI instance. Distinct from the push-only
preferences in mobile_push_prefs.py and from the browser-local preferences in
the frontend's generation-settings store.

Stored in user/default/mobile/preferences.json.
"""
import json
import os
import threading

import folder_paths

_LOG_PREFIX = "[\033[34mMobile\033[0m]"

_DEFAULTS = {
    # Opt-in: surface tag autocomplete (powered by the ComfyUI-Autocomplete-Plus
    # custom node) in the mobile prompt editors. Off by default; the frontend
    # also gates this on the node actually being installed.
    "autocompleteEnabled": False,
}

_lock = threading.Lock()
_prefs = None


def _mobile_dir():
    return os.path.join(folder_paths.get_user_directory(), "default", "mobile")


def _prefs_path():
    return os.path.join(_mobile_dir(), "preferences.json")


def _load_prefs_locked() -> dict:
    """Load + cache prefs. Caller MUST already hold _lock (threading.Lock is not
    reentrant, so this never re-acquires it)."""
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
        _prefs = current
        os.makedirs(_mobile_dir(), exist_ok=True)
        with open(_prefs_path(), "w", encoding="utf-8") as f:
            json.dump(current, f)
        return dict(current)
