"""Shared write/dedupe helpers for on-disk binary caches (previews, thumbs).

Two hazards with naive ``open(path, 'wb')`` caches under concurrent requests:

- A reader can see a half-written file and serve truncated bytes — which the
  long-lived ``Cache-Control`` headers then pin in the browser for a day.
- Two requests for the same uncached item both pay the expensive render.

``atomic_write_bytes`` fixes the first (temp file + ``os.replace``);
``render_lock`` collapses the second (per-cache-key lock, callers re-check the
cache after acquiring). Locks are tiny; the registry is soft-capped as a
leak backstop rather than pruned per-release, so waiters never see their lock
swapped out from under them.
"""

import os
import threading

_LOCKS_SOFT_CAP = 4096

_locks_guard = threading.Lock()
_locks = {}


def atomic_write_bytes(path, data):
    """Write bytes so concurrent readers only ever see complete files."""
    tmp = '{}.{}.{}.tmp'.format(path, os.getpid(), threading.get_ident())
    try:
        with open(tmp, 'wb') as handle:
            handle.write(data)
        os.replace(tmp, path)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass


def render_lock(path):
    """Per-cache-key lock so concurrent misses render once, not N times."""
    with _locks_guard:
        if len(_locks) > _LOCKS_SOFT_CAP:
            # Backstop against unbounded growth. Threads still holding or
            # waiting on a dropped lock keep their own reference; the worst
            # case is one extra render for a key mid-churn.
            _locks.clear()
        lock = _locks.get(path)
        if lock is None:
            lock = threading.Lock()
            _locks[path] = lock
        return lock
