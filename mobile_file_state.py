"""Unified durable state for favorite/reject/hidden output/input/temp files.

All three states are keyed by file content (a cheap partial hash — see
``content_id``), with the path stored as the latest known location. That lets
state follow an in-app move/rename or an external move, while a new file that
reuses an old name/location never inherits the old state. Folders (which
can't be hashed) are tracked by path instead; only favorite/hidden support
folder entries; reject is file-only.

During the transition away from full-file sha256 (the scheme favorites used
before this module existed), a migrated entry whose file was absent at
migration time keeps a `legacySha256` fallback identity until it is next
seen, at which point it is upgraded in place to a partial `contentId` and the
fallback is dropped. See `migrate_legacy`.
"""

import hashlib
import json
import os
import struct
import threading
from typing import Any

from json_cache_io import atomic_write_json, now_ms as _now_ms

STATES = ("favorite", "reject", "hidden")

_LOCK = threading.RLock()
_FULL_HASH_CHUNK = 1024 * 1024
_PARTIAL_CHUNK = 1024 * 1024
_PARTIAL_THRESHOLD = 2 * _PARTIAL_CHUNK

_STATE_FLAG = {"favorite": "favorite", "reject": "rejected", "hidden": "hiddenSelf"}


def _empty_cache() -> dict[str, Any]:
    return {"version": 3, "updatedAt": _now_ms(), "states": {}, "activity": {}}


def _normalize_path(value: Any) -> str | None:
    """Normalize a relative path to forward slashes, no leading/trailing slash.

    Rejects anything containing a `..` segment so a stored entry can never
    point outside the source root.
    """
    if not isinstance(value, str):
        return None
    cleaned = value.replace("\\", "/").strip("/")
    parts = [seg for seg in cleaned.split("/") if seg not in ("", ".")]
    if any(seg == ".." for seg in parts):
        return None
    return "/".join(parts) or None


def _stat_created_ms(stat: os.stat_result) -> int:
    birthtime = getattr(stat, "st_birthtime", None)
    if isinstance(birthtime, (int, float)) and birthtime > 0:
        return int(birthtime * 1000)
    return int(min(stat.st_mtime, stat.st_ctime) * 1000)


def _clean_activity(raw: Any) -> dict[str, dict[str, dict[str, int]]]:
    cleaned: dict[str, dict[str, dict[str, int]]] = {}
    if not isinstance(raw, dict):
        return cleaned
    for source, entries in raw.items():
        if not isinstance(source, str) or not isinstance(entries, dict):
            continue
        source_entries: dict[str, dict[str, int]] = {}
        for raw_path, raw_entry in entries.items():
            path = _normalize_path(raw_path)
            if not path or not isinstance(raw_entry, dict):
                continue
            entry: dict[str, int] = {}
            for field in ("createdAt", "modifiedAt", "device", "inode"):
                value = raw_entry.get(field)
                if isinstance(value, int) and value >= 0:
                    entry[field] = value
            if isinstance(entry.get("modifiedAt"), int):
                source_entries[path] = entry
        if source_entries:
            cleaned[source] = source_entries
    return cleaned


def _touch_activity(
    cache: dict[str, Any],
    source: str,
    path: str,
    modified_at: int,
    stat: os.stat_result | None = None,
) -> None:
    normalized = _normalize_path(path)
    if not normalized:
        return
    source_activity = cache.setdefault("activity", {}).setdefault(source, {})
    previous = source_activity.get(normalized, {})
    entry = dict(previous) if isinstance(previous, dict) else {}
    entry["modifiedAt"] = max(int(entry.get("modifiedAt", 0)), int(modified_at))
    if stat is not None:
        entry.setdefault("createdAt", _stat_created_ms(stat))
        entry["device"] = int(stat.st_dev)
        entry["inode"] = int(stat.st_ino)
    source_activity[normalized] = entry


def _touch_activity_with_ancestors(
    cache: dict[str, Any],
    source: str,
    base_dir: str,
    path: str,
    modified_at: int,
    stat: os.stat_result | None = None,
) -> None:
    normalized = _normalize_path(path)
    if not normalized:
        return
    _touch_activity(cache, source, normalized, modified_at, stat)
    parts = normalized.split("/")
    for index in range(1, len(parts)):
        ancestor = "/".join(parts[:index])
        ancestor_path = _full_path(base_dir, ancestor)
        try:
            ancestor_stat = os.stat(ancestor_path) if ancestor_path else None
        except OSError:
            ancestor_stat = None
        _touch_activity(cache, source, ancestor, modified_at, ancestor_stat)


def _full_path(base_dir: str | None, rel_path: str) -> str | None:
    if not base_dir:
        return None
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


class FileChangedDuringHash(OSError):
    """Raised when a file changes while its identity is being calculated."""


def _stat_signature(stat: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        int(stat.st_dev),
        int(stat.st_ino),
        int(stat.st_size),
        int(stat.st_mtime_ns),
        int(stat.st_ctime_ns),
    )


def _full_sha256_with_stat(path: str) -> tuple[str, os.stat_result]:
    """Return a full hash and the stable file snapshot it was derived from."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        before = os.fstat(handle.fileno())
        while True:
            chunk = handle.read(_FULL_HASH_CHUNK)
            if not chunk:
                break
            digest.update(chunk)
        after = os.fstat(handle.fileno())
    if _stat_signature(before) != _stat_signature(after):
        raise FileChangedDuringHash(f"File changed while hashing: {path}")
    return digest.hexdigest(), after


def _full_sha256(path: str) -> str:
    """Full-file sha256 — used only for the transitional legacy fallback."""
    digest, _ = _full_sha256_with_stat(path)
    return digest


def _content_id_with_stat(path: str) -> tuple[str, os.stat_result]:
    """Partial content hash: sha256 of size + up to 2 MiB of the file's bytes.

    Files at or under 2 MiB are hashed in full. Larger files are hashed by
    their first and last 1 MiB, with the exact size folded into the digest —
    two different files would need the same byte size *and* first-1MiB *and*
    last-1MiB to collide. The `p1:` prefix tags this as "partial scheme v1" so
    a future scheme change is detectable without a data wipe.
    """
    with open(path, "rb") as handle:
        before = os.fstat(handle.fileno())
        size = before.st_size
        if size <= _PARTIAL_THRESHOLD:
            body = handle.read()
        else:
            head = handle.read(_PARTIAL_CHUNK)
            handle.seek(size - _PARTIAL_CHUNK)
            tail = handle.read(_PARTIAL_CHUNK)
            body = head + tail
        after = os.fstat(handle.fileno())
    if _stat_signature(before) != _stat_signature(after):
        raise FileChangedDuringHash(f"File changed while hashing: {path}")
    digest = hashlib.sha256()
    digest.update(struct.pack("<Q", size))
    digest.update(body)
    return "p1:" + digest.hexdigest(), after


def content_id(path: str) -> str:
    """Return a stable partial content hash, retrying is the caller's job."""
    identity, _ = _content_id_with_stat(path)
    return identity


def _entry_identity(entry: dict[str, Any]) -> tuple[str, Any]:
    cid = entry.get("contentId")
    if isinstance(cid, str) and cid:
        return ("cid", cid)
    legacy = entry.get("legacySha256")
    if isinstance(legacy, str) and legacy:
        return ("legacy", legacy)
    return ("path", entry.get("path"))


def _clean_entries(state: str, raw_entries: list) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    seen: set[tuple[str, Any]] = set()
    for entry in raw_entries:
        if not isinstance(entry, dict):
            continue
        path = _normalize_path(entry.get("path"))
        if not path:
            continue
        raw_kind = entry.get("kind")
        kind = raw_kind if raw_kind in ("file", "dir") else "file"
        if raw_kind == "unknown" and state == "hidden":
            kind = "unknown"
        if kind == "dir":
            if state == "reject":
                continue  # reject is file-only (§13.2)
            key = ("dir", path)
            if key in seen:
                continue
            seen.add(key)
            cleaned.append({"path": path, "kind": "dir"})
            continue

        if kind == "unknown":
            key = ("path", path)
            if key in seen:
                continue
            seen.add(key)
            cleaned.append({"path": path, "kind": "unknown"})
            continue

        content_id_val = entry.get("contentId")
        legacy_sha = entry.get("legacySha256")
        clean_entry: dict[str, Any] = {
            "path": path,
            "kind": "file",
            "size": int(entry["size"]) if isinstance(entry.get("size"), int) else 0,
            "mtimeNs": int(entry["mtimeNs"]) if isinstance(entry.get("mtimeNs"), int) else 0,
        }
        if isinstance(content_id_val, str) and content_id_val:
            clean_entry["contentId"] = content_id_val
        elif isinstance(legacy_sha, str) and legacy_sha:
            clean_entry["legacySha256"] = legacy_sha

        key = _entry_identity(clean_entry)
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(clean_entry)
    return cleaned


def _load(cache_path: str) -> dict[str, Any]:
    try:
        with open(cache_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, OSError, ValueError):
        return _empty_cache()

    raw = data.get("states")
    if not isinstance(raw, dict):
        return _empty_cache()

    states: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for source, by_state in raw.items():
        if not isinstance(source, str) or not isinstance(by_state, dict):
            continue
        cleaned_source: dict[str, list[dict[str, Any]]] = {}
        for state in STATES:
            entries = by_state.get(state)
            if not isinstance(entries, list):
                continue
            cleaned = _clean_entries(state, entries)
            if cleaned:
                cleaned_source[state] = cleaned
        if cleaned_source:
            states[source] = cleaned_source

    updated_at = data.get("updatedAt")
    return {
        "version": 3,
        "updatedAt": updated_at if isinstance(updated_at, int) else _now_ms(),
        "states": states,
        "activity": _clean_activity(data.get("activity")),
    }


def _save(cache_path: str, cache: dict[str, Any]) -> None:
    cache["updatedAt"] = _now_ms()
    atomic_write_json(cache_path, cache, prefix=".file_state.")


def _prune_empty(source_states: dict[str, list]) -> None:
    for state in list(source_states.keys()):
        if not source_states[state]:
            source_states.pop(state, None)


def _verify_entry(entry: dict[str, Any], base_dir: str) -> str | None:
    """Verify (and, if needed, upgrade in place) an entry against disk.

    Only checks the entry's own recorded path — cross-path rediscovery of a
    moved file happens in `annotate_listing`, same division of labor as the
    original favorites module.
    """
    path = entry.get("path")
    if not isinstance(path, str):
        return None
    target = _full_path(base_dir, path)
    if target is None:
        return None
    kind = entry.get("kind")
    if kind == "dir":
        return path if os.path.isdir(target) else None
    if kind == "unknown":
        if os.path.isdir(target):
            entry.clear()
            entry.update({"path": path, "kind": "dir"})
            return path
        if not os.path.isfile(target):
            return None
        try:
            new_content_id, stat = _content_id_with_stat(target)
        except OSError:
            return None
        entry.clear()
        entry.update({
            "path": path,
            "kind": "file",
            "contentId": new_content_id,
            "size": int(stat.st_size),
            "mtimeNs": int(stat.st_mtime_ns),
        })
        return path
    if not os.path.isfile(target):
        return None
    try:
        stat = os.stat(target)
    except OSError:
        return None

    content_id_val = entry.get("contentId")
    legacy_sha = entry.get("legacySha256")

    if isinstance(content_id_val, str) and content_id_val:
        if int(stat.st_size) != entry.get("size"):
            return None
        if int(stat.st_mtime_ns) == entry.get("mtimeNs"):
            return path
        try:
            new_content_id, stable_stat = _content_id_with_stat(target)
            if new_content_id != content_id_val:
                return None
        except OSError:
            return None
        entry["mtimeNs"] = int(stable_stat.st_mtime_ns)
        return path

    if isinstance(legacy_sha, str) and legacy_sha:
        try:
            full_sha, full_stat = _full_sha256_with_stat(target)
            if full_sha != legacy_sha:
                return None
            new_content_id, stable_stat = _content_id_with_stat(target)
            if _stat_signature(full_stat) != _stat_signature(stable_stat):
                return None
        except OSError:
            return None
        # Upgrade: this legacy entry pays the full-hash fallback cost exactly
        # once, then rides the fast contentId path forever after.
        entry["contentId"] = new_content_id
        entry.pop("legacySha256", None)
        entry["size"] = int(stable_stat.st_size)
        entry["mtimeNs"] = int(stable_stat.st_mtime_ns)
        return path

    # Path-only entry (e.g. a hidden mark migrated while its file was absent):
    # nothing to compare against yet, so a file at the exact recorded path is
    # accepted and lazily upgraded to content identity.
    try:
        new_content_id, stable_stat = _content_id_with_stat(target)
    except OSError:
        return None
    entry["contentId"] = new_content_id
    entry["size"] = int(stable_stat.st_size)
    entry["mtimeNs"] = int(stable_stat.st_mtime_ns)
    return path


