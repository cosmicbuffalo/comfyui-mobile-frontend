import { useEffect, useMemo, useState } from 'react';
import {
  WorkflowIcon,
  FolderIcon,
  PlusIcon,
  EyeIcon,
  EyeOffIcon,
  BookmarkIconSvg,
  BookmarkOutlineIcon,
  EditIcon,
  MoveUpDownIcon,
  TrashIcon,
} from '@/components/icons';
import { SearchBar } from '@/components/SearchBar';
import { LoadingSpinner } from '../LoadingSpinner';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import { Dialog } from '@/components/modals/Dialog';
import { type ContextMenuItemDefinition } from '@/components/menus/ContextMenuBuilder';
import { useWorkflowFavoritesStore } from '@/hooks/useWorkflowFavorites';
import { useWorkflowHiddenStore } from '@/hooks/useWorkflowHidden';
import {
  createUserWorkflowFolder,
  deleteUserWorkflow,
  deleteUserWorkflowFolder,
  renameUserWorkflowEntry,
  type UserDataFile,
} from '@/api/client';
import { formatRelativeDate } from './formatRelativeDate';
import {
  getRelativePath,
  getDirectChildren,
  getWorkflowMoveDestinationPath,
  filterHiddenWorkflows,
  filterFavoriteWorkflows,
  buildFolderModifiedMap,
} from './userWorkflowHelpers';
import {
  menuInputClassName,
  menuMutedTextClassName,
  menuSmallIconClassName,
  menuSurfaceClassName,
  menuTextClassName,
} from './menuStyles';
import { RowActionsMenu } from './UserWorkflowsPanel/RowActionsMenu';
import { NameDialog } from './UserWorkflowsPanel/NameDialog';
import { WorkflowMoveDialog } from './UserWorkflowsPanel/WorkflowMoveDialog';

interface UserWorkflowsPanelProps {
  error: string | null;
  loading: boolean;
  userWorkflows: UserDataFile[];
  onBack: () => void;
  onDismissError: () => void;
  onLoadWorkflow: (filename: string) => void;
  onRefresh: () => void;
}


