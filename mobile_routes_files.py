"""File browser & mutation routes.

List, delete, state, hidden/favorites shims, move, mkdir, rename, and
workflow-folder management. Split out of ``__init__.py`` — handler bodies
are unchanged; only location and registration moved.
"""

import asyncio
import os
import shutil

import folder_paths
import file_utils as _file_utils
import mobile_auth as _mobile_auth
import mobile_file_state as _mobile_file_state
import mobile_input_aliases as _mobile_input_aliases
from aiohttp import web
from file_utils import entry_matches_name_or_path, is_within_dir as _is_within_dir, list_files, safe_join as _safe_join
from mobile_metadata import get_cached_prompt_text
from mobile_common import (
    _ASSET_SOURCES,
    FILE_STATE_CACHE_PATH,
    _safe_int,
    _source_base_dir,
)
def _may_modify(path: str, viewer=None) -> bool:
    """Whether this viewer may write to a path.

    A directory is writable when everything under it is: a delete or a move
    that would take someone else's file with it is refused whole rather than
    half-applied.
    """
    if not _mobile_auth.is_enabled():
        return True
    if not os.path.isdir(path):
        return _mobile_auth.can_modify_file(path, user=viewer)
    for root, _dirs, files in os.walk(path):
        for name in files:
            if not _mobile_auth.can_modify_file(os.path.join(root, name), user=viewer):
                return False
    return True


# How many files to look at before giving an unassigned folder the benefit of
# the doubt. A folder is kept the moment one visible file is found, so this only
# bounds the cost of folders holding nothing the viewer may see.
_ISOLATED_FOLDER_SCAN_CAP = 400


def _is_isolated(viewer) -> bool:
    return bool(viewer) and 'isolated' in {
        r.casefold() for r in (viewer.get('roles') or [])
    }


def _holds_anything_visible(dir_path: str, viewer) -> bool:
    """Whether an unassigned folder holds a single file this viewer may read.

    Folders without an ownership assignment pass through for ordinary accounts,
    which is what keeps ad-hoc subfolders navigable. An `isolated` account is
    the exception -- the role means "sees only its own", and a folder whose
    every file is refused should not sit in the listing advertising its name.
    """
    seen = 0
    for root, _dirs, files in os.walk(dir_path):
        for name in files:
            if seen >= _ISOLATED_FOLDER_SCAN_CAP:
                return True
            seen += 1
            if _mobile_auth.can_read_file(os.path.join(root, name), user=viewer):
                return True
    # An empty folder holds nothing to hide, and hiding it breaks the one that
    # matters most: a folder the viewer has just made, which is empty by
    # definition and would vanish the moment it was created.
    return seen == 0


def _is_admin(viewer) -> bool:
    return bool(viewer) and 'admin' in {
        r.casefold() for r in (viewer.get('roles') or [])
    }