def _get_verified_states(
    cache_path: str,
    source: str,
    states: tuple[str, ...],
    base_dir: str,
) -> dict[str, list[str]]:
    """Verify state snapshots without holding the module lock while hashing.

    Upgrades are reapplied to a freshly loaded cache only when the entry's
    stable identity and stored signature are unchanged. This preserves a
    concurrent rename (path is never copied back from the snapshot) while
    avoiding clobbering a writer that refreshed or replaced the entry.
    """
    with _LOCK:
        cache = _load(cache_path)
        snapshots = {
            state: [dict(entry) for entry in cache["states"].get(source, {}).get(state, [])]
            for state in states
        }

    return _verify_snapshots(cache_path, source, snapshots, base_dir)


def _verify_snapshots(
    cache_path: str,
    source: str,
    snapshots: dict[str, list[dict[str, Any]]],
    base_dir: str,
) -> dict[str, list[str]]:
    """Verify already-loaded snapshots and write back any identity upgrades.

    Split out so a caller that has just loaded the cache for another reason can
    verify from that same read instead of parsing the state file again.
    """
    states = tuple(snapshots)
    result: dict[str, list[str]] = {}
    updates: dict[str, list[dict[str, Any]]] = {state: [] for state in states}
    for state, entries in snapshots.items():
        paths: list[str] = []
        for entry in entries:
            before = dict(entry)
            identity = _entry_identity(before)
            verified = _verify_entry(entry, base_dir)
            if verified:
                paths.append(verified)
            if entry != before:
                updates[state].append({"identity": identity, "before": before, "after": entry})
        result[state] = paths

    if not any(updates.values()):
        return result

    with _LOCK:
        cache = _load(cache_path)
        source_states = cache["states"].get(source, {})
        changed = False
        for state, state_updates in updates.items():
            if not state_updates:
                continue
            by_identity = {update["identity"]: update for update in state_updates}
            for entry in source_states.get(state, []):
                update = by_identity.get(_entry_identity(entry))
                if update is None:
                    continue
                before = update["before"]
                # A concurrent writer refreshed this identity while verification
                # was in flight. Its newer signature wins.
                if (
                    entry.get("size") != before.get("size")
                    or entry.get("mtimeNs") != before.get("mtimeNs")
                ):
                    continue
                after = update["after"]
                for field in ("kind", "contentId", "size", "mtimeNs"):
                    if field in after and entry.get(field) != after[field]:
                        entry[field] = after[field]
                        changed = True
                if after.get("kind") == "dir":
                    for field in ("contentId", "legacySha256", "size", "mtimeNs"):
                        if field in entry:
                            entry.pop(field, None)
                            changed = True
                if "legacySha256" not in after and "legacySha256" in entry:
                    entry.pop("legacySha256", None)
                    changed = True
        if changed:
            _save(cache_path, cache)

    return result


def get_paths(cache_path: str, source: str, state: str, base_dir: str) -> list[str]:
    """Return currently verified paths for one (source, state).

    Stale paths are omitted but kept in the cache so a later listing can
    rediscover the same file if it was moved externally.
    """
    if state not in STATES:
        return []
    return _get_verified_states(cache_path, source, (state,), base_dir)[state]


def get_hidden_listing_view(
    cache_path: str,
    source: str,
    base_dir: str,
) -> tuple[list[str], set[str]]:
    """Everything a file listing needs about hidden state, from ONE load.

    Returns (verified hidden paths, hidden directory paths). The listing needs
    both together: verified paths pre-filter exact files, while directories
    carry inheritance by path because they can't be hashed. Fetching them as
    two calls parsed the state file twice for one request.

    Directory paths are intersected with the verified set here, which is what
    the caller did by hand — a directory entry is only inheritance-worthy while
    it still resolves.
    """
    with _LOCK:
        cache = _load(cache_path)
        source_states = cache["states"].get(source, {})
        entries = [dict(entry) for entry in source_states.get("hidden", [])]

    # Verification MUTATES the entries it upgrades, so directory identities must
    # be read afterwards: a folder hidden while it was absent is stored as
    # kind="unknown" and only becomes kind="dir" when _verify_entry sees it
    # return. Reading them from the pre-verification snapshot silently dropped
    # that folder's inheritance for one listing.
    verified = _verify_snapshots(cache_path, source, {"hidden": entries}, base_dir)["hidden"]
    dir_paths = {
        entry.get("path")
        for entry in entries
        if entry.get("kind") == "dir" and isinstance(entry.get("path"), str)
    }
    dir_paths.intersection_update(verified)
    return verified, dir_paths


def get_all(cache_path: str, source: str, base_dir: str) -> dict[str, list[str]]:
    """Read all three states at once, for client hydration."""
    return _get_verified_states(cache_path, source, STATES, base_dir)


