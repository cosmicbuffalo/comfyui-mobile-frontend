"""Shared low-level IO for the small JSON sidecar caches (hidden items, input
aliases, file-prefix aliases, queue metadata).

Each cache module owns its own schema, validation, and lock; this module only
provides the common timestamp + atomic-write primitives that were previously
copy-pasted into every one of them, so that behavior stays identical across all
of them and the security/correctness-sensitive write path lives in one place.
"""

import json
import os
import tempfile
import time
from typing import Any


def now_ms() -> int:
    return int(time.time() * 1000)


def atomic_write_json(cache_path: str, cache: dict[str, Any], *, prefix: str) -> None:
    """Atomically write ``cache`` as compact JSON to ``cache_path``.

    Writes to a temp file in the same directory then ``os.replace()``s it into
    place, so a concurrent reader never observes a half-written file. ``prefix``
    names the temp file (for easier debugging). The temp file is removed if the
    write fails.
    """
    directory = os.path.dirname(cache_path)
    # `directory or "."` so a bare relative cache path (no dir component) doesn't
    # raise — os.path.dirname returns "" there and os.makedirs("") errors.
    os.makedirs(directory or ".", exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=prefix, suffix=".json", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(cache, handle, separators=(",", ":"), ensure_ascii=False)
        os.replace(temp_path, cache_path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise
