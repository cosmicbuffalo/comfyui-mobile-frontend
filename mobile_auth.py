"""Soft dependency on the optional comfyui-multiuser auth node.

The auth node exposes a small, stable contract that this node consumes.
Everything here is the *consumer* half: when
the auth node isn't installed — which is the overwhelmingly common case — every
function degrades to the single-user answer this node has always given, and no
caller needs to branch.

Four rules govern this module:

1. **Import lazily, at call time, never at module import.** Load order between
   custom nodes is not guaranteed, so importing the auth node at import time
   would work or not depending on directory names.
2. **Never fail open on an enabled server, never fail closed on a disabled
   one.** If the auth node is absent, `is_enabled()` is False and the scoping
   helpers are identity functions. If it is present but raises, we treat that as
   enabled-and-denying rather than silently reverting to global access — a
   broken auth layer must not become an open one.
3. **Version tolerance, per check.** A node predating a given method is not an
   error, and each check gets the answer that is honest for *its* cost:
   `can_read_file` / `can_manage_hidden` → True (a lockout of one's own
   outputs would be the worse loss), `can_modify_file` → the `can_read_file` answer (stricter than
   nothing), `badge_for_file` / `prompt_owner` / `folder_badges` / the
   `*_tags` reporters → an empty, honest report, `virtually_deleted_paths`
   → empty, `virtual_delete_file`, `can_access_model`, `can_create_folder` and
   `assign_new_folder` → False (refuse rather than pretend or grant),
   `prompt_owner_or_unknown` →
   `OWNER_UNKNOWN`. Two exceptions in the other direction are deliberate:
   `filter_files` denies (`[]`) even when the *method* is missing from a
   present node — a listing that cannot be scoped must not be returned
   unscoped — and `prompt_owner` folds "cannot say" into "nobody owns it",
   because silencing every notification is the worse loss on a server that
   was single-user anyway; callers that must not fan out use
   `prompt_owner_or_unknown` instead (see `mobile_push`).
4. **Method raising → that check's deny path.** Once the node is installed
   it is meant to gate, so a call that raises ends in 403, `[]`, `False`,
   `OWNER_UNKNOWN`, or an empty report — never on the unfiltered answer.

Each helper's docstring pins its own degradation, so the matrix above cannot
drift silently from the code.
"""
import importlib
import threading

_LOG_PREFIX = "[\033[34mMobile Auth\033[0m]"

_MODULE_NAME = "comfyui_multiuser.api"

_lock = threading.Lock()
_resolved = False
_api = None
_warned = False


class _BrokenAuth:
    """Keep a failed provider on each helper's existing deny/error path."""

    def __getattr__(self, name):
        raise RuntimeError("auth provider failed to initialize")


def _resolve():
    """Return the auth node's api module, or None when it isn't installed.

    Cached after the first attempt: a missing optional dependency must not cost
    an import-system miss on every request.
    """
    global _resolved, _api
    if _resolved:
        return _api
    with _lock:
        if _resolved:
            return _api
        try:
            _api = importlib.import_module(_MODULE_NAME)
        except ModuleNotFoundError as exc:
            if exc.name in (_MODULE_NAME, "comfyui_multiuser"):
                _api = None
            else:
                print(f"{_LOG_PREFIX} auth node failed to import: {exc}", flush=True)
                _api = _BrokenAuth()
        except Exception as exc:
            print(f"{_LOG_PREFIX} auth node failed to import: {exc}", flush=True)
            _api = _BrokenAuth()
        _resolved = True
    return _api


def reset_cache():
    """Test seam: forget whether the auth node was resolved."""
    global _resolved, _api, _warned
    with _lock:
        _resolved = False
        _api = None
        _warned = False


def _warn_once(exc):
    global _warned
    if _warned:
        return
    _warned = True
    print(f"{_LOG_PREFIX} auth node call failed, denying: {exc}", flush=True)


def is_enabled() -> bool:
    """True when the auth node is installed AND switched on."""
    api = _resolve()
    if api is None:
        return False
    try:
        return bool(api.is_enabled())
    except Exception as exc:
        _warn_once(exc)
        # Installed but erroring — see rule 2. Reporting "enabled" keeps every
        # other helper here on its deny path.
        return True


def current_user():
    """The requesting user, or None. Only meaningful inside a request."""
    api = _resolve()
    if api is None:
        return None
    try:
        return api.current_user()
    except Exception as exc:
        _warn_once(exc)
        return None