def get_hidden_paths(cache_path: str, source: str) -> set[str]:
    """Fast, disk-free hidden-directory paths for ancestor inheritance.

    File entries are deliberately excluded: their hidden state must be
    content-verified, otherwise a new file reusing an old hidden path would
    inherit that state before listing annotation can compare its bytes.

    Not the listing path: use :func:`get_hidden_listing_view`, which verifies
    first and so also sees a folder whose entry is still recorded as an
    unknown kind. This raw read is kept for callers that only need the
    already-known directories, and for tests that assert on them directly.
    """
    with _LOCK:
        cache = _load(cache_path)
    return {
        entry.get("path")
        for entry in cache["states"].get(source, {}).get("hidden", [])
        if entry.get("kind") == "dir" and isinstance(entry.get("path"), str)
    }


def _add_entry(
    source_states: dict[str, list],
    state: str,
    path: str,
    is_dir: bool,
    content_id_val: str | None,
    signature: dict[str, Any] | None,
    legacy_sha_val: str | None,
) -> None:
    entries = source_states.get(state, [])
    if is_dir:
        entry = {"path": path, "kind": "dir"}
        updated = [
            e for e in entries
            if not (e.get("path") == path and e.get("kind") in ("dir", "unknown"))
        ]
        updated.append(entry)
    else:
        entry = {"path": path, "kind": "file", "contentId": content_id_val, **(signature or {})}
        replaced = False
        updated = []
        for e in entries:
            same_content = (
                content_id_val is not None
                and e.get("kind") == "file"
                and e.get("contentId") == content_id_val
            )
            same_legacy_content = (
                legacy_sha_val is not None
                and e.get("kind") == "file"
                and e.get("legacySha256") == legacy_sha_val
            )
            path_only_at_same_path = (
                e.get("kind") in ("file", "unknown")
                and e.get("path") == path
                and not e.get("contentId")
                and not e.get("legacySha256")
            )
            if same_content or same_legacy_content or path_only_at_same_path:
                if not replaced:
                    updated.append(entry)
                    replaced = True
                continue
            updated.append(e)
        if not replaced:
            updated.append(entry)
    source_states[state] = updated


def _remove_entry(
    source_states: dict[str, list],
    state: str,
    path: str,
    content_id_val: str | None,
    legacy_sha_val: str | None,
    is_dir: bool,
) -> None:
    entries = source_states.get(state, [])
    if is_dir:
        updated = [
            e for e in entries
            if not (e.get("kind") in ("dir", "unknown") and e.get("path") == path)
        ]
    else:
        updated = []
        for entry in entries:
            same_content = (
                content_id_val is not None
                and entry.get("kind") == "file"
                and entry.get("contentId") == content_id_val
            )
            same_legacy_content = (
                legacy_sha_val is not None
                and entry.get("kind") == "file"
                and entry.get("legacySha256") == legacy_sha_val
            )
            path_only_at_same_path = (
                entry.get("kind") in ("file", "unknown")
                and entry.get("path") == path
                and not entry.get("contentId")
                and not entry.get("legacySha256")
            )
            if same_content or same_legacy_content or path_only_at_same_path:
                continue
            updated.append(entry)
    if updated:
        source_states[state] = updated
    else:
        source_states.pop(state, None)


def set_state(cache_path: str, source: str, state: str, base_dir: str, path: str, value: bool) -> bool:
    """Set (or clear) one state for one path.

    Every call derives the file's identity through the same partial
    `content_id` hash, so marking any file is uniformly fast (<=2MB read)
    regardless of state or file size. Favorite/reject are mutually exclusive:
    setting one clears the other for the same content.
    """
    if state not in STATES:
        return False
    normalized = _normalize_path(path)
    if not normalized:
        return False

    target = _full_path(base_dir, normalized)
    target_is_dir = target is not None and os.path.isdir(target)
    target_is_file = target is not None and os.path.isfile(target)

    if state == "reject" and target_is_dir:
        return False  # reject is file-only; a reject on a dir path is a no-op

    content_id_val: str | None = None
    legacy_sha_val: str | None = None
    signature: dict[str, Any] | None = None
    stable_stat: os.stat_result | None = None
    if target_is_file:
        try:
            content_id_val, stable_stat = _content_id_with_stat(target)
            signature = {
                "size": int(stable_stat.st_size),
                "mtimeNs": int(stable_stat.st_mtime_ns),
            }
        except OSError:
            target_is_file = False

    if target_is_file and signature is not None:
        # Transitional legacy favorites still use a full SHA identity. Only pay
        # that cost when a same-path or same-size candidate could match this
        # file; hashing remains outside the lock.
        with _LOCK:
            snapshot = _load(cache_path)
            source_snapshot = snapshot["states"].get(source, {})
            needs_legacy_hash = any(
                isinstance(entry.get("legacySha256"), str)
                and (
                    entry.get("path") == normalized
                    or entry.get("size") == signature["size"]
                )
                for entries in source_snapshot.values()
                for entry in entries
            )
        if needs_legacy_hash:
            try:
                legacy_sha_val, legacy_stat = _full_sha256_with_stat(target)
            except OSError:
                return False
            if stable_stat is None or _stat_signature(stable_stat) != _stat_signature(legacy_stat):
                return False

    if not target_is_dir and not target_is_file:
        return False  # nothing on disk at this path to mark

    # The path can be replaced after its file descriptor was opened. Verify the
    # path still resolves to the same snapshot immediately before committing so
    # identity and signature can never describe different file versions.
    if target_is_file:
        try:
            current_stat = os.stat(target)
        except OSError:
            return False
        if stable_stat is None or _stat_signature(current_stat) != _stat_signature(stable_stat):
            return False
    elif not os.path.isdir(target):
        return False

    activity_stat = stable_stat
    if activity_stat is None:
        try:
            activity_stat = os.stat(target)
        except OSError:
            return False
    activity_now = _now_ms()

    with _LOCK:
        cache = _load(cache_path)
        source_states = cache["states"].setdefault(source, {})

        if value:
            _add_entry(
                source_states,
                state,
                normalized,
                target_is_dir,
                content_id_val,
                signature,
                legacy_sha_val,
            )
            if state in ("favorite", "reject"):
                other = "reject" if state == "favorite" else "favorite"
                _remove_entry(
                    source_states,
                    other,
                    normalized,
                    content_id_val,
                    legacy_sha_val,
                    target_is_dir,
                )
        else:
            _remove_entry(
                source_states,
                state,
                normalized,
                content_id_val,
                legacy_sha_val,
                target_is_dir,
            )

        _prune_empty(source_states)
        if not source_states:
            cache["states"].pop(source, None)
        _touch_activity_with_ancestors(
            cache,
            source,
            base_dir,
            normalized,
            activity_now,
            activity_stat,
        )
        _save(cache_path, cache)
    return True


