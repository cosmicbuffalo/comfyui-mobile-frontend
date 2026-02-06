import os


def list_files(base_dir, target_path, *, recursive=False, show_hidden=False,
               search='', start_date=None, end_date=None):
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

        if search and search.lower() not in filename.lower():
            return None

        rel_path = os.path.relpath(full_path, base_dir)

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
            "folder": os.path.relpath(root, base_dir) if root != base_dir else ""
        }

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
                count = 0
                for _, walk_dirs, files in os.walk(full_path):
                    if not show_hidden:
                        walk_dirs[:] = [d for d in walk_dirs if not d.startswith('.')]
                    count += len([f for f in files if show_hidden or not f.startswith('.')])

                results.append({
                    "name": name,
                    "type": "dir",
                    "path": os.path.relpath(full_path, base_dir),
                    "count": count,
                    "date": int(os.stat(full_path).st_mtime * 1000)
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
