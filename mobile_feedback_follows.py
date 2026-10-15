"""Feedback issues this server follows on the submitter's behalf.

When someone sends in-app feedback and asks to see replies, the feedback
service returns the issue number and a secret that lets them reply to it or
stop following it. The browser keeps them here, per user, so every device on
the server sees the activity banner. This module never contacts the feedback
service; the browser does, with the entries it reads from here.

Stored in user/default/mobile/feedback_follows.json as
{user_key: [{number, title, secret, canReply, followedAt, seenAt}, ...]}.
canReply is false when the submitter's GitHub handle was mentioned on the
issue, so they answer there instead of through the app.
"""
import json
import os
import threading

import folder_paths

from json_cache_io import atomic_write_json, now_ms

_LOG_PREFIX = "[\033[34mMobile\033[0m]"

_MAX_TITLE_LEN = 200
_MAX_SECRET_LEN = 100

_lock = threading.Lock()
_follows = None


def _follows_path():
    return os.path.join(folder_paths.get_user_directory(), "default", "mobile", "feedback_follows.json")


def _load_locked() -> dict:
    """Caller MUST already hold _lock."""
    global _follows
    if _follows is None:
        path = _follows_path()
        loaded = {}
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
            except Exception as exc:
                print(f"{_LOG_PREFIX} failed to read feedback follows, starting empty: {exc}", flush=True)
        _follows = loaded if isinstance(loaded, dict) else {}
    return _follows


def _save_locked(follows: dict) -> None:
    global _follows
    # Persist first so a failed write never leaves memory ahead of disk.
    atomic_write_json(_follows_path(), follows, prefix=".feedback_follows.")
    _follows = follows


def _valid_number(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def list_follows(user_key: str) -> list:
    with _lock:
        return [dict(entry) for entry in _load_locked().get(user_key, [])]


def add_follow(user_key: str, number, title, secret, can_reply) -> bool:
    if not _valid_number(number) or not isinstance(can_reply, bool):
        return False
    if not isinstance(title, str) or not isinstance(secret, str):
        return False
    title = title.strip()[:_MAX_TITLE_LEN]
    if not secret or len(secret) > _MAX_SECRET_LEN:
        return False
    with _lock:
        follows = dict(_load_locked())
        entries = [e for e in follows.get(user_key, []) if e.get("number") != number]
        now = now_ms()
        entries.append({"number": number, "title": title, "secret": secret, "canReply": can_reply,
                        "followedAt": now, "seenAt": now})
        follows[user_key] = entries
        _save_locked(follows)
        return True


def mark_seen(user_key: str, number, seen_at) -> bool:
    if not _valid_number(number) or not _valid_number(seen_at):
        return False
    with _lock:
        follows = dict(_load_locked())
        entries = [dict(e) for e in follows.get(user_key, [])]
        for entry in entries:
            if entry.get("number") == number:
                entry["seenAt"] = max(entry.get("seenAt", 0), seen_at)
                follows[user_key] = entries
                _save_locked(follows)
                return True
        return False


def remove_follow(user_key: str, number) -> bool:
    if not _valid_number(number):
        return False
    with _lock:
        follows = dict(_load_locked())
        entries = follows.get(user_key, [])
        kept = [e for e in entries if e.get("number") != number]
        if len(kept) == len(entries):
            return False
        if kept:
            follows[user_key] = kept
        else:
            follows.pop(user_key, None)
        _save_locked(follows)
        return True
