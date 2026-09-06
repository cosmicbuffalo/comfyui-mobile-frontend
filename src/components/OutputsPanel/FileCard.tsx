import { memo, useEffect, useState, type MouseEvent } from 'react';
import type { FileItem, SortMode } from '@/api/client';
import {
  FolderIcon, CheckIcon,
  HeartIcon, RejectedIcon, VideoCameraIcon, EyeOffIcon
} from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { FavoriteButton } from '@/components/buttons/FavoriteButton';
import { RejectButton } from '@/components/buttons/RejectButton';
import { formatBytes } from '@/utils/formatBytes';
import { useI18n } from '@/i18n';
import { formatRelativeAge } from '@/utils/outputsBrowser';
import { useLongPress } from '@/hooks/useLongPress';
import { formatVideoDuration } from '@/utils/formatVideoDuration';

interface SelectionClickOptions {
  range?: boolean;
}

interface FileCardProps {
  file: FileItem;
  viewMode: 'grid' | 'list';
  selectionMode: boolean;
  isSelected: boolean;
  isFavorited: boolean;
  isRejected?: boolean;
  onNavigateFolder: (folder: string) => void;
  onOpen: (file: FileItem) => void;
  /** Optional hold action, independent from the normal tap action. */
  onLongPressOpen?: (file: FileItem) => void;
  onMenu: (file: FileItem, e: MouseEvent) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleRejected?: (id: string) => void;
  onToggleSelection: (id: string, event: MouseEvent, options?: SelectionClickOptions) => void;
  showContextMenu?: boolean;
  sortMode?: SortMode;
  videoDurationSeconds?: number;
}

function SelectionBadge({
  isSelected,
  fileName,
  onRangeSelect,
}: {
  isSelected: boolean;
  fileName: string;
  onRangeSelect: (event: MouseEvent) => void;
}) {
  if (isSelected) {
    // Clickable so the badge can drive range *deselect* the same way the
    // unselected badge drives range select — see handleToggleSelection.
    return (
      <button
        type="button"
        className="selection-badge w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm bg-cyan-500 border-cyan-500 text-slate-950"
        aria-label={`Range deselect to ${fileName}`}
        onClick={onRangeSelect}
      >
        <CheckIcon className="w-4 h-4" />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="selection-badge w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm border-white bg-black/20"
      aria-label={`Range select to ${fileName}`}
      onClick={onRangeSelect}
    />
  );
}

function FileCardComponent({
  file,
  viewMode,
  selectionMode,
  isSelected,
  isFavorited,
  isRejected = false,
  onNavigateFolder,
  onOpen,
  onLongPressOpen,
  onMenu,
  onToggleFavorite,
  onToggleRejected,
  onToggleSelection,
  showContextMenu = true,
  sortMode,
  videoDurationSeconds,
}: FileCardProps) {
  const { t } = useI18n();
  const isFolder = file.type === 'folder';
  const isHiddenFolder = isFolder && file.name.startsWith('.');
  // Dimmed when the item is hidden (dot-prefixed or manually marked). Such items
  // only render at all while "show hidden" is on, so this signals their state.
  const isHidden = file.hidden || file.name.startsWith('.');
  const folderIconClass = isHiddenFolder ? 'text-slate-500' : 'text-cyan-300';
  const metadataDateKind = sortMode?.startsWith('created') ? 'created' : 'modified';
  const metadataDate = metadataDateKind === 'created'
    ? (file.createdDate ?? file.date)
    : (file.modifiedDate ?? file.date);
  const relativeAge = formatRelativeAge(metadataDate);
  const [previewError, setPreviewError] = useState(false);
  const [desktopActionsDismissed, setDesktopActionsDismissed] = useState(false);

  const folderMetadata = isFolder && typeof file.count === 'number' ? (
    <div className="folder-metadata flex min-w-0 items-center gap-x-1 overflow-hidden whitespace-nowrap text-xs text-slate-400">
      <span className="shrink-0">{file.count} {file.count === 1 ? 'item' : 'items'}</span>
      {typeof file.size === 'number' && file.size > 0 && (
        <>
          <span className="shrink-0" aria-hidden="true">·</span>
          <span className="shrink-0">{formatBytes(file.size)}</span>
        </>
      )}
      {relativeAge && typeof metadataDate === 'number' && (
        <>
          <span className="shrink-0" aria-hidden="true">·</span>
          <time
            className="min-w-0 truncate"
            dateTime={new Date(metadataDate).toISOString()}
            title={new Date(metadataDate).toLocaleString()}
          >
            {relativeAge}
          </time>
        </>
      )}
    </div>
  ) : null;

  const fileMetadata = !isFolder && (
    typeof file.size === 'number' || (relativeAge && typeof metadataDate === 'number')
  ) ? (
    <div className="file-metadata flex min-w-0 items-center gap-x-1 overflow-hidden whitespace-nowrap text-xs text-slate-400">
      {typeof file.size === 'number' && (
        <span className="shrink-0">{formatBytes(file.size)}</span>
      )}
      {relativeAge && typeof metadataDate === 'number' && (
        <>
          {typeof file.size === 'number' && (
            <span className="shrink-0" aria-hidden="true">·</span>
          )}
          <time
            className="min-w-0 truncate"
            dateTime={new Date(metadataDate).toISOString()}
            title={new Date(metadataDate).toLocaleString()}
          >
            {relativeAge}
          </time>
        </>
      )}
    </div>
  ) : null;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPreviewError(false);
  }, [file.previewUrl, file.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // In select mode a tap toggles selection, so opening the viewer needs its own
  // gesture: press and hold. Folders have nothing to view, so they keep the
  // tap-only behaviour.
  const canLongPressOpen = (selectionMode || Boolean(onLongPressOpen)) && !isFolder;
  const { handlers: longPressHandlers, consumeLongPress } = useLongPress({
    enabled: canLongPressOpen,
    onLongPress: () => (onLongPressOpen ?? onOpen)(file),
  });

  const handleClick = (event: MouseEvent) => {
    // A real click follows the hold's pointerup; without consuming it the hold
    // would open the viewer AND the release would toggle the selection.
    if (consumeLongPress()) return;
    if (selectionMode) {
      onToggleSelection(file.id, event);
    } else if (isFolder) {
      onNavigateFolder(file.name);
    } else {
      onOpen(file);
    }
  };

  const handleMenuButtonClick = (event: MouseEvent) => {
    event.stopPropagation();
    onMenu(file, event);
  };

  const handleRangeSelectClick = (event: MouseEvent) => {
    event.stopPropagation();
    onToggleSelection(file.id, event, { range: true });
  };

  const handleToggleFavorite = () => {
    // Entering a state collapses the chooser to its persistent icon. Clearing
    // that state should reveal the neutral chooser immediately, even though
    // the pointer has not left and re-entered the card.
    setDesktopActionsDismissed(!isFavorited);
    onToggleFavorite?.(file.id);
  };

  const handleToggleRejected = () => {
    setDesktopActionsDismissed(!isRejected);
    onToggleRejected?.(file.id);
  };

  const hoverActionsVisibility = desktopActionsDismissed
    ? 'invisible opacity-0 pointer-events-none'
    : 'invisible opacity-0 pointer-events-none group-hover:visible group-hover:opacity-100 group-hover:pointer-events-auto';
  const persistentStateVisibility = desktopActionsDismissed
    ? 'visible opacity-100'
    : 'visible opacity-100 group-hover:invisible group-hover:opacity-0';
  const showRejectHover = !isFolder && Boolean(onToggleRejected) && !isFavorited;
  const showFavoriteHover = !isRejected;
  const showsBothHoverActions = showRejectHover && showFavoriteHover;

  // The favorite/reject badges normally only render on touch layouts, because
  // desktop swaps in the interactive hover buttons instead. Those buttons are
  // suppressed in selection mode, so keep the static badges visible there or
  // the state disappears entirely on desktop.
  const staticStateBadges = selectionMode ? '' : 'lg:hidden';

  const desktopStateActions = !selectionMode && onToggleFavorite ? (
    <div
      className={`desktop-output-state-controls relative hidden h-9 shrink-0 lg:block ${showsBothHoverActions ? 'w-[76px]' : 'w-9'}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={`desktop-state-hover-actions absolute inset-0 flex items-center justify-end gap-1 transition-opacity ${hoverActionsVisibility}`}>
        {showRejectHover && onToggleRejected && (
          <RejectButton
            onClick={handleToggleRejected}
            isRejected={isRejected}
            isFavorited={false}
          />
        )}
        {showFavoriteHover && (
          <FavoriteButton
            onClick={handleToggleFavorite}
            isFavorited={isFavorited}
            toggleable
          />
        )}
      </div>
      {isFavorited && (
        <div className={`persistent-state-action absolute right-0 top-0 transition-opacity ${persistentStateVisibility}`}>
          <FavoriteButton
            onClick={handleToggleFavorite}
            isFavorited
            toggleable
            bare
          />
        </div>
      )}
      {isRejected && !isFolder && onToggleRejected && (
        <div className={`persistent-state-action absolute right-0 top-0 transition-opacity ${persistentStateVisibility}`}>
          <RejectButton
            onClick={handleToggleRejected}
            isRejected
            isFavorited={false}
            bare
          />
        </div>
      )}
    </div>
  ) : null;

  if (viewMode === 'list') {
    return (
      <div
        className={`file-card-list-item group flex items-center gap-3 p-2 rounded-xl border border-white/10 bg-slate-900/95 hover:bg-slate-800/95 ${isSelected ? 'ring-2 ring-cyan-400' : ''} ${isHidden ? 'opacity-60' : ''}`}
        onClick={handleClick}
        onMouseLeave={() => setDesktopActionsDismissed(false)}
        {...longPressHandlers}
      >
        <div className={`file-preview-container w-10 h-10 flex-shrink-0 flex items-center justify-center rounded text-slate-400 overflow-hidden relative ${isFolder ? '' : 'bg-slate-950/80'}`}>
          {isFolder ? (
            <FolderIcon className={`w-6 h-6 ${folderIconClass}`} />
          ) : file.previewUrl && !previewError ? (
            <img
              src={file.previewUrl}
              className="w-full h-full object-cover select-none"
              loading="lazy"
              onError={() => setPreviewError(true)}
            />
          ) : (
            file.type === 'video' ? (
              <VideoCameraIcon className="w-5 h-5 text-slate-400" />
            ) : (
              <span className="text-xs font-bold">IMG</span>
            )
          )}
        </div>
        <div className="file-info-container flex-1 min-w-0">
          <div className="file-name text-sm font-medium text-slate-100 flex items-center gap-1 min-w-0">
            {isHidden && <EyeOffIcon className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
            <span className={`truncate ${isHidden ? 'italic' : ''}`}>{file.name}</span>
          </div>
          {isFolder && typeof file.matchCount === 'number' ? (
            <div className="text-xs text-cyan-300">
              {file.matchCount} {file.matchCount === 1 ? 'match' : 'matches'}
            </div>
          ) : isFolder && typeof file.favoriteCount === 'number' ? (
            <div className="folder-favorite-count text-xs text-red-400">
              {file.favoriteCount} {file.favoriteCount === 1 ? 'favorite' : 'favorites'} inside
            </div>
          ) : isFolder && typeof file.rejectCount === 'number' ? (
            <div className="folder-reject-count text-xs text-rose-300">
              {file.rejectCount} {file.rejectCount === 1 ? 'reject' : 'rejects'} inside
            </div>
          ) : isFolder && typeof file.count === 'number' ? (
            folderMetadata
          ) : !isFolder ? (
            fileMetadata
          ) : null}
        </div>
        <div className="file-actions-container flex items-center gap-2 text-slate-300">
          {desktopStateActions}
          <div className={`file-card-state-badges flex items-center gap-2 ${staticStateBadges}`}>
            {isFavorited && <HeartIcon className="favorite-badge-icon w-4 h-4 text-red-500" />}
            {isRejected && <RejectedIcon className="rejected-badge-icon w-4 h-4" />}
          </div>
          {selectionMode ? (
            <SelectionBadge
              isSelected={isSelected}
              fileName={file.name}
              onRangeSelect={handleRangeSelectClick}
            />
          ) : showContextMenu ? (
            <ContextMenuButton
              onClick={handleMenuButtonClick}
              ariaLabel={t('File options')}
              buttonSize={8}
              iconSize={5}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="file-card-grid-item group flex flex-col gap-1"
      onMouseLeave={() => setDesktopActionsDismissed(false)}
    >
      <div
        className={`relative aspect-square bg-slate-900/95 border border-white/10 overflow-hidden transition-all ${isSelected ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-slate-950' : !selectionMode ? 'lg:group-hover:ring-4 lg:group-hover:ring-slate-300/40 lg:group-hover:ring-offset-2 lg:group-hover:ring-offset-slate-950' : ''}`}
        onClick={handleClick}
        {...longPressHandlers}
        style={{"borderRadius":"9px"}}
      >
        {isFolder ? (
          <div className="folder-grid-content w-full h-full flex flex-col items-center justify-center text-slate-400">
            <FolderIcon className={`w-12 h-12 mb-2 ${folderIconClass}`} />
            {typeof file.matchCount === 'number' ? (
              <span className="text-xs text-cyan-300">
                {file.matchCount} {file.matchCount === 1 ? 'match' : 'matches'}
              </span>
            ) : typeof file.favoriteCount === 'number' ? (
              <span className="folder-favorite-count text-xs text-red-400">
                {file.favoriteCount} {file.favoriteCount === 1 ? 'favorite' : 'favorites'}
              </span>
            ) : typeof file.rejectCount === 'number' ? (
              <span className="folder-reject-count text-xs text-rose-300">
                {file.rejectCount} {file.rejectCount === 1 ? 'reject' : 'rejects'}
              </span>
            ) : typeof file.count === 'number' ? (
              <div className="flex justify-center">{folderMetadata}</div>
            ) : null}
          </div>
        ) : file.previewUrl && !previewError ? (
          <img
            src={file.previewUrl}
            className="w-full h-full object-cover select-none"
            loading="lazy"
            onError={() => setPreviewError(true)}
          />
        ) : (
          <div className="media-placeholder w-full h-full flex items-center justify-center bg-slate-800 text-white font-bold">
            {file.type === 'video' ? (
              <VideoCameraIcon className="w-10 h-10 text-white/80" />
            ) : (
              'IMG'
            )}
          </div>
        )}

        {/* Hidden items get a subtle vignette rather than a full dim, so the
            thumbnail stays legible while still reading as hidden. */}
        {isHidden && (
          <div className="absolute inset-0 pointer-events-none rounded-lg shadow-[inset_0_0_24px_8px_rgba(0,0,0,0.6)]" />
        )}

        {selectionMode ? (
          <div className="selection-badge-container absolute top-2 right-2 flex flex-col items-center gap-2">
              <SelectionBadge
                isSelected={isSelected}
                fileName={file.name}
                onRangeSelect={handleRangeSelectClick}
              />
          </div>
        ) : showContextMenu ? (
          <div className="file-menu-trigger-container absolute top-2 right-2 flex flex-col items-center gap-2 text-white">
            <ContextMenuButton
              onClick={handleMenuButtonClick}
              ariaLabel={t('File options')}
              buttonSize={8}
              iconSize={6}
            />
          </div>
        ) : null}

        {!selectionMode && onToggleFavorite && (
          <div
            className={`desktop-state-hover-actions absolute inset-x-2 bottom-2 hidden items-end justify-between transition-opacity lg:flex ${hoverActionsVisibility}`}
            onClick={(event) => event.stopPropagation()}
          >
            {showRejectHover && onToggleRejected && (
              <RejectButton
                onClick={handleToggleRejected}
                isRejected={isRejected}
                isFavorited={false}
              />
            )}
            {!showRejectHover && <span />}
            {showFavoriteHover && (
              <FavoriteButton
                onClick={handleToggleFavorite}
                isFavorited={isFavorited}
                toggleable
              />
            )}
          </div>
        )}
        {!selectionMode && isFavorited && onToggleFavorite && (
          <div
            className={`persistent-state-action absolute bottom-2 right-2 hidden transition-opacity lg:block ${persistentStateVisibility}`}
            onClick={(event) => event.stopPropagation()}
          >
            <FavoriteButton
              onClick={handleToggleFavorite}
              isFavorited
              toggleable
              bare
            />
          </div>
        )}
        {!selectionMode && isRejected && !isFolder && onToggleRejected && (
          <div
            className={`persistent-state-action absolute bottom-2 right-2 hidden transition-opacity lg:block ${persistentStateVisibility}`}
            onClick={(event) => event.stopPropagation()}
          >
            <RejectButton
              onClick={handleToggleRejected}
              isRejected
              isFavorited={false}
              bare
            />
          </div>
        )}
        <div className={`file-card-state-badges ${staticStateBadges}`}>
          {isFavorited && (
            <div className="favorite-badge-container absolute bottom-2 right-2 pointer-events-none">
              <HeartIcon className="w-6 h-6 text-red-500 drop-shadow" />
            </div>
          )}
          {isRejected && (
            <div className="rejected-badge-container absolute bottom-2 right-2 pointer-events-none">
              <RejectedIcon className="w-6 h-6 drop-shadow" />
            </div>
          )}
        </div>

        {/* Top-left badge stack. The hidden badge always claims the corner
            first, so other badges (e.g. video) sit to its right. */}
        {(isHidden || file.type === 'video') && (
          <div className="absolute top-1 left-1 flex items-center gap-1 pointer-events-none">
            {isHidden && (
              <div className="bg-black/50 px-1 py-0.5 rounded text-white">
                <EyeOffIcon className="w-3.5 h-3.5" />
              </div>
            )}
            {file.type === 'video' && (
              <div className="video-label bg-black/50 px-1 py-0.5 rounded text-white">
                <VideoCameraIcon className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        )}

        {!isFolder && (
          (typeof file.size === 'number' && file.size > 0)
          || (file.type === 'video' && typeof videoDurationSeconds === 'number' && videoDurationSeconds > 0)
        ) && (
          <div className="absolute bottom-1 left-1 flex items-center gap-1 pointer-events-none">
            {typeof file.size === 'number' && file.size > 0 && (
              <div className="file-size-badge bg-black/50 px-1 rounded text-[10px] text-white">
                {formatBytes(file.size)}
              </div>
            )}
            {file.type === 'video' && typeof videoDurationSeconds === 'number' && videoDurationSeconds > 0 && (
              <div className="video-duration-badge bg-black/50 px-1 rounded text-[10px] text-white tabular-nums">
                {formatVideoDuration(videoDurationSeconds)}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="file-name text-xs text-slate-300 px-1 flex items-center gap-1 min-w-0">
        {isHidden && <EyeOffIcon className="w-3 h-3 shrink-0" />}
        <span className={`truncate ${isHidden ? 'italic' : ''}`}>{file.name}</span>
      </div>
    </div>
  );
}

// Memoized: the outputs grid can mount hundreds/thousands of cards, and a single
// store change (e.g. toggling one selection) re-renders OutputsPanel. With stable
// callback props from the parent, only cards whose own props changed re-render.
export const FileCard = memo(FileCardComponent);
