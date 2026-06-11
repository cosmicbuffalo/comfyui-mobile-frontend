"""Stable opaque aliases for output filename_prefix widget values."""

import json
import os
import secrets
import threading
from typing import Any

from json_cache_io import atomic_write_json, now_ms as _now_ms


ALIAS_PREFIX = "mp-"
_LOCK = threading.RLock()


def _empty_cache() -> dict[str, Any]:
    return {"version": 1, "updatedAt": _now_ms(), "aliases": {}}


def _load(cache_path: str) -> dict[str, Any]:
    try:
        with open(cache_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return _empty_cache()
    aliases = data.get("aliases")
    if not isinstance(aliases, dict):
        return _empty_cache()
    return {
        "version": 1,
        "updatedAt": data.get("updatedAt") if isinstance(data.get("updatedAt"), int) else _now_ms(),
        "aliases": aliases,
    }


def _save(cache_path: str, cache: dict[str, Any]) -> None:
    atomic_write_json(cache_path, cache, prefix=".file_prefix_aliases.")


def migrate_legacy_cache(cache_path: str, legacy_paths: list[str]) -> bool:
    """Seed the durable cache from a legacy location once, if it doesn't exist yet.

    Runs only while the destination is absent so a later edit can't be clobbered
    by a stale legacy copy on the next startup.
    """
    with _LOCK:
        if os.path.exists(cache_path):
            return False
        for legacy_path in legacy_paths:
            if not legacy_path or os.path.abspath(legacy_path) == os.path.abspath(cache_path):
                continue
            if os.path.isfile(legacy_path):
                _save(cache_path, _load(legacy_path))
                return True
        return False


def ensure_aliases(cache_path: str, prefixes: list[str]) -> dict[str, str]:
    normalized = []
    for prefix in prefixes:
        if not isinstance(prefix, str) or not prefix:
            raise ValueError("Invalid filename prefix")
        if prefix not in normalized:
            normalized.append(prefix)

    with _LOCK:
        cache = _load(cache_path)
        aliases = cache["aliases"]
        by_prefix = {
            raw: alias
            for alias, raw in aliases.items()
            if isinstance(alias, str) and isinstance(raw, str)
        }
        result: dict[str, str] = {}
        changed = False
        for prefix in normalized:
            if prefix.startswith(ALIAS_PREFIX):
                result[prefix] = prefix
                continue
            existing = by_prefix.get(prefix)
            if existing:
                result[prefix] = existing
                continue
            while True:
                alias = f"{ALIAS_PREFIX}{secrets.token_hex(8)}"
                if alias not in aliases:
                    break
            aliases[alias] = prefix
            by_prefix[prefix] = alias
            result[prefix] = alias
            changed = True
        if changed:
            cache["updatedAt"] = _now_ms()
            _save(cache_path, cache)
        return result


def resolve_aliases(cache_path: str, aliases_to_resolve: list[str]) -> dict[str, str]:
    with _LOCK:
        aliases = _load(cache_path)["aliases"]
    return {
        alias: aliases[alias]
        for alias in aliases_to_resolve
        if isinstance(alias, str) and isinstance(aliases.get(alias), str)
    }
