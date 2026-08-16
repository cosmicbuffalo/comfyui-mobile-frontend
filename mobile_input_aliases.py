"""Stable hard-link aliases for input files used in shared workflow metadata."""

import json
import os
import secrets
import threading
from typing import Any

from json_cache_io import atomic_write_json, now_ms as _now_ms


ALIAS_PREFIX = ".mi-"
_LOCK = threading.RLock()


def _empty_cache() -> dict[str, Any]:
    return {"version": 1, "updatedAt": _now_ms(), "aliases": {}}


def _normalize_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.replace("\\", "/").strip("/")
    parts = [part for part in cleaned.split("/") if part not in ("", ".")]
    if not parts or any(part == ".." for part in parts):
        return None
    return "/".join(parts)


def _resolve_input_path(input_dir: str, relative_path: str) -> str:
    # realpath (not abspath) so a symlink inside the input dir can't resolve to a
    # target outside it and still pass the containment check.
    base = os.path.realpath(input_dir)
    target = os.path.realpath(os.path.join(base, relative_path))
    if os.path.commonpath([base, target]) != base:
        raise ValueError("Input path escapes the input directory")
    return target


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
    atomic_write_json(cache_path, cache, prefix=".input_aliases.")


def _existing_alias_for_source(
    aliases: dict[str, Any],
    input_dir: str,
    source_path: str,
    source_stat: os.stat_result,
) -> str | None:
    for alias, entry in aliases.items():
        if not isinstance(alias, str) or not isinstance(entry, dict):
            continue
        if entry.get("device") != source_stat.st_dev or entry.get("inode") != source_stat.st_ino:
            continue
        alias_path = _resolve_input_path(input_dir, alias)
        try:
            if os.path.isfile(alias_path) and os.path.samefile(source_path, alias_path):
                return alias
        except OSError:
            continue
    return None


def _existing_alias_for_previous_path(
    aliases: dict[str, Any],
    input_dir: str,
    relative_path: str,
) -> str | None:
    for alias, entry in aliases.items():
        if not isinstance(alias, str) or not isinstance(entry, dict):
            continue
        if entry.get("sourcePath") != relative_path:
            continue
        alias_path = _resolve_input_path(input_dir, alias)
        if os.path.isfile(alias_path):
            return alias
    return None


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


def ensure_aliases(cache_path: str, input_dir: str, paths: list[str]) -> dict[str, str]:
    """Return stable hidden hard-link aliases for input-relative file paths."""
    normalized_paths: list[str] = []
    for raw_path in paths:
        normalized = _normalize_path(raw_path)
        if not normalized:
            raise ValueError("Invalid input path")
        if normalized not in normalized_paths:
            normalized_paths.append(normalized)

    with _LOCK:
        cache = _load(cache_path)
        aliases = cache["aliases"]
        result: dict[str, str] = {}
        changed = False
        for relative_path in normalized_paths:
            if "/" not in relative_path and relative_path.startswith(ALIAS_PREFIX):
                result[relative_path] = relative_path
                continue

            source_path = _resolve_input_path(input_dir, relative_path)
            if not os.path.isfile(source_path):
                previous = _existing_alias_for_previous_path(aliases, input_dir, relative_path)
                if previous:
                    result[relative_path] = previous
                    continue
                raise FileNotFoundError(f"Input file not found: {relative_path}")
            source_stat = os.stat(source_path)
            existing = _existing_alias_for_source(aliases, input_dir, source_path, source_stat)
            if existing:
                entry = aliases[existing]
                if entry.get("sourcePath") != relative_path:
                    entry["sourcePath"] = relative_path
                    changed = True
                result[relative_path] = existing
                continue

            extension = os.path.splitext(relative_path)[1].lower()
            while True:
                alias = f"{ALIAS_PREFIX}{secrets.token_hex(8)}{extension}"
                alias_path = _resolve_input_path(input_dir, alias)
                if not os.path.exists(alias_path):
                    break
            try:
                os.link(source_path, alias_path)
            except OSError as error:
                raise OSError(
                    f"Unable to create a hard-link input alias for {relative_path}: {error}"
                ) from error
            aliases[alias] = {
                "sourcePath": relative_path,
                "device": source_stat.st_dev,
                "inode": source_stat.st_ino,
                "createdAt": _now_ms(),
            }
            result[relative_path] = alias
            changed = True

        if changed:
            cache["updatedAt"] = _now_ms()
            _save(cache_path, cache)
        return result


def known_aliases(cache_path: str) -> set[str]:
    """Return every alias name recorded in the cache, whether live or stale."""
    with _LOCK:
        return set(_load(cache_path)["aliases"])


def missing_aliases(cache_path: str, input_dir: str) -> set[str]:
    """Return cached aliases whose hard-link file no longer exists.

    An alias whose original path is gone is still a perfectly usable input (that
    is the point of the hard link), so callers must not treat "cannot resolve"
    as "gone". Only the alias file itself disappearing makes it unusable.
    """
    with _LOCK:
        names = list(_load(cache_path)["aliases"])
    missing: set[str] = set()
    for alias in names:
        if not isinstance(alias, str) or not alias.startswith(ALIAS_PREFIX):
            continue
        try:
            if not os.path.isfile(_resolve_input_path(input_dir, alias)):
                missing.add(alias)
        except (OSError, ValueError):
            missing.add(alias)
    return missing


def resolve_all_aliases(cache_path: str, input_dir: str) -> dict[str, str]:
    """Resolve every live cached alias to its current source path."""
    with _LOCK:
        names = list(_load(cache_path)["aliases"])
    if not names:
        return {}
    return resolve_aliases(cache_path, input_dir, names)


def resolve_aliases(
    cache_path: str,
    input_dir: str,
    aliases_to_resolve: list[str],
) -> dict[str, str]:
    """Resolve live aliases back to their current input-relative source paths.

    An alias can outlive its original path because it is a hard link. Only
    return a source path while both names still exist and refer to the same
    file; otherwise callers should keep using the still-functional alias.
    """
    with _LOCK:
        aliases = _load(cache_path)["aliases"]

    resolved: dict[str, str] = {}
    for alias in aliases_to_resolve:
        if (
            not isinstance(alias, str)
            or "/" in alias
            or "\\" in alias
            or not alias.startswith(ALIAS_PREFIX)
        ):
            continue
        entry = aliases.get(alias)
        if not isinstance(entry, dict):
            continue
        source_path = _normalize_path(entry.get("sourcePath"))
        if not source_path:
            continue
        try:
            alias_path = _resolve_input_path(input_dir, alias)
            source_abs = _resolve_input_path(input_dir, source_path)
            if (
                os.path.isfile(alias_path)
                and os.path.isfile(source_abs)
                and os.path.samefile(alias_path, source_abs)
            ):
                resolved[alias] = source_path
        except (OSError, ValueError):
            continue
    return resolved