def _removal_identity(entry: dict[str, Any]) -> tuple[str, Any]:
    """Stable key used by the two-phase delete cleanup."""
    kind = entry.get("kind")
    if kind in ("dir", "unknown"):
        return (str(kind), entry.get("path"))
    return _entry_identity(entry)


def plan_remove_path(
    cache_path: str,
    source: str,
    base_dir: str,
    path: str,
) -> dict[str, list[dict[str, Any]]]:
    """Snapshot state identities belonging to an item before it is deleted.

    If a tracked file moved externally and a replacement reused its old path,
    the replacement is deleted without erasing the moved original's state.
    """
    normalized = _normalize_path(path)
    if not normalized:
        return {}
    prefix = normalized + "/"
    with _LOCK:
        cache = _load(cache_path)
        snapshots = {
            state: [
                dict(entry)
                for entry in cache["states"].get(source, {}).get(state, [])
                if entry.get("path") == normalized
                or str(entry.get("path", "")).startswith(prefix)
            ]
            for state in STATES
        }

    expected_fields = ("path", "kind", "contentId", "legacySha256", "size", "mtimeNs")
    plan: dict[str, list[dict[str, Any]]] = {}
    for state, entries in snapshots.items():
        planned_entries: list[dict[str, Any]] = []
        for entry in entries:
            entry_path = entry.get("path")
            if not isinstance(entry_path, str):
                continue
            target = _full_path(base_dir, entry_path)
            kind = entry.get("kind")
            if kind == "dir":
                if target and os.path.isdir(target):
                    planned_entries.append({
                        "identity": _removal_identity(entry),
                        "expected": {field: entry.get(field) for field in expected_fields},
                    })
                continue
            if kind == "unknown":
                if target and os.path.exists(target):
                    planned_entries.append({
                        "identity": _removal_identity(entry),
                        "expected": {field: entry.get(field) for field in expected_fields},
                    })
                continue
            if not target or not os.path.isfile(target):
                continue
            try:
                stat = os.stat(target)
                cid = entry.get("contentId")
                legacy = entry.get("legacySha256")
                if isinstance(cid, str) and cid:
                    if int(stat.st_size) != entry.get("size"):
                        continue
                    if (
                        int(stat.st_mtime_ns) == entry.get("mtimeNs")
                        or content_id(target) == cid
                    ):
                        planned_entries.append({
                            "identity": _removal_identity(entry),
                            "expected": {field: entry.get(field) for field in expected_fields},
                        })
                elif isinstance(legacy, str) and legacy:
                    if _full_sha256(target) == legacy:
                        planned_entries.append({
                            "identity": _removal_identity(entry),
                            "expected": {field: entry.get(field) for field in expected_fields},
                        })
                else:
                    planned_entries.append({
                        "identity": _removal_identity(entry),
                        "expected": {field: entry.get(field) for field in expected_fields},
                    })
            except OSError:
                continue
        if planned_entries:
            plan[state] = planned_entries
    return plan


def remove_path(
    cache_path: str,
    source: str,
    path: str,
    removal_plan: dict[str, list[dict[str, Any]]] | None = None,
) -> None:
    """Drop state for a deleted item across all three states.

    API deletes pass an identity-aware plan captured before filesystem removal.
    The path-only fallback remains for explicit administrative cleanup callers.
    """
    normalized = _normalize_path(path)
    if not normalized:
        return
    prefix = normalized + "/"
    with _LOCK:
        cache = _load(cache_path)
        source_states = cache["states"].get(source, {})
        changed = False
        for state in STATES:
            entries = source_states.get(state, [])
            if removal_plan is None:
                kept = [
                    e for e in entries
                    if e.get("path") != normalized and not str(e.get("path", "")).startswith(prefix)
                ]
            else:
                planned = {
                    item["identity"]: item["expected"]
                    for item in removal_plan.get(state, [])
                }
                kept = []
                for entry in entries:
                    expected = planned.get(_removal_identity(entry))
                    if expected is None or any(
                        entry.get(field) != value for field, value in expected.items()
                    ):
                        kept.append(entry)
            if len(kept) != len(entries):
                changed = True
                if kept:
                    source_states[state] = kept
                else:
                    source_states.pop(state, None)
        source_activity = cache.get("activity", {}).get(source, {})
        removed_activity = [
            activity_path
            for activity_path in source_activity
            if activity_path == normalized or activity_path.startswith(prefix)
        ]
        for activity_path in removed_activity:
            source_activity.pop(activity_path, None)
        if removed_activity:
            changed = True
            if not source_activity:
                cache.get("activity", {}).pop(source, None)
        if changed:
            if not source_states:
                cache["states"].pop(source, None)
            _save(cache_path, cache)