def may_change_server_settings() -> bool:
    """Whether the requesting user may flip a server-wide switch (telemetry,
    CivitAI lookups): anyone on a single-user server, only an admin when the
    auth node is on. Inside a request only. A broken auth layer denies."""
    if not is_enabled():
        return True
    user = current_user()
    if not isinstance(user, dict):
        return False
    # Same predicate as mobile_viewer_scope.is_admin (not imported: that module
    # imports this one) — user dicts carry roles, never an is_admin flag.
    roles = {str(role).casefold() for role in (user.get("roles") or [])}
    return "admin" in roles or user.get("role") == "admin"


def viewer_unresolved(user=None) -> bool:
    """True when the gate is on but who is asking cannot be determined.

    This is the state every scoping decision has to tell apart from "there are
    no accounts here". Both arrive as a ``None`` user, and treating them alike
    is what makes a broken gate fail OPEN: with one user, "everyone's things"
    and "this person's things" really are the same set, so ``None`` meaning
    "unscoped" is correct there and catastrophic here.

    ``is_enabled()`` already reports True when the auth node is installed but
    erroring (rule 2), so this returns True exactly when the node is meant to
    be gating and cannot answer -- the case where callers must deny rather than
    serve the server-wide view.
    """
    if not is_enabled():
        return False
    resolved = user if user is not None else current_user()
    return not (isinstance(resolved, dict) and resolved.get("id") is not None)


def can_view_foreign_prompts(user=None) -> bool:
    """Whether this viewer may see other accounts' queue items and progress.

    The decided contract: admins only. The auth node may later define a role
    that widens it, so the node is asked first when it has an opinion -- the
    admin fallback is what keeps that door open without naming the role here.
    """
    api = _resolve()
    if api is None:
        return True
    try:
        if not api.is_enabled():
            return True
        check = getattr(api, 'can_view_foreign_prompts', None)
        if check is not None:
            return bool(check(user=user))
    except Exception as exc:
        _warn_once(exc)
        return False
    # Same predicate as mobile_viewer_scope.is_admin (not imported: that module
    # imports this one) — user dicts carry roles, never an is_admin flag.
    roles = [str(r).casefold() for r in ((user or {}).get('roles') or [])]
    return 'admin' in roles or (user or {}).get('role') == 'admin'


def can_manage_hidden(user=None) -> bool:
    """Standalone/older servers retain their existing hidden controls."""
    api = _resolve()
    if api is None:
        return True
    try:
        if not api.is_enabled():
            return True
        check = getattr(api, 'can_manage_hidden', None)
        return True if check is None else bool(check(user=user))
    except Exception as exc:
        _warn_once(exc)
        return False


def register_hidden_file_provider(provider) -> bool:
    return _register_optional_provider(provider, 'register_hidden_file_provider')


def _register_optional_provider(provider, name: str) -> bool:
    """Shared soft-dependency registration for hidden-state providers.

    Registration runs at node load and must never take the node down: a
    raising `register()` is reported and answered False (the provider is not
    installed), the same never-fail rule the rest of this module follows.
    """
    api = _resolve()
    if api is None:
        return False
    try:
        # getattr inside the guard: a broken provider raises on ANY attribute
        # access, and registration happens at node load where nothing may
        # propagate.
        register = getattr(api, name, None)
        if register is None:
            return False
        register(provider)
    except Exception as exc:
        print(f"{_LOG_PREFIX} {name} failed: {exc}", flush=True)
        return False
    return True


def register_hidden_workflow_provider(provider) -> bool:
    """Offer the hidden-workflow callback; False when no auth node needs it."""
    return _register_optional_provider(provider, 'register_hidden_workflow_provider')


def register_hidden_model_provider(provider) -> bool:
    """Offer the hidden-model callback; False when no auth node needs it."""
    return _register_optional_provider(provider, 'register_hidden_model_provider')


def register_user_deleted_hook(hook) -> bool:
    """Ask the auth node to announce account deletions to this one.

    `hook` is called with the deleted account's id, after the row is gone.
    False covers no auth node, one too old to have the hook, and a
    registration that actually failed: none of which the caller can
    distinguish or needs to — without the hook this node's per-account
    state simply lives on, which is exactly the pre-hook behaviour.
    """
    return _register_optional_provider(hook, 'register_user_deleted_hook')