def _filter_by_ownership(results, source, base_dir, viewer, include_shared):
    """Drop what this viewer may not see, and badge what is left.

    Files are filtered by the same rule that guards their bytes, so a listing
    can never name a file the viewer would be refused. Folders carry
    assignments of their own — the nearest assigned ancestor decides, and an
    unassigned folder passes through, which keeps ad-hoc subfolders navigable.

    A no-op when the auth node is absent: `is_enabled()` is False and the
    listing behaves exactly as it did before.
    """
    if not _mobile_auth.is_enabled():
        return results

    viewer_is_admin = _is_admin(viewer)
    files = [r for r in results if r.get('type') != 'dir']
    by_path = {os.path.join(base_dir, r['path']): r for r in files}

    if source == 'output':
        # Outputs: ownership is the boundary, and unowned is admin-only.
        allowed = set(_mobile_auth.filter_files(list(by_path), user=viewer))
    elif viewer_is_admin:
        allowed = set(by_path)
    else:
        # Inputs and temp invert the unowned rule: the pre-existing shared pool
        # stays visible (hiding it would empty every LoadImage picker), and
        # only another user's private upload drops out. An `isolated` account
        # is the exception again -- the shared pool is still other people's
        # files, and the role says it sees only its own.
        viewer_is_isolated = _is_isolated(viewer)
        allowed = set()
        for full_path in by_path:
            badge = _mobile_auth.badge_for_file(full_path, user=viewer)
            if viewer_is_isolated:
                if badge and badge.get('owned'):
                    allowed.add(full_path)
                continue
            if (badge and not badge.get('owned') and not badge.get('globe')
                    and badge.get('avatarUserId')):
                continue
            allowed.add(full_path)

    # A soft delete is gone from THIS viewer's filesystem: a non-owner's delete
    # lands there rather than on disk, and honoring it is what makes it real.
    allowed -= set(_mobile_auth.virtually_deleted_paths(list(allowed), user=viewer))

    for full_path, entry in by_path.items():
        if full_path not in allowed:
            continue
        badge = _mobile_auth.badge_for_file(full_path, user=viewer)
        if badge:
            entry['ownership'] = badge
        # Sharing not opted into: drop everything that is not the viewer's own.
        # Admins always see all — they are operating, not browsing.
        if (not include_shared and source == 'output' and not viewer_is_admin
                and badge and not badge.get('owned')):
            allowed.discard(full_path)

    dir_entries = [r for r in results if r.get('type') == 'dir']
    dropped_dirs = set()
    if dir_entries and source in ('output', 'input'):
        dir_badges = _mobile_auth.folder_badges(
            [r['path'] for r in dir_entries], tree=source, user=viewer)
        viewer_is_isolated = _is_isolated(viewer)
        for r in dir_entries:
            badge = dir_badges.get(r['path'])
            if not badge:
                # No verdict: normally pass through. For an isolated viewer,
                # keep it only if there is something inside to come for.
                if viewer_is_isolated and not _holds_anything_visible(
                        os.path.join(base_dir, r['path']), viewer):
                    dropped_dirs.add(r['path'])
                continue
            if not badge.get('visible'):
                dropped_dirs.add(r['path'])
                continue
            if (not include_shared and source == 'output'
                    and not viewer_is_admin and not badge.get('owned')):
                dropped_dirs.add(r['path'])
                continue
            r['ownership'] = {
                'globe': badge.get('globe', False),
                'owned': badge.get('owned', False),
                'avatarUserId': badge.get('avatarUserId'),
            }

    return [
        r for r in results
        if (r.get('type') == 'dir' and r['path'] not in dropped_dirs)
        or (r.get('type') != 'dir'
            and os.path.join(base_dir, r['path']) in allowed)
    ]


