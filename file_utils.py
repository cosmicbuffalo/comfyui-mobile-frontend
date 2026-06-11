import os
import time


def is_within_dir(base_dir, target_path):
    """True if target_path is base_dir itself or strictly inside it.

    Separator-aware: unlike a bare ``startswith(base_dir)`` check, this rejects
    sibling directories that merely share a name prefix (e.g. ``output_secret``
    is NOT inside ``output``).

    Uses realpath so a symlink *inside* base_dir cannot smuggle a target back
    out of the sandbox (a plain abspath check would follow the link blindly).
    """
    base = os.path.realpath(base_dir)
    target = os.path.realpath(target_path)
    return target == base or target.startswith(base + os.sep)


def safe_join(base_dir, *rel_parts):
    """Join rel_parts under base_dir and return the absolute path, or None if the
    result escapes base_dir (path traversal). Centralizes the security-critical
    join used by the file-serving routes: callers turn a None into their own 403.
    """
    target = os.path.abspath(os.path.join(base_dir, *rel_parts))
    if not is_within_dir(base_dir, target):
        return None
    return target


# Cache of a folder's recursive (count, total_size), keyed by (abs_path, show_hidden).
# Walking a subtree to count files + sum sizes is the most expensive part of a
# default (non-flattened) listing, and the outputs view re-lists constantly, so we
# memoize it. The folder's own st_mtime_ns invalidates the entry when its direct
# children change; a short TTL backstops changes made deep inside the subtree
# (which don't bump the top folder's mtime).
_FOLDER_STATS_CACHE = {}
_FOLDER_STATS_TTL_SECONDS = 30.0
_FOLDER_STATS_CACHE_MAX = 4096


def _compute_folder_stats(full_path, show_hidden):
    count = 0
    total_size = 0
    for walk_root, walk_dirs, files in os.walk(full_path):
        if not show_hidden:
            walk_dirs[:] = [d for d in walk_dirs if not d.startswith('.')]
        visible_files = [f for f in files if show_hidden or not f.startswith('.')]
        count += len(visible_files)
        for f in visible_files:
            try:
                total_size += os.path.getsize(os.path.join(walk_root, f))
            except OSError:
                pass
    return count, total_size


def folder_stats(full_path, show_hidden, dir_mtime_ns):
    """Recursive (count, total_size) for a folder, memoized. `dir_mtime_ns` is the
    folder's own st_mtime_ns; a change invalidates the cache, and a short TTL
    backstops deep-subtree changes that don't bump the top folder's mtime."""
    key = (full_path, bool(show_hidden))
    now = time.monotonic()
    cached = _FOLDER_STATS_CACHE.get(key)
    if cached is not None:
        c_mtime, c_deadline, c_count, c_size = cached
        if c_mtime == dir_mtime_ns and now < c_deadline:
            return c_count, c_size
    count, total_size = _compute_folder_stats(full_path, show_hidden)
    # Crude unbounded-growth guard: a fresh listing repopulates hot folders, so
    # dropping everything on overflow is cheap and simpler than an LRU.
    if len(_FOLDER_STATS_CACHE) >= _FOLDER_STATS_CACHE_MAX:
        _FOLDER_STATS_CACHE.clear()
    _FOLDER_STATS_CACHE[key] = (dir_mtime_ns, now + _FOLDER_STATS_TTL_SECONDS, count, total_size)
    return count, total_size


def _rel_fwd(path, start):
    """relpath with forward slashes so the API returns consistent paths on
    Windows too (hidden-state and folder logic downstream assume '/')."""
    return os.path.relpath(path, start).replace(os.sep, '/')


def search_path_for_entry(entry, scope_path=''):
    """Return an entry path relative to the active search scope."""
    path = str(entry.get('path', '')).replace(os.sep, '/')
    scope = str(scope_path or '').strip('/').replace(os.sep, '/')
    if scope and path.startswith(scope + '/'):
        return path[len(scope) + 1:]
    return path


def entry_matches_name_or_path(entry, search, scope_path=''):
    """Return True when search matches a file name or folder path segment."""
    if not search:
        return True
    query = str(search).lower()
    name = str(entry.get('name', '')).lower()
    path = search_path_for_entry(entry, scope_path).lower()
    return query in name or query in path