export function UserWorkflowsPanel({
  error,
  loading,
  userWorkflows,
  onBack,
  onDismissError,
  onLoadWorkflow,
  onRefresh,
}: UserWorkflowsPanelProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date'>('name');
  const [currentFolder, setCurrentFolder] = useState('workflows');
  const [showHidden, setShowHidden] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<UserDataFile | null>(null);
  const [moveTarget, setMoveTarget] = useState<UserDataFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserDataFile | null>(null);

  const favorites = useWorkflowFavoritesStore((s) => s.favorites);
  const toggleFavorite = useWorkflowFavoritesStore((s) => s.toggleFavorite);
  const renameFavorite = useWorkflowFavoritesStore((s) => s.renameFavorite);
  const removeFavoritesUnder = useWorkflowFavoritesStore((s) => s.removeFavoritesUnder);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const hidden = useWorkflowHiddenStore((s) => s.hidden);
  const toggleHidden = useWorkflowHiddenStore((s) => s.toggleHidden);
  const renameHidden = useWorkflowHiddenStore((s) => s.renameHidden);
  const removeHiddenUnder = useWorkflowHiddenStore((s) => s.removeHiddenUnder);
  const syncHiddenFromServer = useWorkflowHiddenStore((s) => s.syncFromServer);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  useEffect(() => {
    void syncHiddenFromServer();
  }, [syncHiddenFromServer]);

  // Folder dates = most recent modified time of the folder or any descendant.
  const folderModifiedMap = useMemo(
    () => buildFolderModifiedMap(userWorkflows),
    [userWorkflows],
  );

  const isSearching = search.trim().length > 0;

  const visibleItems = useMemo(() => {
    const base = isSearching
      ? userWorkflows.filter(
          (file) =>
            file.type === 'file' && file.name.toLowerCase().includes(search.toLowerCase()),
        )
      : getDirectChildren(userWorkflows, currentFolder);
    let result = filterHiddenWorkflows(base, showHidden, hidden);
    if (favoritesOnly) result = filterFavoriteWorkflows(result, favorites);
    return result;
  }, [isSearching, userWorkflows, search, currentFolder, showHidden, favoritesOnly, favorites, hidden]);

  const sortedItems = useMemo(
    () =>
      [...visibleItems].sort((a, b) => {
        if (!isSearching) {
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
        }
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        const am = (a.type === 'directory' ? folderModifiedMap.get(a.path) : a.modified) ?? 0;
        const bm = (b.type === 'directory' ? folderModifiedMap.get(b.path) : b.modified) ?? 0;
        return bm - am;
      }),
    [visibleItems, isSearching, sortBy, folderModifiedMap],
  );

  const isInSubfolder = currentFolder !== 'workflows';

  const handleBack = () => {
    if (isSearching) {
      setSearch('');
    } else if (isInSubfolder) {
      setCurrentFolder(currentFolder.substring(0, currentFolder.lastIndexOf('/')));
    } else {
      onBack();
    }
  };

  const folderDisplayName = isSearching
    ? 'Search Results'
    : isInSubfolder
      ? currentFolder.substring(currentFolder.lastIndexOf('/') + 1)
      : 'My Workflows';

  // Path of the current folder relative to the workflows root ('' at root).
  const currentRelDir = currentFolder.replace(/^workflows\/?/, '');

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
      onRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed');
    }
  };

  const handleCreateFolder = (name: string) => {
    setAddFolderOpen(false);
    const relPath = [currentRelDir, name].filter(Boolean).join('/');
    void runAction(() => createUserWorkflowFolder(relPath));
  };

  const handleRename = (target: UserDataFile, rawName: string) => {
    setRenameTarget(null);
    const fromRel = getRelativePath(target);
    const parent = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '';
    const finalName = target.type === 'file' ? rawName.replace(/\.json$/i, '') + '.json' : rawName;
    const toRel = [parent, finalName].filter(Boolean).join('/');
    if (toRel === fromRel) return;
    void runAction(async () => {
      await renameUserWorkflowEntry(fromRel, toRel);
      renameFavorite(fromRel, toRel);
      renameHidden(fromRel, toRel);
    });
  };

  const handleDelete = (target: UserDataFile) => {
    setDeleteTarget(null);
    const rel = getRelativePath(target);
    void runAction(async () => {
      if (target.type === 'directory') {
        await deleteUserWorkflowFolder(rel);
      } else {
        await deleteUserWorkflow(rel);
      }
      removeFavoritesUnder(rel);
      removeHiddenUnder(rel);
    });
  };

  const handleMove = (target: UserDataFile, destinationDirectory: string) => {
    setMoveTarget(null);
    const fromRel = getRelativePath(target);
    const toRel = getWorkflowMoveDestinationPath(target, destinationDirectory);
    if (toRel === fromRel) return;
    void runAction(async () => {
      await renameUserWorkflowEntry(fromRel, toRel);
      renameFavorite(fromRel, toRel);
      renameHidden(fromRel, toRel);
    });
  };

  const buildRowMenu = (file: UserDataFile): ContextMenuItemDefinition[] => {
    const rel = getRelativePath(file);
    const isBookmarked = favoriteSet.has(rel);
    const isHidden = hiddenSet.has(rel);
    return [
      {
        key: 'bookmark',
        label: isBookmarked ? 'Remove bookmark' : 'Bookmark',
        icon: isBookmarked ? (
          <BookmarkIconSvg className="w-4 h-4 text-amber-500" />
        ) : (
          <BookmarkOutlineIcon className="w-4 h-4" />
        ),
        onClick: () => toggleFavorite(rel),
      },
      {
        key: 'hide',
        label: isHidden ? 'Unhide' : 'Hide',
        icon: isHidden ? (
          <EyeIcon className="w-4 h-4" />
        ) : (
          <EyeOffIcon className="w-4 h-4" />
        ),
        onClick: () => toggleHidden(rel),
        // Dot-prefixed entries are hidden by convention; this action only governs
        // manually-marked hidden state, so don't offer it for them.
        hidden: file.name.startsWith('.'),
      },
      {
        key: 'rename',
        label: 'Rename',
        icon: <EditIcon className="w-4 h-4" />,
        onClick: () => setRenameTarget(file),
      },
      {
        key: 'move',
        label: 'Move',
        icon: <MoveUpDownIcon className="w-4 h-4" />,
        onClick: () => setMoveTarget(file),
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: <TrashIcon className="w-4 h-4" />,
        color: 'danger',
        onClick: () => setDeleteTarget(file),
      },
    ];
  };

  const sortButton = (
    <button
      onClick={() => setSortBy(sortBy === 'name' ? 'date' : 'name')}
      className="flex items-center gap-0.5 text-xs font-semibold text-cyan-300"
    >
      <span>{sortBy === 'name' ? 'NAME' : 'DATE'}</span>
      <span>↓</span>
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title={folderDisplayName} onBack={handleBack} rightElement={sortButton} />
      <MenuErrorNotice
        error={actionError ?? error}
        onDismiss={() => {
          setActionError(null);
          onDismissError();
        }}
      />

      {!loading && (
        <>
          {/* Search row: search field, bookmark filter, and a context menu
              holding the New Folder / Show hidden actions. */}
          <div className="flex items-center gap-2 py-2">
            <div className="flex-1">
              <SearchBar
                value={search}
                onChange={setSearch}
                placeholder="Search"
                inputClassName={menuInputClassName}
              />
            </div>
            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              aria-pressed={favoritesOnly}
              aria-label={favoritesOnly ? 'Show all' : 'Show bookmarks only'}
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                favoritesOnly
                  ? 'bg-amber-500/20 text-amber-500'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300'
              }`}
            >
              {favoritesOnly ? (
                <BookmarkIconSvg className="w-5 h-5" />
              ) : (
                <BookmarkOutlineIcon className="w-5 h-5" />
              )}
            </button>
            <RowActionsMenu
              ariaLabel="Folder options"
              triggerClassName="bg-white/5 hover:bg-white/10 text-slate-300"
              items={[
                {
                  key: 'new-folder',
                  label: 'New folder',
                  icon: <PlusIcon className="w-4 h-4" />,
                  onClick: () => setAddFolderOpen(true),
                },
                {
                  key: 'toggle-hidden',
                  label: showHidden ? 'Hide hidden' : 'Show hidden',
                  icon: showHidden ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />,
                  onClick: () => setShowHidden((v) => !v),
                },
              ]}
            />
          </div>
        </>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : sortedItems.length === 0 ? (
        <p className={`${menuMutedTextClassName} text-center py-8`}>
          {isSearching
            ? 'No matching workflows'
            : favoritesOnly
              ? 'No bookmarks here'
              : userWorkflows.length === 0
                ? 'No saved workflows yet'
                : 'Empty folder'}
        </p>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1">
          {sortedItems.map((file) => {
            const isDirectory = file.type === 'directory';
            const relPath = getRelativePath(file);
            const isBookmarked = favoriteSet.has(relPath);
            const isHidden = hiddenSet.has(relPath) || file.name.startsWith('.');
            const modified = isDirectory ? folderModifiedMap.get(file.path) : file.modified;
            return (
              <div
                key={file.path}
                className={`${menuSurfaceClassName} flex items-center min-h-[56px] overflow-hidden transition-colors hover:bg-slate-800/95 ${
                  isHidden ? 'opacity-60' : ''
                }`}
              >
                <button
                  onClick={() =>
                    isDirectory ? setCurrentFolder(file.path) : onLoadWorkflow(relPath)
                  }
                  className="flex items-center gap-3 px-4 py-2 text-left flex-1 min-w-0"
                >
                  {isDirectory ? (
                    <FolderIcon
                      className={`w-6 h-6 shrink-0 ${
                        isHidden ? 'text-slate-500' : 'text-cyan-300'
                      }`}
                    />
                  ) : (
                    <WorkflowIcon className={`${menuSmallIconClassName} shrink-0`} />
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <p
                      className={`${menuTextClassName} leading-snug line-clamp-2 break-words ${
                        isHidden ? 'italic' : ''
                      }`}
                    >
                      {isHidden && (
                        <EyeOffIcon className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-slate-400" />
                      )}
                      {isDirectory ? file.name : file.name.replace(/\.json$/, '')}
                    </p>
                    {!isDirectory && isSearching && relPath.includes('/') && (
                      <p className="text-xs text-slate-500 truncate">
                        {relPath.replace(/\/[^/]+$/, '')}
                      </p>
                    )}
                    {modified != null && (
                      <p className={`text-xs ${menuMutedTextClassName}`}>
                        {formatRelativeDate(modified)}
                      </p>
                    )}
                  </div>
                </button>
                <div className="shrink-0 pr-1">
                  <RowActionsMenu
                    items={buildRowMenu(file)}
                    triggerIcon={
                      isBookmarked ? (
                        <BookmarkIconSvg className="w-5 h-5 text-amber-500" />
                      ) : undefined
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addFolderOpen && (
        <NameDialog
          title="New folder"
          confirmLabel="Create"
          initialValue=""
          onConfirm={handleCreateFolder}
          onClose={() => setAddFolderOpen(false)}
        />
      )}
      {renameTarget && (
        <NameDialog
          title={renameTarget.type === 'directory' ? 'Rename folder' : 'Rename workflow'}
          confirmLabel="Rename"
          initialValue={
            renameTarget.type === 'directory'
              ? renameTarget.name
              : renameTarget.name.replace(/\.json$/, '')
          }
          onConfirm={(name) => handleRename(renameTarget, name)}
          onClose={() => setRenameTarget(null)}
        />
      )}
      {moveTarget && (
        <WorkflowMoveDialog
          target={moveTarget}
          userWorkflows={userWorkflows}
          onMove={(destinationDirectory) => handleMove(moveTarget, destinationDirectory)}
          onClose={() => setMoveTarget(null)}
        />
      )}
      {deleteTarget && (
        <Dialog
          title={deleteTarget.type === 'directory' ? 'Delete folder?' : 'Delete workflow?'}
          description={
            deleteTarget.type === 'directory'
              ? `"${deleteTarget.name}" and everything inside it will be permanently deleted.`
              : `"${deleteTarget.name.replace(/\.json$/, '')}" will be permanently deleted.`
          }
          actions={[
            { label: 'Cancel', variant: 'secondary', onClick: () => setDeleteTarget(null) },
            { label: 'Delete', variant: 'danger', onClick: () => handleDelete(deleteTarget) },
          ]}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
