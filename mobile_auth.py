"""Soft dependency on the optional comfyui-multiuser auth node.

The auth node exposes a small, stable contract that this node consumes.
Everything here is the *consumer* half: when
the auth node isn't installed — which is the overwhelmingly common case — every
function degrades to the single-user answer this node has always given, and no
caller needs to branch.

Two rules govern this module:

1. **Import lazily, at call time, never at module import.** Load order between
   custom nodes is not guaranteed, so importing the auth node at import time
   would work or not depending on directory names.
2. **Never fail open on an enabled server, never fail closed on a disabled
   one.** If the auth node is absent, `is_enabled()` is False and the scoping
   helpers are identity functions. If it is present but raises, we treat that as
   enabled-and-denying rather than silently reverting to global access — a
   broken auth layer must not become an open one.
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


def scope_path(kind: str, path: str) -> str:
    """Rewrite a path into the current user's space. Identity when disabled."""
    api = _resolve()
    if api is None:
        return path
    try:
        return api.scope_path(kind, path)
    except Exception as exc:
        _warn_once(exc)
        return path


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
