import os
import shutil
import time
from urllib.parse import quote as _urlquote


def _reflink(src, dst):
    """Copy-on-write clone via the FICLONE ioctl. Raises OSError when unsupported.

    Preferred over a hard link where the filesystem offers it (btrfs, XFS with
    reflink=1, bcachefs): the clone costs no extra space like a link does, but
    the two paths are independent inodes, so writing one cannot damage the
    other.
    """
    import fcntl

    ficlone = getattr(fcntl, 'FICLONE', 0x40049409)
    try:
        with open(src, 'rb') as src_file, open(dst, 'wb') as dst_file:
            fcntl.ioctl(dst_file.fileno(), ficlone, src_file.fileno())
    except BaseException:
        # Opening dst for writing created it, and os.link won't overwrite —
        # leaving the empty file behind would push every caller to the copy
        # fallback. Clear it before re-raising.
        try:
            os.remove(dst)
        except OSError:
            pass
        raise


def link_or_copy(src, dst):
    """Materialize ``dst`` from ``src`` as a hard link when possible, else a copy.

    A hard link uses no extra disk space and is instant regardless of file size,
    which is ideal for pulling a large output/video back into the input folder.
    It only works when ``src`` and ``dst`` live on the same filesystem/volume and
    that filesystem supports hard links (e.g. NTFS/APFS/ext4 but not FAT/exFAT or
    most network shares), so any ``OSError`` (cross-device ``EXDEV``, unsupported
    FS, permissions) falls back to a real ``shutil.copy2``. An existing ``dst`` is
    replaced. Returns ``'link'`` or ``'copy'`` to indicate which path was taken.
    """
    parent = os.path.dirname(dst)
    if parent:
        os.makedirs(parent, exist_ok=True)
    # If dst already IS src — same path (input dir configured to equal output
    # dir) or an existing hard link to the same inode — it's already
    # materialized. Bail before touching anything: removing dst here would
    # delete the only copy. (A symlink at dst is excluded so it still gets
    # replaced with a real link/copy below.)
    if os.path.exists(dst) and not os.path.islink(dst) and os.path.samefile(src, dst):
        return 'link'
    # Materialize under a temp name, then atomically replace dst. os.link won't
    # overwrite, and removing dst up front would lose the old file if both the
    # link and the copy then failed (disk full, Windows file-in-use).
    tmp = f"{dst}.{os.getpid()}.{time.time_ns()}.tmp"
    try:
        try:
            # A reflink first where the filesystem supports it: same "no extra
            # space" benefit as a hard link, but src and dst are separate
            # inodes. A hard link shares one, so anything that later writes the
            # input path in place (an overwrite upload, a node that edits a
            # file where it sits) would truncate the original output too.
            _reflink(src, tmp)
            # Reported as a link: the caller only distinguishes "no extra disk
            # space" from a real copy.
            result = 'link'
        except (OSError, AttributeError, ImportError):
            try:
                os.link(src, tmp)
                result = 'link'
            except OSError:
                shutil.copy2(src, tmp)
                result = 'copy'
        os.replace(tmp, dst)
        return result
    finally:
        if os.path.lexists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


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


def content_disposition(filename, disposition="inline"):
    """Build a Content-Disposition value naming a response after its real file.

    Endpoints that carry the name in a query param rather than the URL path
    (``/api/video/playable?filename=clip.mp4``) otherwise leave a browser saving
    the file to guess from the last path segment — which is how a saved video
    lands in Downloads as "playable.mp4". ``inline`` keeps in-page playback;
    only the save name changes.

    Header values must stay ASCII and free of controls/quotes, so a name with
    either gets a sanitized fallback plus the RFC 5987 ``filename*`` form that
    modern browsers prefer.
    """
    name = os.path.basename(filename or "").strip()
    if not name:
        return disposition
    ascii_name = "".join(ch if 32 <= ord(ch) < 127 else "_" for ch in name)
    ascii_name = ascii_name.replace('"', "'").replace("\\", "_")
    value = '{}; filename="{}"'.format(disposition, ascii_name)
    if ascii_name != name:
        value += "; filename*=UTF-8''{}".format(_urlquote(name, safe=""))
    return value


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


def _normalize_hidden_paths(hidden_paths):
    return tuple(sorted(p.strip('/') for p in (hidden_paths or []) if p and p.strip('/')))