def rename_path(
    cache_path: str,
    source: str,
    old_path: str,
    new_path: str,
    base_dir: str | None = None,
) -> None:
    """Remap a path (and descendants) across ALL three states on an in-app
    move/rename, so the fast path (size+mtime, no hash) keeps hitting."""
    old = _normalize_path(old_path)
    new = _normalize_path(new_path)
    if not old or not new or old == new:
        return
    prefix = old + "/"
    activity_now = _now_ms()
    with _LOCK:
        cache = _load(cache_path)
        source_states = cache["states"].get(source, {})
        changed = False
        for state in STATES:
            for entry in source_states.get(state, []):
                entry_path = entry.get("path")
                if entry_path == old:
                    entry["path"] = new
                    changed = True
                elif isinstance(entry_path, str) and entry_path.startswith(prefix):
                    entry["path"] = new + entry_path[len(old):]
                    changed = True
        source_activity = cache.setdefault("activity", {}).setdefault(source, {})
        remapped_activity: dict[str, dict[str, int]] = {}
        for activity_path, activity in list(source_activity.items()):
            if activity_path == old:
                remapped_activity[new] = dict(activity)
                source_activity.pop(activity_path, None)
                changed = True
            elif activity_path.startswith(prefix):
                remapped_activity[new + activity_path[len(old):]] = dict(activity)
                source_activity.pop(activity_path, None)
                changed = True
        source_activity.update(remapped_activity)

        target_stat = None
        if base_dir:
            target = _full_path(base_dir, new)
            try:
                target_stat = os.stat(target) if target else None
            except OSError:
                target_stat = None
            _touch_activity_with_ancestors(
                cache,
                source,
                base_dir,
                new,
                activity_now,
                target_stat,
            )
            # Moving something changes both its former and current parent.
            old_parent = old.rsplit("/", 1)[0] if "/" in old else None
            if old_parent:
                old_parent_path = _full_path(base_dir, old_parent)
                try:
                    old_parent_stat = os.stat(old_parent_path) if old_parent_path else None
                except OSError:
                    old_parent_stat = None
                _touch_activity_with_ancestors(
                    cache,
                    source,
                    base_dir,
                    old_parent,
                    activity_now,
                    old_parent_stat,
                )
            changed = True
        else:
            _touch_activity(cache, source, new, activity_now)
            changed = True
        if changed:
            _save(cache_path, cache)


def _is_hidden_by_prefix(rel_path: str, hidden_set: set) -> bool:
    if not rel_path:
        return False
    parts = rel_path.split("/")
    for i in range(1, len(parts) + 1):
        if "/".join(parts[:i]) in hidden_set:
            return True
    return False


def _listing_update(
    entry: dict[str, Any],
    path: str,
    kind: str,
    size: int | None = None,
    mtime_ns: int | None = None,
    content_id_val: str | None = None,
) -> dict[str, Any]:
    """Build a listing update guarded by the exact cache snapshot observed."""
    expected_fields = ("path", "kind", "contentId", "legacySha256", "size", "mtimeNs")
    return {
        "identity": _entry_identity(entry),
        "expected": {field: entry.get(field) for field in expected_fields},
        "path": path,
        "kind": kind,
        "size": size,
        "mtimeNs": mtime_ns,
        "contentId": content_id_val,
    }


def _entry_is_a_move(candidate: dict[str, Any], rel: str, base_dir: str) -> bool:
    """True when re-pointing ``candidate`` at ``rel`` describes a MOVE.

    Content matching exists so state follows a file that moved or was renamed.
    A byte-identical DUPLICATE is indistinguishable from a move by content
    alone — the difference is whether the entry's own recorded path still holds
    that entry's file. If it does, this match is a twin and must not inherit the
    state: for `reject` that means "Delete Rejected" removing a file the user
    never marked. If it doesn't (gone, or now holding different bytes), the file
    genuinely moved and the entry follows it.

    `_verify_entry` is the module's existing "does this entry still resolve to
    its own file" check, so the two agree by construction.
    """
    recorded = candidate.get("path")
    if not isinstance(recorded, str) or recorded == rel:
        return True
    return _verify_entry(dict(candidate), base_dir) is None


def _apply_activity_dates(
    item: dict[str, Any],
    activity: dict[str, Any] | None,
    stat: os.stat_result,
) -> None:
    if not isinstance(activity, dict):
        return
    device = activity.get("device")
    inode = activity.get("inode")
    if isinstance(device, int) and isinstance(inode, int):
        if device != int(stat.st_dev) or inode != int(stat.st_ino):
            # A different item reused this path; it must not inherit the old
            # item's created/activity timestamps.
            return
    created_at = activity.get("createdAt")
    if isinstance(created_at, int) and created_at > 0:
        item["createdDate"] = created_at
    modified_at = activity.get("modifiedAt")
    if isinstance(modified_at, int) and modified_at > 0:
        item["modifiedDate"] = max(int(item.get("modifiedDate") or 0), modified_at)


