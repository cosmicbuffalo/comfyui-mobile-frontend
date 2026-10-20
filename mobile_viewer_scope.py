"""Per-viewer scoping policy: whose prompt, and who is an admin.

The prompt-ownership walk and the one admin predicate, shared by the progress
socket and the notification preferences so push, Live Activities and the live
progress stream route each job to the account that queued it. 4.0.0 grows this
module into the full per-viewer policy (stores, hidden views); 3.4 carries only
the part the iOS app's per-account notifications need.
"""

import mobile_auth as _mobile_auth


def is_admin(user) -> bool:
    """One admin predicate for every route in this node.

    Viewer dicts come from mobile_auth.current_user(). Centralized so the
    admin-only surfaces (scoped counts, attribution, prefs stores) all widen
    together if a future role is ever granted foreign visibility.
    """
    if not isinstance(user, dict):
        return False
    roles = {r.casefold() for r in (user.get("roles") or [])
             if isinstance(r, str)}
    return "admin" in roles or user.get("role") == "admin"


_AUTH_DEFAULT = object()


def resolve_prompt_owner(prompt_id, auth=_AUTH_DEFAULT, cache=None):
    """The account a prompt belongs to, or None. The ONE history/queue walk.

    Shared by the progress websocket's `_owner_of` and the system routes'
    `_prompt_owner`, which used to hand-roll the same lookup separately.
    History is consulted first, then the running queue, then the pending
    queue (a job attributed the moment it is queued, not only once it runs).

    `cache` is the caller's memo dict: an owner, once found, cannot change
    for a given job, so it is remembered — bounded by clearing when it
    outgrows a handful of ids. A prompt found in NEITHER history nor the
    queue is never memoised: that is most likely the instant between
    task_done popping it and the history write, and memoising None there
    would permanently misattribute the prompt's later events.

    `auth` is the caller's mobile_auth module (the websocket module holds a
    patchable reference of its own, which may itself be None — no auth layer,
    where every job is nobody's in particular). Omitted, it is this module's
    mobile_auth.
    """
    if auth is _AUTH_DEFAULT:
        auth = _mobile_auth
    if not prompt_id or auth is None:
        return None
    if cache is not None and prompt_id in cache:
        return cache[prompt_id]
    owner = None
    found = False
    try:
        import server

        inst = getattr(server.PromptServer, "instance", None)
        queue = getattr(inst, "prompt_queue", None)
        if queue is None:
            return None
        # History first — completed jobs are the common lookup.
        entry = None
        get_history = getattr(queue, "get_history", None)
        if callable(get_history):
            history = get_history(prompt_id=prompt_id)
            if isinstance(history, dict):
                entry = history.get(prompt_id)
        else:
            history = getattr(queue, "history", None)
            if isinstance(history, dict):
                entry = history.get(prompt_id)
        if isinstance(entry, dict):
            found = True
            owner = auth.prompt_owner(entry.get("prompt"))
        if owner is None:
            running = getattr(queue, "currently_running", None)
            candidates = (list(running.values())
                          if isinstance(running, dict) else [])
            get_current = getattr(queue, "get_current_queue", None)
            if callable(get_current):
                try:
                    current_running, pending = get_current()
                except Exception:
                    current_running, pending = [], []
                if not candidates:
                    candidates = list(current_running or [])
                candidates = candidates + list(pending or [])
            for prompt_tuple in candidates:
                if (isinstance(prompt_tuple, (list, tuple))
                        and len(prompt_tuple) > 1
                        and prompt_tuple[1] == prompt_id):
                    found = True
                    owner = auth.prompt_owner(prompt_tuple)
                    break
    except Exception:
        return None
    if owner is None and not found:
        return None
    if cache is not None:
        if len(cache) > 64:
            cache.clear()
        cache[prompt_id] = owner
    return owner