async def api_list_files(request):
    try:
        query = request.rel_url.query
        source = query.get('source', 'output')
        if source not in _ASSET_SOURCES:
            return web.json_response({"error": "source must be output/input/temp"}, status=400)
        base_dir = _source_base_dir(source)
        subpath = query.get('path', '')
        recursive = query.get('recursive', 'false').lower() == 'true'
        dirs_only = query.get('dirsOnly', 'false').lower() == 'true'
        show_hidden = query.get('showHidden', 'false').lower() == 'true'
        search = query.get('search', '').lower()
        prompt_search = query.get('prompt', '').lower()
        # `q` is a combined-search query that matches filename OR embedded
        # prompt JSON. Implies recursion. Used by the outputs panel's
        # "search prompts" submit flow so a single query string finds
        # results across both naming conventions and prompt content.
        combined_search = query.get('q', '').lower()
        start_date = query.get('startDate') # ms timestamp
        end_date = query.get('endDate')     # ms timestamp
        limit = _safe_int(query.get('limit'), 0)
        offset = _safe_int(query.get('offset'), 0)

        include_shared = query.get('includeShared', 'true').lower() != 'false'

        # Security check for path traversal
        target_path = _safe_join(base_dir, subpath)
        if target_path is None:
            return web.json_response({"error": "Access denied"}, status=403)

        # Resolved HERE rather than inside the listing thread: the auth node
        # reads the viewer from a ContextVar, and run_in_executor does not
        # propagate one — resolving it there yields None, which the ownership
        # filter reads as "hide everything". None here just means auth is off.
        viewer = _mobile_auth.current_user()

        if not os.path.exists(target_path):
            return web.json_response({"error": "Path not found"}, status=404)

        # All of the filesystem work below — the recursive walk in list_files,
        # the per-file PNG-metadata reads for prompt/combined search, and the
        # hidden-state pass — is synchronous and can be heavy on a large
        # outputs folder. Run it in a thread so it never blocks the aiohttp
        # event loop (which would freeze queue progress, websockets, and every
        # other client for the duration of a search/listing).
        def _build_listing():
            # Manual hidden-state needs to be known before list_files walks
            # the tree so recursive folder counts exclude hidden descendants
            # in the same way the final listing does.
            # Only verified current hidden paths may be used to pre-filter
            # exact files. Directory inheritance remains path-based via
            # hidden_set, while a replaced file at an old hidden path is
            # retained for content-aware annotation below.
            # One load, one verification pass: the verified paths pre-filter
            # exact files while the directory paths carry inheritance, and
            # fetching them separately parsed the state file twice per
            # listing (it reaches 350KB+ on a well-used install).
            verified_hidden, hidden_set = _mobile_file_state.get_hidden_listing_view(
                FILE_STATE_CACHE_PATH,
                source,
                base_dir,
            )
            verified_hidden_set = set(verified_hidden)
            # `search` already filters by filename inside list_files. For the
            # combined `q` case we want the union (filename OR prompt match),
            # so don't pre-filter by filename here — apply both checks after.
            results = list_files(
                base_dir, target_path,
                recursive=recursive or bool(prompt_search) or bool(combined_search),
                show_hidden=show_hidden,
                search='' if combined_search else search,
                start_date=start_date,
                end_date=end_date,
                dirs_only=dirs_only,
                hidden_paths=verified_hidden_set
            )
            if source == 'input':
                # Alias files must remain at the input root so stock Load Image
                # accepts them, but they are implementation details and should
                # never be moved or deleted through the mobile file browser.
                results = [
                    r for r in results
                    if not (r.get('path') or '').startswith(_mobile_input_aliases.ALIAS_PREFIX)
                ]

            # Additional prompt search filter (requires reading image metadata).
            # Backed by an mtime-keyed in-memory cache so repeat searches don't
            # re-open every file. Matches the lowercased prompt JSON text as a
            # substring against the lowercased query.
            if prompt_search:
                results = [
                    r for r in results
                    if prompt_search in get_cached_prompt_text(os.path.join(base_dir, r['path']))
                ]

            # Combined search: filename OR prompt JSON match.
            if combined_search:
                def matches_combined(entry):
                    if entry_matches_name_or_path(entry, combined_search, subpath):
                        return True
                    return combined_search in get_cached_prompt_text(
                        os.path.join(base_dir, entry['path'])
                    )
                results = [r for r in results if matches_combined(r)]

            # Dot-prefixed segments are always hidden, independent of any
            # manual state — annotate this first so it's visible even when
            # show_hidden=True (list_files already excludes dot-hidden
            # entries when show_hidden=False, so this only ever matters for
            # display in the show_hidden=True case).
            for r in results:
                rel = r.get('path', '')
                if rel and any(seg.startswith('.') for seg in rel.split('/')):
                    r['hidden'] = True

            # Single content-hash-aware pass: sets favorite/rejected/
            # hiddenSelf/hidden flags, rediscovers entries whose file moved
            # externally, and applies hidden's folder inheritance via
            # hidden_set. Do not prune missing paths here: a listing is a
            # read, and folders can be transiently absent while external
            # tools move/mount/generate them.
            _mobile_file_state.annotate_listing(
                FILE_STATE_CACHE_PATH,
                source,
                base_dir,
                results,
                hidden_set,
            )
            if not show_hidden:
                results = [r for r in results if not r.get('hidden')]

            # Ownership last: everything above it is presentation, this is the
            # access boundary. Without it the listing walks the tree off disk
            # and hands every account the whole thing — names, sizes and folder
            # structure — even though the bytes behind them are refused.
            results = _filter_by_ownership(results, source, base_dir, viewer,
                                           include_shared)

            total = len(results)
            if limit > 0:
                results = results[offset:offset+limit]
            return results, total

        loop = asyncio.get_event_loop()
        results, total = await loop.run_in_executor(None, _build_listing)

        return web.json_response({
            "files": results,
            "total": total,
            "offset": offset,
            "limit": limit
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_delete_file(request):
    try:
        data = await request.json()
        filepath = data.get('path')
        source = data.get('source', 'output')
        if not filepath:
            return web.json_response({"error": "No path provided"}, status=400)
        if source not in _ASSET_SOURCES:
            return web.json_response({"error": "source must be output/input/temp"}, status=400)
        
        base_dir = _source_base_dir(source)
        target_path = _safe_join(base_dir, filepath)

        if target_path is None:
            return web.json_response({"error": "Access denied"}, status=403)
        
        # Refuse to delete the source root itself ({"path": "."} resolves
        # to the base dir and would rmtree the whole output/input tree).
        if os.path.realpath(target_path) == os.path.realpath(base_dir):
            return web.json_response({"error": "Access denied"}, status=403)

        # Ownership, not just path traversal: without this any signed-in
        # account could delete another user's outputs through this endpoint.
        if not _may_modify(target_path, _mobile_auth.current_user()):
            return web.json_response({"error": "Access denied"}, status=403)

        def _delete_target():
            # Recursive folder deletes are O(files) of disk work; run off
            # the event loop so they don't freeze every other request
            # (including generation progress websockets).
            if not os.path.exists(target_path):
                return False
            removal_plan = _mobile_file_state.plan_remove_path(
                FILE_STATE_CACHE_PATH,
                source,
                base_dir,
                filepath,
            )
            if os.path.isdir(target_path):
                shutil.rmtree(target_path)
            else:
                os.remove(target_path)
            # Remove only identities verified at this path before deletion.
            # A moved original whose old name was reused keeps its state.
            _mobile_file_state.remove_path(
                FILE_STATE_CACHE_PATH,
                source,
                filepath,
                removal_plan,
            )
            return True

        loop = asyncio.get_event_loop()
        deleted = await loop.run_in_executor(None, _delete_target)
        if deleted:
            return web.json_response({"success": True})
        return web.json_response({"error": "File not found"}, status=404)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_get_file_state(request):
    try:
        source = request.rel_url.query.get('source', 'output')
        if source not in _ASSET_SOURCES:
            return web.json_response({"error": "source must be output/input/temp"}, status=400)
        base_dir = _source_base_dir(source)
        loop = asyncio.get_event_loop()
        state = await loop.run_in_executor(
            None,
            _mobile_file_state.get_all,
            FILE_STATE_CACHE_PATH,
            source,
            base_dir,
        )
        return web.json_response(state)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_set_file_state(request):
    try:
        data = await request.json()
        path = data.get('path')
        source = data.get('source', 'output')
        state = data.get('state')
        value = data.get('value')
        if not path:
            return web.json_response({"error": "No path provided"}, status=400)
        if state not in _mobile_file_state.STATES:
            return web.json_response({"error": "state must be one of favorite/reject/hidden"}, status=400)
        if not isinstance(value, bool):
            return web.json_response({"error": "value must be a boolean"}, status=400)
        if source not in _ASSET_SOURCES:
            return web.json_response({"error": "source must be output/input/temp"}, status=400)
        base_dir = _source_base_dir(source)
        target_path = _safe_join(base_dir, path)
        if target_path is None:
            return web.json_response({"error": "Access denied"}, status=403)
        loop = asyncio.get_event_loop()
        applied = await loop.run_in_executor(
            None,
            _mobile_file_state.set_state,
            FILE_STATE_CACHE_PATH,
            source,
            state,
            base_dir,
            path,
            value,
        )
        if not applied:
            if state == 'reject' and os.path.isdir(target_path):
                return web.json_response({"error": "Directories cannot be rejected"}, status=400)
            return web.json_response(
                {"error": "File is not ready or changed while being read; retry"},
                status=409,
            )
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# --- Temporary back-compat shims for the old three routes (§7/§14 of the
# file-state spec) — forward to the unified module so a stale client or
# bookmarked call keeps working across the transition. Remove once no
# shipped client calls them.
async def api_set_hidden(request):
    try:
        data = await request.json()
        path = data.get('path')
        source = data.get('source', 'output')
        hidden = bool(data.get('hidden'))
        if not path:
            return web.json_response({"error": "No path provided"}, status=400)
        if source not in _ASSET_SOURCES:
            return web.json_response({"error": "source must be output/input/temp"}, status=400)
        base_dir = _source_base_dir(source)
        target_path = _safe_join(base_dir, path)
        if target_path is None:
            return web.json_response({"error": "Access denied"}, status=403)
        # Hiding is a declutter toggle rather than access control, so reading
        # is the right bar: you may fold away anything you can see. (Per-viewer
        # hidden state, so one account's toggle cannot reach another's listing,
        # is the multiuser-auth branch's answer and is not ported here.)
        if (_mobile_auth.is_enabled() and os.path.isfile(target_path)
                and not _mobile_auth.can_read_file(target_path,
                                                   user=_mobile_auth.current_user())):
            return web.json_response({"error": "Access denied"}, status=403)
        loop = asyncio.get_event_loop()
        applied = await loop.run_in_executor(
            None,
            _mobile_file_state.set_state,
            FILE_STATE_CACHE_PATH,
            source,
            'hidden',
            base_dir,
            path,
            hidden,
        )
        if not applied:
            return web.json_response(
                {"error": "File is not ready or changed while being read; retry"},
                status=409,
            )
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_get_file_favorites(request):
    try:
        source = request.rel_url.query.get('source', 'output')
        if source not in _ASSET_SOURCES:
            return web.json_response({"error": "source must be output/input/temp"}, status=400)
        base_dir = _source_base_dir(source)
        loop = asyncio.get_event_loop()
        favorites = await loop.run_in_executor(
            None,
            _mobile_file_state.get_paths,
            FILE_STATE_CACHE_PATH,
            source,
            'favorite',
            base_dir,
        )
        return web.json_response({"favorites": favorites})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_set_file_favorite(request):
    try:
        data = await request.json()
        path = data.get('path')
        source = data.get('source', 'output')
        favorite = data.get('favorite')
        if not path:
            return web.json_response({"error": "No path provided"}, status=400)
        if not isinstance(favorite, bool):
            return web.json_response({"error": "favorite must be a boolean"}, status=400)
        if source not in _ASSET_SOURCES:
            return web.json_response({"error": "source must be output/input/temp"}, status=400)
        base_dir = _source_base_dir(source)
        target_path = _safe_join(base_dir, path)
        if target_path is None:
            return web.json_response({"error": "Access denied"}, status=403)
        loop = asyncio.get_event_loop()
        applied = await loop.run_in_executor(
            None,
            _mobile_file_state.set_state,
            FILE_STATE_CACHE_PATH,
            source,
            'favorite',
            base_dir,
            path,
            favorite,
        )
        if not applied:
            return web.json_response(
                {"error": "File is not ready or changed while being read; retry"},
                status=409,
            )
        favorites = await loop.run_in_executor(
            None,
            _mobile_file_state.get_paths,
            FILE_STATE_CACHE_PATH,
            source,
            'favorite',
            base_dir,
        )
        return web.json_response({"favorites": favorites})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_move_files(request):
    try:
        data = await request.json()
        sources = data.get('sources')
        destination = data.get('destination', '')
        source = data.get('source', 'output')
        resolutions = data.get('resolutions')
        if not isinstance(resolutions, dict):
            resolutions = {}
        if not sources or not isinstance(sources, list):
            return web.json_response({"error": "No sources provided"}, status=400)

        base_dir = _source_base_dir(source)
        dest_path = _safe_join(base_dir, destination)
        if dest_path is None:
            return web.json_response({"error": "Access denied"}, status=403)
        if not os.path.exists(dest_path):
            return web.json_response({"error": "Destination not found"}, status=404)
        if not os.path.isdir(dest_path):
            return web.json_response({"error": "Destination must be a folder"}, status=400)

        # Validate every path on the loop; do the disk work in an executor —
        # a move can degrade to a full copy+delete across mounts and would
        # otherwise block every other request for its duration.
        asset_source = source
        move_specs = []
        move_viewer = _mobile_auth.current_user()
        for rel in sources:
            src_path = _safe_join(base_dir, rel)
            if src_path is None:
                return web.json_response({"error": "Access denied"}, status=403)
            if not _may_modify(src_path, move_viewer):
                return web.json_response({"error": "Access denied"}, status=403)
            move_specs.append((rel, src_path))

        # One planning pass decides every final name; the move pass just
        # executes it. Keeping the "what would collide" and "what actually
        # lands where" answers in one function is what stops the two from
        # ever drifting apart.
        loop = asyncio.get_event_loop()
        plan, conflicts = await loop.run_in_executor(
            None, _file_utils.plan_moves, move_specs, dest_path, resolutions
        )
        if conflicts:
            # Nothing has been moved yet. The client collects a resolution
            # per conflicting path and resubmits the whole request.
            return web.json_response({"error": "conflict", "conflicts": conflicts}, status=409)

        def _move_all():
            for rel, src_path, basename in plan:
                if not os.path.exists(src_path):
                    continue
                target = os.path.join(dest_path, basename)
                shutil.move(src_path, target)
                # Keep hidden state attached to the item across the move.
                new_rel = os.path.relpath(target, os.path.abspath(base_dir))
                _mobile_file_state.rename_path(
                    FILE_STATE_CACHE_PATH,
                    asset_source,
                    rel,
                    new_rel,
                    base_dir,
                )

        await loop.run_in_executor(None, _move_all)

        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

def _resolve_workflows_path(rel_path):
    """Resolve a path under the (default) user's workflows dir, guarding
    against traversal. Returns (abs_path, base_dir) or (None, base_dir)."""
    base_dir = os.path.realpath(
        os.path.join(folder_paths.get_user_directory(), 'default', 'workflows')
    )
    # realpath (not abspath) so a symlink inside the workflows dir can't
    # point destructive operations outside the sandbox.
    target = os.path.realpath(os.path.join(base_dir, rel_path))
    # Must stay strictly inside the workflows dir (never the dir itself).
    if target == base_dir or os.path.commonpath([base_dir, target]) != base_dir:
        return None, base_dir
    return target, base_dir

async def api_create_workflow_folder(request):
    try:
        data = await request.json()
        path = (data.get('path') or '').strip().strip('/')
        if not path:
            return web.json_response({"error": "No path provided"}, status=400)
        target, _ = _resolve_workflows_path(path)
        if target is None:
            return web.json_response({"error": "Access denied"}, status=403)
        if os.path.exists(target):
            return web.json_response({"error": "A file or folder with that name already exists"}, status=409)
        os.makedirs(target, exist_ok=False)
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_delete_workflow_folder(request):
    try:
        path = (request.query.get('path') or '').strip().strip('/')
        if not path:
            return web.json_response({"error": "No path provided"}, status=400)
        target, _ = _resolve_workflows_path(path)
        if target is None:
            return web.json_response({"error": "Access denied"}, status=403)
        if not os.path.isdir(target):
            return web.json_response({"error": "Folder not found"}, status=404)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, shutil.rmtree, target)
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_mkdir(request):
    try:
        data = await request.json()
        path = data.get('path')
        source = data.get('source', 'output')
        if not path:
            return web.json_response({"error": "No path provided"}, status=400)

        base_dir = _source_base_dir(source)
        target_path = _safe_join(base_dir, path)
        if target_path is None:
            return web.json_response({"error": "Access denied"}, status=403)

        os.makedirs(target_path, exist_ok=True)
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_rename_file(request):
    try:
        data = await request.json()
        path = data.get('path')
        new_name = (data.get('newName') or '').strip()
        source = data.get('source', 'output')

        if not path:
            return web.json_response({"error": "No path provided"}, status=400)
        if not new_name:
            return web.json_response({"error": "No new name provided"}, status=400)
        if '/' in new_name or '\\' in new_name or new_name in ('.', '..'):
            return web.json_response({"error": "Invalid name"}, status=400)

        base_dir = _source_base_dir(source)
        src_path = _safe_join(base_dir, path)
        if src_path is None:
            return web.json_response({"error": "Access denied"}, status=403)
        if not os.path.exists(src_path):
            return web.json_response({"error": "Source not found"}, status=404)
        if not _may_modify(src_path, _mobile_auth.current_user()):
            return web.json_response({"error": "Access denied"}, status=403)

        dst_path = os.path.abspath(os.path.join(os.path.dirname(src_path), new_name))
        if not _is_within_dir(base_dir, dst_path):
            return web.json_response({"error": "Access denied"}, status=403)
        if os.path.exists(dst_path):
            return web.json_response({"error": "A file or folder with that name already exists"}, status=409)

        os.rename(src_path, dst_path)
        # Keep hidden state attached to the item across the rename.
        new_rel = os.path.relpath(dst_path, os.path.abspath(base_dir))
        _mobile_file_state.rename_path(
            FILE_STATE_CACHE_PATH,
            source,
            path,
            new_rel,
            base_dir,
        )
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


def register_routes(mobile_app):
    """Register the file browser/mutation routes on the mobile sub-app."""
    mobile_app.router.add_get('/api/files', api_list_files)
    mobile_app.router.add_delete('/api/files', api_delete_file)
    mobile_app.router.add_get('/api/files/state', api_get_file_state)
    mobile_app.router.add_post('/api/files/state', api_set_file_state)
    # does, so they stay until that branch moves over.
    mobile_app.router.add_post('/api/files/hidden', api_set_hidden)
    mobile_app.router.add_get('/api/files/favorites', api_get_file_favorites)
    mobile_app.router.add_post('/api/files/favorites', api_set_file_favorite)
    mobile_app.router.add_post('/api/files/move', api_move_files)
    mobile_app.router.add_post('/api/files/mkdir', api_mkdir)
    mobile_app.router.add_post('/api/files/rename', api_rename_file)
    mobile_app.router.add_post('/api/workflows/folder', api_create_workflow_folder)
    mobile_app.router.add_delete('/api/workflows/folder', api_delete_workflow_folder)