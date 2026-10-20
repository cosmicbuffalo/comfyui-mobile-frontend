import json
import os
import threading
from typing import Any

from json_cache_io import atomic_write_json, now_ms as _now_ms


MAX_ENTRIES = 500

# Serializes the read-modify-write cycles below. Without it, two concurrent
# upserts/remaps both load the cache, mutate their own copy, and the second
# save clobbers the first writer's entry. The atomic os.replace in save_cache
# only prevents a torn file, not a lost update.
_LOCK = threading.RLock()


def _empty_cache() -> dict[str, Any]:
    return {
        "version": 1,
        "updatedAt": _now_ms(),
        "prompts": {},
    }


def _normalize_prompt_id(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    prompt_id = value.strip()
    return prompt_id or None


def _entry_updated_at(entry: Any) -> int:
    if not isinstance(entry, dict):
        return 0
    value = entry.get("updatedAt") or entry.get("createdAt") or 0
    return value if isinstance(value, int) else 0


def load_cache(cache_path: str) -> dict[str, Any]:
    try:
        with open(cache_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return _empty_cache()

    prompts = data.get("prompts")
    if not isinstance(prompts, dict):
        return _empty_cache()
    return {
        "version": 1,
        "updatedAt": data.get("updatedAt") if isinstance(data.get("updatedAt"), int) else _now_ms(),
        "prompts": prompts,
    }


def save_cache(cache_path: str, cache: dict[str, Any]) -> None:
    atomic_write_json(cache_path, cache, prefix=".queue_metadata.")


def _trim_prompts(prompts: dict[str, Any], max_entries: int = MAX_ENTRIES) -> dict[str, Any]:
    if len(prompts) <= max_entries:
        return prompts
    keys = sorted(prompts, key=lambda key: _entry_updated_at(prompts[key]))
    keep = set(keys[-max_entries:])
    return {key: value for key, value in prompts.items() if key in keep}


def sanitize_entry(prompt_id: str, entry: dict[str, Any], previous: dict[str, Any] | None = None) -> dict[str, Any]:
    now = _now_ms()
    previous = previous if isinstance(previous, dict) else {}
    result: dict[str, Any] = {
        "promptId": prompt_id,
        "createdAt": previous.get("createdAt") if isinstance(previous.get("createdAt"), int) else now,
        "updatedAt": now,
    }

    workflow_label = entry.get("workflowLabel")
    if isinstance(workflow_label, str):
        trimmed = workflow_label.strip()
        if trimmed:
            result["workflowLabel"] = trimmed[:240]

    workflow_source = entry.get("workflowSource")
    if isinstance(workflow_source, dict):
        source: dict[str, Any] = {}
        for key in ("type", "filename", "templateName", "moduleName"):
            value = workflow_source.get(key)
            if isinstance(value, str):
                source[key] = value[:500]
        if source:
            result["workflowSource"] = source

    session_id = entry.get("sessionId")
    if isinstance(session_id, str) and session_id:
        result["sessionId"] = session_id[:120]

    client_id = entry.get("clientId")
    if isinstance(client_id, str) and client_id:
        result["clientId"] = client_id[:160]

    workflow_diff = entry.get("workflowDiff")
    if isinstance(workflow_diff, dict):
        result["workflowDiff"] = workflow_diff

    return result


def _owned_by(entry: Any, owner_id: str | None) -> bool:
    """Whether `owner_id` may see or change this entry. None is unrestricted:
    no accounts, or an admin. An entry without an owner predates accounts, or
    was an admin's, and stays admin-only like an unowned file."""
    return owner_id is None or (isinstance(entry, dict) and entry.get("ownerId") == owner_id)


def upsert_prompt_metadata(cache_path: str, prompt_id: str, entry: dict[str, Any],
                           owner_id: str | None = None) -> dict[str, Any] | None:
    """Write a prompt's metadata. None when it belongs to someone else."""
    with _LOCK:
        cache = load_cache(cache_path)
        prompts = cache["prompts"]
        previous = prompts.get(prompt_id)
        if previous is not None and not _owned_by(previous, owner_id):
            return None
        next_entry = sanitize_entry(prompt_id, entry, previous)
        owner = previous.get("ownerId") if isinstance(previous, dict) else owner_id
        if owner:
            next_entry["ownerId"] = owner
        prompts[prompt_id] = next_entry
        cache["prompts"] = _trim_prompts(prompts)
        cache["updatedAt"] = _now_ms()
        save_cache(cache_path, cache)
        return next_entry


def remap_prompt_metadata(cache_path: str, old_prompt_id: str, new_prompt_id: str,
                          owner_id: str | None = None) -> dict[str, Any] | None:
    with _LOCK:
        cache = load_cache(cache_path)
        prompts = cache["prompts"]
        previous = prompts.get(old_prompt_id)
        if not isinstance(previous, dict) or not _owned_by(previous, owner_id):
            return None
        if new_prompt_id in prompts and not _owned_by(prompts[new_prompt_id], owner_id):
            return None
        prompts.pop(old_prompt_id, None)
        prompts[new_prompt_id] = sanitize_entry(
            new_prompt_id,
            {
                **previous,
                "promptId": new_prompt_id,
            },
            previous,
        )
        if previous.get("ownerId"):
            prompts[new_prompt_id]["ownerId"] = previous["ownerId"]
        cache["prompts"] = _trim_prompts(prompts)
        cache["updatedAt"] = _now_ms()
        save_cache(cache_path, cache)
        return prompts[new_prompt_id]


def get_prompt_metadata(cache_path: str, prompt_ids: list[str] | None = None,
                        owner_id: str | None = None) -> dict[str, Any]:
    cache = load_cache(cache_path)
    prompts = {key: entry for key, entry in cache["prompts"].items() if _owned_by(entry, owner_id)}
    if prompt_ids is None:
        return prompts
    wanted = set(filter(None, (_normalize_prompt_id(value) for value in prompt_ids)))
    return {prompt_id: prompts[prompt_id] for prompt_id in wanted if prompt_id in prompts}