def _is_manually_hidden_rel_path(rel_path, hidden_paths):
    if not rel_path or not hidden_paths:
        return False
    rel = rel_path.strip('/')
    if rel in hidden_paths:
        return True
    # Walk the path's own ancestors rather than scanning every hidden entry.
    # The scan is O(hidden) per file with a string concatenation each time, and
    # this runs for every file and directory under a folder being sized — a
    # library with a few hidden folders turned a listing into an
    # O(files x hidden) walk. A path has only as many ancestors as it has
    # segments, and membership is a set lookup.
    index = rel.rfind('/')
    while index > 0:
        rel = rel[:index]
        if rel in hidden_paths:
            return True
        index = rel.rfind('/')
    return False


def _compute_folder_stats(base_dir, full_path, show_hidden, hidden_paths=()):
    count = 0
    total_size = 0
    # Set membership, not a linear scan: this is consulted once per walked entry.
    hidden_paths = frozenset(hidden_paths)
    for walk_root, walk_dirs, files in os.walk(full_path):
        if not show_hidden:
            walk_dirs[:] = [
                d for d in walk_dirs
                if not d.startswith('.')
                and not _is_manually_hidden_rel_path(
                    _rel_fwd(os.path.join(walk_root, d), base_dir),
                    hidden_paths,
                )
            ]
        visible_files = [
            f for f in files
            if show_hidden
            or (
                not f.startswith('.')
                and not _is_manually_hidden_rel_path(
                    _rel_fwd(os.path.join(walk_root, f), base_dir),
                    hidden_paths,
                )
            )
        ]
        count += len(visible_files)
        for f in visible_files:
            try:
                total_size += os.path.getsize(os.path.join(walk_root, f))
            except OSError:
                pass
    return count, total_size


def folder_stats(base_dir, full_path, show_hidden, dir_mtime_ns, hidden_paths=()):
    """Recursive (count, total_size) for a folder, memoized. `dir_mtime_ns` is the
    folder's own st_mtime_ns; a change invalidates the cache, and a short TTL
    backstops deep-subtree changes that don't bump the top folder's mtime."""
    normalized_hidden_paths = _normalize_hidden_paths(hidden_paths)
    key = (full_path, bool(show_hidden), normalized_hidden_paths)
    now = time.monotonic()
    cached = _FOLDER_STATS_CACHE.get(key)
    if cached is not None:
        c_mtime, c_deadline, c_count, c_size = cached
        if c_mtime == dir_mtime_ns and now < c_deadline:
            return c_count, c_size
    count, total_size = _compute_folder_stats(
        base_dir,
        full_path,
        show_hidden,
        normalized_hidden_paths,
    )
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
               search='', start_date=None, end_date=None, dirs_only=False,
               hidden_paths=None):
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
    VIDEO_EXTENSIONS = {'.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'}

    results = []
    # Membership is consulted once per walked entry, so keep it a set rather
    # than scanning the whole hidden list for each one.
    normalized_hidden_paths = frozenset(_normalize_hidden_paths(hidden_paths))

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

        if not show_hidden and _is_manually_hidden_rel_path(rel_path, normalized_hidden_paths):
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
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith('.')
                    and not _is_manually_hidden_rel_path(
                        _rel_fwd(os.path.join(root, d), base_dir),
                        normalized_hidden_paths,
                    )
                ]
            for name in dirs:
                full_path = os.path.join(root, name)
                rel_path = _rel_fwd(full_path, base_dir)
                if not show_hidden and _is_manually_hidden_rel_path(rel_path, normalized_hidden_paths):
                    continue
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
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith('.')
                    and not _is_manually_hidden_rel_path(
                        _rel_fwd(os.path.join(root, d), base_dir),
                        normalized_hidden_paths,
                    )
                ]
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
            rel_path = _rel_fwd(full_path, base_dir)
            if not show_hidden and _is_manually_hidden_rel_path(rel_path, normalized_hidden_paths):
                continue
            if os.path.isdir(full_path):
                try:
                    dir_stat = os.stat(full_path)
                    dir_mtime_ms = int(dir_stat.st_mtime * 1000)
                    dir_mtime_ns = dir_stat.st_mtime_ns
                except OSError:
                    dir_mtime_ms = 0
                    dir_mtime_ns = 0
                count, total_size = folder_stats(
                    base_dir,
                    full_path,
                    show_hidden,
                    dir_mtime_ns,
                    normalized_hidden_paths,
                )
                results.append({
                    "name": name,
                    "type": "dir",
                    "path": rel_path,
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