def _lookup_and_match(
    rel: str,
    full_path: str,
    stat: os.stat_result,
    by_path_state: dict[str, dict[str, Any]],
    by_size_state: dict[int, list[dict[str, Any]]],
    base_dir: str,
) -> dict[str, Any] | None:
    """Try to match a listed file against one state's tracked entries.

    Returns None on no match, else `{"update": None|{...}}` — `update`
    describes a path/mtime move (and, for a legacy/path-only entry, the
    contentId upgrade) to apply back to the cache under lock.
    """
    size = int(stat.st_size)
    mtime_ns = int(stat.st_mtime_ns)

    own_entry = by_path_state.get(rel)
    if own_entry is not None and own_entry.get("kind") in ("file", "unknown"):
        cid = own_entry.get("contentId")
        if isinstance(cid, str) and cid:
            if int(own_entry.get("size", -1)) == size:
                if int(own_entry.get("mtimeNs", -1)) == mtime_ns:
                    return {"update": None}
                try:
                    if content_id(full_path) == cid:
                        return {
                            "update": _listing_update(
                                own_entry, rel, "file", size, mtime_ns, None,
                            )
                        }
                except OSError:
                    pass
        else:
            legacy = own_entry.get("legacySha256")
            if isinstance(legacy, str) and legacy:
                try:
                    if _full_sha256(full_path) == legacy:
                        return {
                            "update": _listing_update(
                                own_entry,
                                rel,
                                "file",
                                size,
                                mtime_ns,
                                content_id(full_path),
                            )
                        }
                except OSError:
                    pass
            else:
                try:
                    new_cid = content_id(full_path)
                except OSError:
                    return None
                return {
                    "update": _listing_update(
                        own_entry, rel, "file", size, mtime_ns, new_cid,
                    )
                }

    # Own path didn't match (or wasn't tracked) — try size-bucketed
    # rediscovery for a moved file. Partial-hash candidates are tried first
    # (cheap); only candidates with an un-upgraded legacySha256 fall back to
    # a full-file hash, and that full hash is computed at most once here.
    candidates = by_size_state.get(size, [])
    if not candidates:
        return None

    partial: str | None = None
    for candidate in candidates:
        cid = candidate.get("contentId")
        if not (isinstance(cid, str) and cid):
            continue
        if partial is None:
            try:
                partial = content_id(full_path)
            except OSError:
                partial = ""
        if partial and partial == cid:
            if candidate.get("path") == rel and candidate.get("mtimeNs") == mtime_ns:
                return {"update": None}
            if not _entry_is_a_move(candidate, rel, base_dir):
                continue
            return {
                "update": _listing_update(
                    candidate, rel, "file", size, mtime_ns, None,
                )
            }

    full: str | None = None
    for candidate in candidates:
        legacy = candidate.get("legacySha256")
        if not (isinstance(legacy, str) and legacy):
            continue
        if full is None:
            try:
                full = _full_sha256(full_path)
            except OSError:
                full = ""
        if full and full == legacy:
            if not _entry_is_a_move(candidate, rel, base_dir):
                continue
            try:
                new_cid = partial if partial else content_id(full_path)
            except OSError:
                return None
            return {
                "update": _listing_update(
                    candidate, rel, "file", size, mtime_ns, new_cid,
                )
            }

    return None


def annotate_listing(
    cache_path: str,
    source: str,
    base_dir: str,
    files: list[dict[str, Any]],
    hidden_set: set,
) -> None:
    """Mutate `files` in place: set favorite/rejected/hiddenSelf/hidden flags,
    rediscovering entries whose file moved externally (matched by content
    hash, same division of labor as the original mark_favorites), and
    applying hidden's folder inheritance via `hidden_set` (dirs aren't
    hashed, so inheritance stays purely path-based).
    """
    with _LOCK:
        cache = _load(cache_path)
        source_states = cache["states"].get(source, {})
        source_activity = {
            path: dict(entry)
            for path, entry in cache.get("activity", {}).get(source, {}).items()
        }
        by_path: dict[str, dict[str, Any]] = {}
        by_size: dict[str, dict[int, list[dict[str, Any]]]] = {}
        for state in STATES:
            entries = source_states.get(state, [])
            by_path[state] = {entry.get("path"): dict(entry) for entry in entries}
            sizes: dict[int, list[dict[str, Any]]] = {}
            for entry in entries:
                if entry.get("kind") == "dir":
                    continue
                size = entry.get("size")
                if isinstance(size, int):
                    sizes.setdefault(size, []).append(dict(entry))
            by_size[state] = sizes

    # Hashing happens outside the lock (large media is slow); matches are
    # re-applied against a freshly reloaded cache below.
    updates: dict[str, list[dict[str, Any]]] = {state: [] for state in STATES}
    base = os.path.abspath(base_dir)

    for item in files:
        rel = _normalize_path(item.get("path"))
        if not rel:
            continue

        if item.get("type") == "dir":
            activity = source_activity.get(rel)
            if activity is not None:
                full_path = os.path.abspath(os.path.join(base, rel))
                try:
                    if os.path.commonpath([base, full_path]) == base:
                        _apply_activity_dates(item, activity, os.stat(full_path))
                except (OSError, ValueError):
                    pass
            for state in STATES:
                entry = by_path[state].get(rel)
                if entry and entry.get("kind") == "dir":
                    item[_STATE_FLAG[state]] = True
                elif state == "hidden" and entry and entry.get("kind") == "unknown":
                    item[_STATE_FLAG[state]] = True
                    updates[state].append(_listing_update(entry, rel, "dir"))
            if item.get("hiddenSelf") or _is_hidden_by_prefix(rel, hidden_set):
                item["hidden"] = True
            continue

        full_path = os.path.abspath(os.path.join(base, rel))
        try:
            if os.path.commonpath([base, full_path]) != base or not os.path.isfile(full_path):
                continue
            stat = os.stat(full_path)
        except (OSError, ValueError):
            continue

        _apply_activity_dates(item, source_activity.get(rel), stat)

        for state in STATES:
            result = _lookup_and_match(
                rel, full_path, stat, by_path[state], by_size[state], base,
            )
            if result is None:
                continue
            item[_STATE_FLAG[state]] = True
            update = result["update"]
            if update is not None:
                updates[state].append(update)

        if item.get("hiddenSelf") or _is_hidden_by_prefix(rel, hidden_set):
            item["hidden"] = True

    if not any(updates.values()):
        return

    with _LOCK:
        cache = _load(cache_path)
        source_states = cache["states"].get(source, {})
        changed = False
        for state in STATES:
            state_updates = updates[state]
            if not state_updates:
                continue
            by_identity = {u["identity"]: u for u in state_updates}
            for entry in source_states.get(state, []):
                update = by_identity.get(_entry_identity(entry))
                if update is None:
                    continue
                expected = update["expected"]
                if any(entry.get(field) != value for field, value in expected.items()):
                    # A concurrent writer renamed or refreshed this identity
                    # while listing/hash work ran; its newer cache record wins.
                    continue
                if (
                    entry.get("path") != update["path"]
                    or entry.get("kind") != update["kind"]
                    or (update["kind"] == "file" and entry.get("size") != update["size"])
                    or (update["kind"] == "file" and entry.get("mtimeNs") != update["mtimeNs"])
                    or update["contentId"]
                ):
                    entry["path"] = update["path"]
                    entry["kind"] = update["kind"]
                    if update["kind"] == "dir":
                        for field in ("contentId", "legacySha256", "size", "mtimeNs"):
                            entry.pop(field, None)
                    else:
                        entry["size"] = update["size"]
                        entry["mtimeNs"] = update["mtimeNs"]
                        if update["contentId"]:
                            entry["contentId"] = update["contentId"]
                            entry.pop("legacySha256", None)
                    changed = True
        if changed:
            _save(cache_path, cache)


