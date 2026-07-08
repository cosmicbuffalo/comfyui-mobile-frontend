"""Durable favorites for output/input/temp files.

Favorites are keyed by file content, with the path stored as the latest known
location. That lets a favorite follow in-app moves/renames and lets listings
rediscover externally moved files by hash, while avoiding false favorites when a
new generation reuses an old filename.
"""

import hashlib
import os
import threading
from typing import Any

from json_cache_io import atomic_write_json, now_ms as _now_ms

_LOCK = threading.RLock()
_CHUNK_SIZE = 1024 * 1024


def _empty_cache() -> dict[str, Any]:
    return {"version": 1, "updatedAt": _now_ms(), "favorites": {}}


def _normalize_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.replace("\\", "/").strip("/")
    parts = [seg for seg in cleaned.split("/") if seg not in ("", ".")]
    if any(seg == ".." for seg in parts):
        return None
    return "/".join(parts) or None


def _load(cache_path: str) -> dict[str, Any]:
    try:
        import json

        with open(cache_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, OSError, ValueError):
        return _empty_cache()

    raw = data.get("favorites")
    if not isinstance(raw, dict):
        return _empty_cache()

    favorites: dict[str, list[dict[str, Any]]] = {}
    for source, entries in raw.items():
        if not isinstance(source, str) or not isinstance(entries, list):
            continue
        cleaned: list[dict[str, Any]] = []
        seen_hashes: set[str] = set()
        seen_keys: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            path = _normalize_path(entry.get("path"))
            kind = entry.get("kind") if entry.get("kind") in ("file", "dir") else "file"
            sha256 = entry.get("sha256")
            size = entry.get("size")
            mtime_ns = entry.get("mtimeNs")
            if not path:
                continue
            key = f"{kind}:{sha256 if kind == 'file' else path}"
            if key in seen_keys:
                continue
            if kind == "dir":
                cleaned.append({"path": path, "kind": "dir"})
                seen_keys.add(key)
                continue
            if not isinstance(sha256, str) or not sha256 or sha256 in seen_hashes:
                continue
            seen_hashes.add(sha256)
            seen_keys.add(key)
            cleaned.append({
                "path": path,
                "kind": "file",
                "sha256": sha256,
                "size": int(size) if isinstance(size, int) else 0,
                "mtimeNs": int(mtime_ns) if isinstance(mtime_ns, int) else 0,
            })
        if cleaned:
            favorites[source] = cleaned

    updated_at = data.get("updatedAt")
    return {
        "version": 1,
        "updatedAt": updated_at if isinstance(updated_at, int) else _now_ms(),
        "favorites": favorites,
    }


def _save(cache_path: str, cache: dict[str, Any]) -> None:
    cache["updatedAt"] = _now_ms()
    atomic_write_json(cache_path, cache, prefix=".file_favorites.")


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _signature(path: str) -> dict[str, Any]:
    stat = os.stat(path)
    return {
        "size": int(stat.st_size),
        "mtimeNs": int(stat.st_mtime_ns),
        "sha256": _sha256(path),
    }


def _full_path(base_dir: str, rel_path: str) -> str | None:
    normalized = _normalize_path(rel_path)
    if not normalized:
        return None
    base = os.path.abspath(base_dir)
    target = os.path.abspath(os.path.join(base, normalized))
    try:
        if os.path.commonpath([base, target]) != base:
            return None
    except ValueError:
        return None
    return target


def _verified_path(entry: dict[str, Any], base_dir: str) -> str | None:
    path = entry.get("path")
    if not isinstance(path, str):
        return None
    target = _full_path(base_dir, path)
    if target is None:
        return None
    if entry.get("kind") == "dir":
        return path if os.path.isdir(target) else None
    if not os.path.isfile(target):
        return None
    try:
        stat = os.stat(target)
    except OSError:
        return None
    if int(stat.st_size) != entry.get("size"):
        return None
    if int(stat.st_mtime_ns) == entry.get("mtimeNs"):
        return path
    try:
        if _sha256(target) != entry.get("sha256"):
            return None
    except OSError:
        return None
    entry["mtimeNs"] = int(stat.st_mtime_ns)
    return path


def _entry_matches_path(entry: dict[str, Any], full_path: str) -> bool:
    try:
        stat = os.stat(full_path)
    except OSError:
        return False
    if int(stat.st_size) != entry.get("size"):
        return False
    if int(stat.st_mtime_ns) == entry.get("mtimeNs"):
        return True
    try:
        return _sha256(full_path) == entry.get("sha256")
    except OSError:
        return False


def get_favorite_paths(cache_path: str, source: str, base_dir: str) -> list[str]:
    """Return currently verified favorite paths for a source.

    Stale paths are omitted but kept in the cache so a later listing can
    rediscover the same file if it was moved externally.
    """
    changed = False
    with _LOCK:
        cache = _load(cache_path)
        entries = cache["favorites"].get(source, [])
        paths: list[str] = []
        for entry in entries:
            previous_path = entry.get("path")
            previous_mtime_ns = entry.get("mtimeNs")
            verified = _verified_path(entry, base_dir)
            if verified:
                paths.append(verified)
                changed = changed or verified != previous_path or entry.get("mtimeNs") != previous_mtime_ns
        if changed:
            _save(cache_path, cache)
        return paths


def set_favorite(cache_path: str, source: str, base_dir: str, path: str, favorite: bool) -> list[str]:
    normalized = _normalize_path(path)
    if not normalized:
        return get_favorite_paths(cache_path, source, base_dir)

    target = _full_path(base_dir, normalized)
    signature: dict[str, Any] | None = None
    target_is_dir = target is not None and os.path.isdir(target)
    if target is not None and os.path.isfile(target):
        signature = _signature(target)

    with _LOCK:
        cache = _load(cache_path)
        entries = cache["favorites"].get(source, [])
        if favorite:
            if target_is_dir:
                next_entry = {"path": normalized, "kind": "dir"}
                updated = [
                    entry for entry in entries
                    if entry.get("path") != normalized or entry.get("kind") != "dir"
                ]
                updated.append(next_entry)
                cache["favorites"][source] = updated
            elif signature is not None:
                next_entry = {"path": normalized, "kind": "file", **signature}
                replaced = False
                updated: list[dict[str, Any]] = []
                for entry in entries:
                    if entry.get("kind") == "file" and (
                        entry.get("sha256") == signature["sha256"] or entry.get("path") == normalized
                    ):
                        if not replaced:
                            updated.append(next_entry)
                            replaced = True
                        continue
                    updated.append(entry)
                if not replaced:
                    updated.append(next_entry)
                cache["favorites"][source] = updated
            else:
                return get_favorite_paths(cache_path, source, base_dir)
        else:
            updated = [
                entry
                for entry in entries
                if entry.get("path") != normalized
                and (signature is None or entry.get("kind") != "file" or entry.get("sha256") != signature["sha256"])
            ]
            if updated:
                cache["favorites"][source] = updated
            else:
                cache["favorites"].pop(source, None)
        _save(cache_path, cache)

    return get_favorite_paths(cache_path, source, base_dir)


def remove_path(cache_path: str, source: str, path: str) -> None:
    normalized = _normalize_path(path)
    if not normalized:
        return
    prefix = normalized + "/"
    with _LOCK:
        cache = _load(cache_path)
        entries = cache["favorites"].get(source, [])
        kept = [
            entry
            for entry in entries
            if entry.get("path") != normalized and not str(entry.get("path", "")).startswith(prefix)
        ]
        if len(kept) == len(entries):
            return
        if kept:
            cache["favorites"][source] = kept
        else:
            cache["favorites"].pop(source, None)
        _save(cache_path, cache)


def rename_path(cache_path: str, source: str, old_path: str, new_path: str) -> None:
    old = _normalize_path(old_path)
    new = _normalize_path(new_path)
    if not old or not new or old == new:
        return
    prefix = old + "/"
    with _LOCK:
        cache = _load(cache_path)
        entries = cache["favorites"].get(source, [])
        changed = False
        for entry in entries:
            path = entry.get("path")
            if path == old:
                entry["path"] = new
                changed = True
            elif isinstance(path, str) and path.startswith(prefix):
                entry["path"] = new + path[len(old):]
                changed = True
        if changed:
            _save(cache_path, cache)


def mark_favorites(cache_path: str, source: str, base_dir: str, files: list[dict[str, Any]]) -> None:
    """Mark listed files with favorite=True and update moved favorite paths."""
    with _LOCK:
        cache = _load(cache_path)
        entries = cache["favorites"].get(source, [])
        if not entries:
            return

        by_path = {entry.get("path"): entry for entry in entries}
        by_size: dict[int, list[dict[str, Any]]] = {}
        for entry in entries:
            if entry.get("kind") == "dir":
                continue
            size = entry.get("size")
            if isinstance(size, int):
                by_size.setdefault(size, []).append(entry)

        changed = False
        base = os.path.abspath(base_dir)
        for item in files:
            rel = _normalize_path(item.get("path"))
            if not rel:
                continue
            path_entry = by_path.get(rel)
            if item.get("type") == "dir":
                if path_entry and path_entry.get("kind") == "dir":
                    item["favorite"] = True
                continue
            full_path = os.path.abspath(os.path.join(base, rel))
            try:
                if os.path.commonpath([base, full_path]) != base or not os.path.isfile(full_path):
                    continue
                stat = os.stat(full_path)
            except (OSError, ValueError):
                continue

            if path_entry and path_entry.get("kind") == "file" and _entry_matches_path(path_entry, full_path):
                item["favorite"] = True
                if path_entry.get("mtimeNs") != int(stat.st_mtime_ns):
                    path_entry["mtimeNs"] = int(stat.st_mtime_ns)
                    changed = True
                continue

            candidates = by_size.get(int(stat.st_size), [])
            if not candidates:
                continue
            try:
                digest = _sha256(full_path)
            except OSError:
                continue
            match = next((entry for entry in candidates if entry.get("sha256") == digest), None)
            if match is None:
                continue
            item["favorite"] = True
            if match.get("path") != rel or match.get("mtimeNs") != int(stat.st_mtime_ns):
                match["path"] = rel
                match["mtimeNs"] = int(stat.st_mtime_ns)
                changed = True

        if changed:
            _save(cache_path, cache)
