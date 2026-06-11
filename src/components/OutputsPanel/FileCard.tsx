import { memo, useEffect, useState, type MouseEvent } from 'react';
import type { FileItem } from '@/api/client';
import {
  FolderIcon, CheckIcon,
  HeartIcon, VideoCameraIcon, EyeOffIcon
} from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { formatBytes } from '@/utils/formatBytes';

interface SelectionClickOptions {
  range?: boolean;
}

interface FileCardProps {
  file: FileItem;
  viewMode: 'grid' | 'list';
  selectionMode: boolean;
  isSelected: boolean;
  isFavorited: boolean;
  onNavigateFolder: (folder: string) => void;
  onOpen: (file: FileItem) => void;
  onMenu: (file: FileItem, e: MouseEvent) => void;
  onToggleSelection: (id: string, event: MouseEvent, options?: SelectionClickOptions) => void;
  showContextMenu?: boolean;
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
    return (
      <div className="selection-badge w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm bg-cyan-500 border-cyan-500 text-slate-950">
        <CheckIcon className="w-4 h-4" />
      </div>
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
  onNavigateFolder,
  onOpen,
  onMenu,
  onToggleSelection,
  showContextMenu = true
}: FileCardProps) {
  const isFolder = file.type === 'folder';
  const isHiddenFolder = isFolder && file.name.startsWith('.');
  // Dimmed when the item is hidden (dot-prefixed or manually marked). Such items
  // only render at all while "show hidden" is on, so this signals their state.
  const isHidden = file.hidden || file.name.startsWith('.');
  const folderIconClass = isHiddenFolder ? 'text-slate-500' : 'text-cyan-300';
  const [previewError, setPreviewError] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPreviewError(false);
  }, [file.previewUrl, file.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClick = (event: MouseEvent) => {
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

  if (viewMode === 'list') {
    return (
      <div
        className={`file-card-list-item flex items-center gap-3 p-2 rounded-xl border border-white/10 bg-slate-900/95 hover:bg-slate-800/95 ${isSelected ? 'ring-2 ring-cyan-400' : ''} ${isHidden ? 'opacity-60' : ''}`}
        onClick={handleClick}
      >
        <div className={`file-preview-container w-10 h-10 flex-shrink-0 flex items-center justify-center rounded text-slate-400 overflow-hidden relative ${isFolder ? '' : 'bg-slate-950/80'}`}>
          {isFolder ? (
            <FolderIcon className={`w-6 h-6 ${folderIconClass}`} />
          ) : file.previewUrl && !previewError ? (
            <img
              src={file.previewUrl}
              className="w-full h-full object-cover"
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
          ) : isFolder && typeof file.count === 'number' ? (
            <div className="text-xs text-slate-400">
              {file.count} {file.count === 1 ? 'item' : 'items'}
              {typeof file.size === 'number' && file.size > 0 && ` · ${formatBytes(file.size)}`}
            </div>
          ) : !isFolder && typeof file.size === 'number' ? (
            <div className="text-xs text-slate-400">{formatBytes(file.size)}</div>
          ) : null}
        </div>
        <div className="file-actions-container flex items-center gap-2 text-slate-300">
          {isFavorited && (
            <HeartIcon className="w-4 h-4 text-red-500" />
          )}
          {selectionMode ? (
            <SelectionBadge
              isSelected={isSelected}
              fileName={file.name}
              onRangeSelect={handleRangeSelectClick}
            />
          ) : showContextMenu ? (
            <ContextMenuButton
              onClick={handleMenuButtonClick}
              ariaLabel="File options"
              buttonSize={8}
              iconSize={5}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="file-card-grid-item flex flex-col gap-1">
      <div
        className={`relative aspect-square bg-slate-900/95 border border-white/10 overflow-hidden transition-all ${isSelected ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-slate-950' : ''}`}
        onClick={handleClick}
        style={{"borderRadius":"9px"}}
      >
        {isFolder ? (
          <div className="folder-grid-content w-full h-full flex flex-col items-center justify-center text-slate-400">
            <FolderIcon className={`w-12 h-12 mb-2 ${folderIconClass}`} />
            {typeof file.matchCount === 'number' ? (
              <span className="text-xs text-cyan-300">
                {file.matchCount} {file.matchCount === 1 ? 'match' : 'matches'}
              </span>
            ) : typeof file.count === 'number' ? (
              <span className="text-xs text-slate-400">
                {file.count} {file.count === 1 ? 'item' : 'items'}
                {typeof file.size === 'number' && file.size > 0 && ` · ${formatBytes(file.size)}`}
              </span>
            ) : null}
          </div>
        ) : file.previewUrl && !previewError ? (
          <img
            src={file.previewUrl}
            className="w-full h-full object-cover"
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
              ariaLabel="File options"
              buttonSize={8}
              iconSize={6}
            />
          </div>
        ) : null}

        {isFavorited && (
          <div className="favorite-badge-container absolute bottom-2 right-2 pointer-events-none">
            <HeartIcon className="w-6 h-6 text-red-500 drop-shadow" />
          </div>
        )}

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

        {!isFolder && typeof file.size === 'number' && file.size > 0 && (
          <div className="file-size-badge absolute bottom-1 left-1 bg-black/50 px-1 rounded text-[10px] text-white pointer-events-none">
            {formatBytes(file.size)}
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