def list_files(base_dir, target_path, *, recursive=False, show_hidden=False,
               search='', start_date=None, end_date=None, dirs_only=False):
    """List files and directories under target_path, returning a sorted list of dicts.

    Args:
        base_dir: The root directory (output or input folder).
        target_path: The absolute path to list files from.
        recursive: If True, recurse into subdirectories.
        search: Optional lowercase search string to filter filenames.
        show_hidden: If True, include dotfiles and descend into dot-directories.
        start_date: Optional minimum mtime in ms.
        end_date: Optional maximum mtime in ms.

    Returns:
        A list of dicts, each with keys like name, path, type, size, date, etc.
    """
    IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
    VIDEO_EXTENSIONS = {'.mp4', '.mov', '.webm', '.mkv'}

    results = []

    def process_file(root, filename):
        full_path = os.path.join(root, filename)
        stat = os.stat(full_path)
        mtime_ms = int(stat.st_mtime * 1000)

        if start_date and mtime_ms < int(start_date):
            return None
        if end_date and mtime_ms > int(end_date):
            return None

        rel_path = _rel_fwd(full_path, base_dir)

        if search and not entry_matches_name_or_path(
            {"name": filename, "path": rel_path},
            search,
            _rel_fwd(target_path, base_dir) if target_path != base_dir else "",
        ):
            return None

        ext = os.path.splitext(filename)[1].lower()
        if ext in IMAGE_EXTENSIONS:
            kind = 'image'
        elif ext in VIDEO_EXTENSIONS:
            kind = 'video'
        else:
            return None

        return {
            "name": filename,
            "path": rel_path,
            "type": kind,
            "size": stat.st_size,
            "date": mtime_ms,
            "folder": _rel_fwd(root, base_dir) if root != base_dir else ""
        }

    # Recursive directory-only listing: every descendant folder (name/path/date),
    # used by the move picker's folder search. Cheap single walk — no per-dir
    # file counting.
    if dirs_only:
        scope = _rel_fwd(target_path, base_dir) if target_path != base_dir else ""
        for root, dirs, files in os.walk(target_path):
            if not show_hidden:
                dirs[:] = [d for d in dirs if not d.startswith('.')]
            for name in dirs:
                full_path = os.path.join(root, name)
                try:
                    mtime_ms = int(os.stat(full_path).st_mtime * 1000)
                except OSError:
                    # Dir vanished or is unreadable mid-walk — skip it rather
                    # than failing the whole listing.
                    continue
                if start_date and mtime_ms < int(start_date):
                    continue
                if end_date and mtime_ms > int(end_date):
                    continue
                rel_path = _rel_fwd(full_path, base_dir)
                if search and not entry_matches_name_or_path(
                    {"name": name, "path": rel_path}, search, scope
                ):
                    continue
                results.append({
                    "name": name,
                    "type": "dir",
                    "path": rel_path,
                    "date": mtime_ms,
                })
        # The function contract returns a sorted listing; the early return here
        # must honor it too (dirs sorted by path).
        results.sort(key=lambda item: item['path'].lower())
        return results

    is_flattened = recursive or bool(search) or start_date or end_date

    if is_flattened:
        for root, dirs, files in os.walk(target_path):
            if not show_hidden:
                dirs[:] = [d for d in dirs if not d.startswith('.')]
            for name in files:
                if not show_hidden and name.startswith('.'):
                    continue
                item = process_file(root, name)
                if item:
                    results.append(item)
    else:
        for name in os.listdir(target_path):
            if not show_hidden and name.startswith('.'):
                continue
            full_path = os.path.join(target_path, name)
            if os.path.isdir(full_path):
                try:
                    dir_stat = os.stat(full_path)
                    dir_mtime_ms = int(dir_stat.st_mtime * 1000)
                    dir_mtime_ns = dir_stat.st_mtime_ns
                except OSError:
                    dir_mtime_ms = 0
                    dir_mtime_ns = 0
                count, total_size = folder_stats(full_path, show_hidden, dir_mtime_ns)
                results.append({
                    "name": name,
                    "type": "dir",
                    "path": _rel_fwd(full_path, base_dir),
                    "count": count,
                    "size": total_size,
                    "date": dir_mtime_ms
                })
            else:
                item = process_file(target_path, name)
                if item:
                    results.append(item)

    def sort_key(item):
        is_dir = 0 if item['type'] == 'dir' else 1
        return (is_dir, item['name'].lower())

    results.sort(key=sort_key)
    return results