def allow_public_route(method: str, path: str) -> bool:
    """Ask the auth node to let one of our routes through unauthenticated.

    For `/mobile/api/presence` and nothing else: a client deciding whether it
    needs *admin* credentials to add this server has to know whether this node
    is installed, and it cannot learn that through a gate that denies everyone
    before sign-in.

    Returns whether the exemption was recorded. False is the ordinary answer on
    a server with no auth node — there is no gate, so the route already
    answers — and also covers an auth node predating the registration API,
    where the honest outcome is that the probe stays gated rather than that
    this node forces itself open.
    """
    api = _resolve()
    if api is None:
        return False
    try:
        # getattr, not a broad AttributeError catch: an AttributeError raised
        # INSIDE a present allow_public_route is a refusal/bug to report, not
        # evidence that the auth node predates the API. (Inside the try: a
        # broken provider raises on ANY attribute access.)
        register = getattr(api, "allow_public_route", None)
        if register is None:
            return False
        register(method, path, source="comfyui-mobile-frontend")
        return True
    except Exception as exc:
        # A refusal is the auth node's call to make; never treat it as fatal.
        print(f"{_LOG_PREFIX} public route {method} {path} refused: {exc}",
              flush=True)
        return False


def prompt_owner(prompt_tuple):
    """The account a queued job belongs to, or None.

    Takes the prompt tuple as ComfyUI stores it (`history[id]["prompt"]`). None
    means "nobody in particular" — no auth node, gate switched off, or a job
    queued before the gate existed — and every caller reads that as "behave
    like the single-user server this has always been", i.e. notify everyone.

    Deliberately NOT on the deny path: an auth node that errors here would
    otherwise silence every notification on the server, and a missed push is a
    worse answer than a broadcast on a server that was single-user anyway.
    """
    api = _resolve()
    if api is None:
        return None
    try:
        return api.prompt_owner(prompt_tuple)
    except AttributeError:
        # Auth node predating this call: no ownership information available.
        return None
    except Exception as exc:
        _warn_once(exc)
        return None


OWNER_UNKNOWN = object()


def prompt_owner_or_unknown(prompt_tuple):
    """`prompt_owner`, but telling "nobody owns this" apart from "cannot say".

    `prompt_owner` folds both into None on purpose — it is deliberately off the
    deny path, because silencing every notification is a worse answer than
    notifying broadly on a server that was single-user anyway. That reasoning
    holds only while None really does mean single-user. Once accounts are on,
    "cannot say" addresses every device on the server, and callers that fan out
    need to see the difference.

    Returns the owner, None when the job is genuinely unowned (no auth node, or
    the node says so), or OWNER_UNKNOWN when the node is installed but could
    not answer. Callers decide what unknown costs them; `prompt_owner` keeps
    its old contract for everyone else.
    """
    api = _resolve()
    if api is None:
        return None
    try:
        return api.prompt_owner(prompt_tuple)
    except AttributeError as exc:
        # Installed but predating this call: it is gating something, and cannot
        # tell us whose. That is unknown, not unowned.
        _warn_once(exc)
        return OWNER_UNKNOWN
    except Exception as exc:
        _warn_once(exc)
        return OWNER_UNKNOWN


def can_read_file(path: str, user=None) -> bool:
    """Whether this viewer may read one file. True for everything when off."""
    api = _resolve()
    if api is None:
        return True
    try:
        # An auth node older than this contract. Treat the capability as absent
        # rather than denying, so upgrading this node alone cannot lock a user
        # out of their own outputs.
        check = getattr(api, "can_read_file", None)
        return True if check is None else bool(check(path, user=user))
    except Exception as exc:
        _warn_once(exc)
        return False


def can_modify_file(path: str, user=None) -> bool:
    """Whether this viewer may delete/rename/move one file. Owner-only."""
    api = _resolve()
    if api is None:
        return True
    try:
        # Auth node predating this contract: fall back to read permission,
        # which is stricter than nothing and never blocks a single-user setup.
        check = getattr(api, "can_modify_file", None)
        return can_read_file(path, user=user) if check is None else bool(check(path, user=user))
    except Exception as exc:
        _warn_once(exc)
        return False


def can_create_folder(path: str, tree: str = "output", user=None) -> bool:
    """Whether this viewer may make a new folder at a tree-relative path.

    False when the auth node predates this contract: a folder nobody can own
    would sit shared in everyone's tree, which is what this check prevents.
    """
    api = _resolve()
    if api is None:
        return True
    try:
        return bool(api.can_create_folder(path, tree=tree, user=user))
    except AttributeError:
        return False
    except Exception as exc:
        _warn_once(exc)
        return False


def assign_new_folder(path: str, tree: str = "output", user=None) -> bool:
    """Make a folder this request just created its creator's. False when that
    could not be recorded, so the caller can undo the folder."""
    api = _resolve()
    if api is None:
        return True
    try:
        api.assign_new_folder(path, tree=tree, user=user)
        return True
    except AttributeError:
        return False
    except Exception as exc:
        _warn_once(exc)
        return False


def folder_moved(old_path: str, new_path: str, tree: str = "output") -> None:
    """Tell the auth node a folder moved, so its ownership goes with it. A no-op
    without the node, or with one predating this call."""
    api = _resolve()
    if api is None:
        return
    try:
        api.folder_moved(old_path, new_path, tree=tree)
    except AttributeError:
        return
    except Exception as exc:
        _warn_once(exc)


def folder_deleted(path: str, tree: str = "output") -> None:
    """Tell the auth node a folder is gone, so its ownership does not outlive it."""
    api = _resolve()
    if api is None:
        return
    try:
        api.folder_deleted(path, tree=tree)
    except AttributeError:
        return
    except Exception as exc:
        _warn_once(exc)


def virtual_delete_file(path: str, user=None) -> bool:
    """Soft-delete a foreign-but-visible file from this viewer's own view.

    Returns False when the auth node is absent or predates this contract —
    the caller should then refuse the delete outright rather than pretend.
    """
    api = _resolve()
    if api is None:
        return False
    try:
        return bool(api.virtual_delete_file(path, user=user))
    except AttributeError:
        return False
    except Exception as exc:
        _warn_once(exc)
        return False


def virtually_deleted_paths(paths, user=None):
    """The subset of these paths this viewer has soft-deleted (a set)."""
    api = _resolve()
    if api is None:
        return set()
    try:
        return set(api.virtually_deleted_paths(paths, user=user))
    except AttributeError:
        return set()
    except Exception as exc:
        _warn_once(exc)
        return set()


def clear_virtual_deletes(path: str) -> None:
    """Sweep every user's soft-delete tombstone before a real delete."""
    api = _resolve()
    if api is None:
        return
    try:
        api.clear_virtual_deletes(path)
    except AttributeError:
        pass
    except Exception as exc:
        _warn_once(exc)


def badge_for_file(path: str, user=None):
    """Ownership badge for this file, or None when there is nothing to show."""
    api = _resolve()
    if api is None:
        return None
    try:
        return api.badge_for_file(path, user=user)
    except AttributeError:
        return None
    except Exception as exc:
        _warn_once(exc)
        return None


def can_access_model(rel_path: str, user=None) -> bool:
    """Whether this viewer may use a model. True for everything when off.

    `user` is passed explicitly by executor-thread callers, where the
    ContextVar viewer does not propagate — an unresolved viewer there reads as
    "not a request" and would silently skip filtering.
    """
    api = _resolve()
    if api is None:
        return True
    try:
        return bool(api.can_access_model(rel_path, user=user))
    except TypeError:
        # Auth node predating the explicit-viewer contract.
        try:
            return bool(api.can_access_model(rel_path))
        except Exception as exc:
            _warn_once(exc)
            return False
    except Exception as exc:
        _warn_once(exc)
        return False


def model_role_tags(rel_paths) -> dict:
    """Which roles govern each of these models: `{rel: {roles, restricted}}`.

    Display metadata for models that have ALREADY cleared `can_access_model`,
    so this is the one helper here deliberately NOT on the deny path: an empty
    answer costs a badge, never access. That is also the honest answer on a
    server with no auth node, where there are no roles to report, and on an
    auth node predating the call.
    """
    api = _resolve()
    if api is None:
        return {}
    try:
        if not api.is_enabled():
            return {}
        report = getattr(api, 'model_role_tags', None)
        if report is None:
            return {}
        tags = report(list(rel_paths))
    except Exception as exc:
        _warn_once(exc)
        return {}
    return tags if isinstance(tags, dict) else {}


def filter_files(paths, user=None) -> list:
    """Drop files the current user may not see. Pass-through when disabled.

    `user` is passed explicitly by callers that do their listing on an executor
    thread: the auth node resolves the viewer from a ContextVar, which does not
    propagate there, and an unresolved viewer means "hide everything".
    """
    api = _resolve()
    if api is None:
        return list(paths)
    try:
        return list(api.filter_files(paths, user=user))
    except Exception as exc:
        _warn_once(exc)
        # Deny rather than disclose: an erroring filter returning everything is
        # exactly the leak this module exists to prevent.
        return []


def folder_badges(paths, tree="output", user=None) -> dict:
    """Visibility/badge verdicts for folders, keyed by tree-relative path.

    Only folders governed by an assignment appear in the result; missing
    keys mean "no verdict — pass through". Empty when the auth node is
    absent, older than this call, or erroring: folders then stay visible
    and their contents remain filtered file-by-file, which is the old
    (leaky-names, safe-bytes) behaviour rather than a lockout.
    """
    api = _resolve()
    if api is None:
        return {}
    try:
        return dict(api.folder_badges(paths, tree=tree, user=user))
    except AttributeError:
        return {}
    except Exception as exc:
        _warn_once(exc)
        return {}
