"""Persistence for individually hidden output/input items.

Stores, per source ("output"/"input"), the set of relative paths the user has
manually marked hidden. Paths use the same forward-slash relative form as the
`path` field returned by the file listing API. The cache is a small JSON file
written atomically; all mutations are guarded by a module lock so concurrent
requests can't corrupt it.
"""

import json
import os
import threading
from typing import Any

from json_cache_io import atomic_write_json, now_ms as _now_ms

_LOCK = threading.RLock()


def _empty_cache() -> dict[str, Any]:
    return {"version": 1, "updatedAt": _now_ms(), "hidden": {}}


def _normalize_path(value: Any) -> str | None:
    """Normalize a relative path to forward slashes, no leading/trailing slash.

    Rejects anything containing a `..` segment so a stored entry can never point
    outside the source root.
    """
    if not isinstance(value, str):
        return None
    cleaned = value.replace("\\", "/").strip("/")
    parts = [seg for seg in cleaned.split("/") if seg not in ("", ".")]
    if any(seg == ".." for seg in parts):
        return None
    return "/".join(parts) or None


def _load(cache_path: str) -> dict[str, Any]:
    try:
        with open(cache_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return _empty_cache()

    raw = data.get("hidden")
    if not isinstance(raw, dict):
        return _empty_cache()

    hidden: dict[str, list[str]] = {}
    for source, paths in raw.items():
        if not isinstance(source, str) or not isinstance(paths, list):
            continue
        deduped: list[str] = []
        for entry in paths:
            normalized = _normalize_path(entry)
            if normalized and normalized not in deduped:
                deduped.append(normalized)
        if deduped:
            hidden[source] = deduped

    updated_at = data.get("updatedAt")
    return {
        "version": 1,
        "updatedAt": updated_at if isinstance(updated_at, int) else _now_ms(),
        "hidden": hidden,
    }


def _save(cache_path: str, cache: dict[str, Any]) -> None:
    atomic_write_json(cache_path, cache, prefix=".hidden_items.")


def _commit(cache_path: str, cache: dict[str, Any], source: str, paths: list[str]) -> None:
    if paths:
        cache["hidden"][source] = paths
    else:
        cache["hidden"].pop(source, None)
    cache["updatedAt"] = _now_ms()
    _save(cache_path, cache)


def get_hidden_paths(cache_path: str, source: str) -> set[str]:
    """Return the set of hidden relative paths for a source."""
    with _LOCK:
        cache = _load(cache_path)
    return set(cache["hidden"].get(source, []))


def migrate_legacy_cache(cache_path: str, legacy_paths: list[str]) -> bool:
    """Populate a new durable hidden-items file from legacy cache locations.

    Migration only runs while the destination does not exist. Re-merging legacy
    files on every startup would resurrect paths that the user later unhides.
    """
    with _LOCK:
        if os.path.exists(cache_path):
            return False

        merged = _empty_cache()
        for legacy_path in legacy_paths:
            if not legacy_path or os.path.abspath(legacy_path) == os.path.abspath(cache_path):
                continue
            legacy = _load(legacy_path)
            for source, paths in legacy["hidden"].items():
                target = merged["hidden"].setdefault(source, [])
                for path in paths:
                    if path not in target:
                        target.append(path)

        if not merged["hidden"]:
            return False
        _save(cache_path, merged)
        return True


def set_hidden(cache_path: str, source: str, path: str, hidden: bool) -> None:
    """Mark (hidden=True) or unmark (hidden=False) a single path."""
    normalized = _normalize_path(path)
    if not normalized:
        return
    with _LOCK:
        cache = _load(cache_path)
        paths = cache["hidden"].get(source, [])
        present = normalized in paths
        if hidden and not present:
            paths = [*paths, normalized]
        elif not hidden and present:
            paths = [p for p in paths if p != normalized]
        else:
            return
        _commit(cache_path, cache, source, paths)


def remove_path(cache_path: str, source: str, path: str) -> None:
    """Drop a path and any of its descendants — used when an item is deleted."""
    normalized = _normalize_path(path)
    if not normalized:
        return
    prefix = normalized + "/"
    with _LOCK:
        cache = _load(cache_path)
        paths = cache["hidden"].get(source, [])
        kept = [p for p in paths if p != normalized and not p.startswith(prefix)]
        if len(kept) == len(paths):
            return
        _commit(cache_path, cache, source, kept)


def rename_path(cache_path: str, source: str, old_path: str, new_path: str) -> None:
    """Remap a path (and its descendants) so hidden state follows a rename/move."""
    old = _normalize_path(old_path)
    new = _normalize_path(new_path)
    if not old or not new or old == new:
        return
    prefix = old + "/"
    with _LOCK:
        cache = _load(cache_path)
        paths = cache["hidden"].get(source, [])
        changed = False
        remapped: list[str] = []
        for p in paths:
            if p == old:
                remapped.append(new)
                changed = True
            elif p.startswith(prefix):
                remapped.append(new + p[len(old):])
                changed = True
            else:
                remapped.append(p)
        if not changed:
            return
        deduped: list[str] = []
        for p in remapped:
            if p not in deduped:
                deduped.append(p)
        _commit(cache_path, cache, source, deduped)