def _read_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, OSError, ValueError):
        return None


def migrate_legacy(
    cache_path: str,
    *,
    favorites_path: str,
    hidden_path: str,
    hidden_legacy_paths: tuple = (),
    base_dirs: dict | None = None,
) -> bool:
    """One-time, lossless migration into the unified `file_state.json`.

    Runs only while `cache_path` doesn't already exist yet — re-merging
    legacy files on every startup would resurrect state the user already
    changed since. `base_dirs` maps source name ("output"/"input"/"temp") to
    its real directory, used to eagerly hash present files and stat legacy
    hidden paths for dir-vs-file; a source missing from `base_dirs` is
    treated as unresolvable (never crashes — falls back to retaining
    whatever fallback identity is available, same as an absent file).

    No existing server-side favorite or hidden path is dropped. A present
    legacy favorite is upgraded only after its old identity is verified; an
    absent/moved one keeps its full sha256 as `legacySha256`. An absent hidden
    path becomes `kind: unknown` until it returns as either a file or a
    directory. Reject is not migrated — it only ever existed client-side and
    intentionally starts empty.
    """
    base_dirs = base_dirs or {}
    with _LOCK:
        if os.path.exists(cache_path):
            return False

        merged = _empty_cache()
        changed = False

        favorites_raw = _read_json(favorites_path)
        favorites_by_source = (
            favorites_raw.get("favorites")
            if isinstance(favorites_raw, dict) and isinstance(favorites_raw.get("favorites"), dict)
            else {}
        )
        for source, entries in favorites_by_source.items():
            if not isinstance(source, str) or not isinstance(entries, list):
                continue
            base_dir = base_dirs.get(source)
            target_list = merged["states"].setdefault(source, {}).setdefault("favorite", [])
            for legacy_entry in entries:
                if not isinstance(legacy_entry, dict):
                    continue
                path = _normalize_path(legacy_entry.get("path"))
                if not path:
                    continue
                kind = legacy_entry.get("kind") if legacy_entry.get("kind") in ("file", "dir") else "file"
                if kind == "dir":
                    target_list.append({"path": path, "kind": "dir"})
                    changed = True
                    continue

                sha256 = legacy_entry.get("sha256")
                size = legacy_entry.get("size")
                mtime_ns = legacy_entry.get("mtimeNs")
                full_path = _full_path(base_dir, path)
                new_entry: dict[str, Any] | None = None
                if full_path and os.path.isfile(full_path):
                    try:
                        stat = os.stat(full_path)
                        has_legacy_sha = isinstance(sha256, str) and bool(sha256)
                        signature_matches = (
                            isinstance(size, int)
                            and isinstance(mtime_ns, int)
                            and int(stat.st_size) == int(size)
                            and int(stat.st_mtime_ns) == int(mtime_ns)
                        )
                        identity_matches = not has_legacy_sha or signature_matches
                        if has_legacy_sha and not signature_matches:
                            identity_matches = _full_sha256(full_path) == sha256
                        if identity_matches:
                            new_entry = {
                                "path": path,
                                "kind": "file",
                                "contentId": content_id(full_path),
                                "size": int(stat.st_size),
                                "mtimeNs": int(stat.st_mtime_ns),
                            }
                    except OSError:
                        new_entry = None
                if new_entry is None:
                    new_entry = {
                        "path": path,
                        "kind": "file",
                        "size": int(size) if isinstance(size, int) else 0,
                        "mtimeNs": int(mtime_ns) if isinstance(mtime_ns, int) else 0,
                    }
                    if isinstance(sha256, str) and sha256:
                        new_entry["legacySha256"] = sha256
                target_list.append(new_entry)
                changed = True

        hidden_sources_merged: dict[str, list[str]] = {}
        for legacy_path in (hidden_path, *hidden_legacy_paths):
            if not legacy_path:
                continue
            legacy_raw = _read_json(legacy_path)
            legacy_hidden = (
                legacy_raw.get("hidden")
                if isinstance(legacy_raw, dict) and isinstance(legacy_raw.get("hidden"), dict)
                else {}
            )
            for source, paths in legacy_hidden.items():
                if not isinstance(source, str) or not isinstance(paths, list):
                    continue
                bucket = hidden_sources_merged.setdefault(source, [])
                for raw_path in paths:
                    normalized = _normalize_path(raw_path)
                    if normalized and normalized not in bucket:
                        bucket.append(normalized)

        for source, paths in hidden_sources_merged.items():
            base_dir = base_dirs.get(source)
            target_list = merged["states"].setdefault(source, {}).setdefault("hidden", [])
            for path in paths:
                full_path = _full_path(base_dir, path)
                if full_path and os.path.isdir(full_path):
                    target_list.append({"path": path, "kind": "dir"})
                    changed = True
                    continue
                if full_path and os.path.isfile(full_path):
                    try:
                        stat = os.stat(full_path)
                        target_list.append({
                            "path": path,
                            "kind": "file",
                            "contentId": content_id(full_path),
                            "size": int(stat.st_size),
                            "mtimeNs": int(stat.st_mtime_ns),
                        })
                        changed = True
                        continue
                    except OSError:
                        pass
                # The legacy format did not record whether an absent path was a
                # file or directory. Keep it unknown until the path returns, then
                # upgrade to content identity or directory inheritance in place.
                target_list.append({"path": path, "kind": "unknown"})
                changed = True

        # Reject: never migrated — pre-existing client-side rejects are
        # intentionally dropped; reject starts empty server-side.

        if not changed:
            return False
        _save(cache_path, merged)
        return True
