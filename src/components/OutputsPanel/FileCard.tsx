import { useEffect, useState, type MouseEvent } from 'react';
import type { FileItem } from '@/api/client';
import {
  FolderIcon, CheckIcon,
  BookmarkIconSvg, VideoCameraIcon
} from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';

interface FileCardProps {
  file: FileItem;
  viewMode: 'grid' | 'list';
  selectionMode: boolean;
  isSelected: boolean;
  isFavorited: boolean;
  onNavigateFolder: (folder: string) => void;
  onOpen: (file: FileItem) => void;
  onMenu: (file: FileItem, e: MouseEvent) => void;
  onToggleSelection: (id: string) => void;
}

export function FileCard({
  file,
  viewMode,
  selectionMode,
  isSelected,
  isFavorited,
  onNavigateFolder,
  onOpen,
  onMenu,
  onToggleSelection
}: FileCardProps) {
  const isFolder = file.type === 'folder';
  const [previewError, setPreviewError] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPreviewError(false);
  }, [file.previewUrl, file.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClick = () => {
    if (selectionMode) {
      onToggleSelection(file.id);
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

  if (viewMode === 'list') {
    return (
      <div
        className={`file-card-list-item flex items-center gap-3 p-2 hover:bg-gray-50 border-b border-gray-100 last:border-0 ${isSelected ? 'bg-blue-50' : ''}`}
        onClick={handleClick}
      >
        {selectionMode && (
          <div className={`selection-checkbox w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white'}`}>
            {isSelected && <CheckIcon className="w-3.5 h-3.5" />}
          </div>
        )}
        <div className={`file-preview-container w-10 h-10 flex-shrink-0 flex items-center justify-center rounded text-gray-500 overflow-hidden relative ${isFolder ? '' : 'bg-gray-100'}`}>
          {isFolder ? (
            <FolderIcon className="w-6 h-6 text-amber-500" />
          ) : file.previewUrl && !previewError ? (
            <img
              src={file.previewUrl}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => setPreviewError(true)}
            />
          ) : (
            file.type === 'video' ? (
              <VideoCameraIcon className="w-5 h-5 text-gray-500" />
            ) : (
              <span className="text-xs font-bold">IMG</span>
            )
          )}
        </div>
        <div className="file-info-container flex-1 min-w-0">
          <div className="file-name text-sm font-medium text-gray-900 truncate">{file.name}</div>
        </div>
        <div className="file-actions-container flex items-center gap-2">
          {isFavorited && (
            <BookmarkIconSvg className="w-4 h-4 text-yellow-500" />
          )}
          <ContextMenuButton
            onClick={handleMenuButtonClick}
            ariaLabel="File options"
            buttonSize={8}
            iconSize={5}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="file-card-grid-item flex flex-col gap-1">
      <div
        className={`relative aspect-square bg-gray-100 rounded-lg overflow-hidden transition-all ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2' : ''}`}
        onClick={handleClick}
      >
        {isFolder ? (
          <div className="folder-grid-content w-full h-full flex flex-col items-center justify-center text-gray-500">
            <FolderIcon className="w-12 h-12 mb-2 text-amber-500" />
          </div>
        ) : file.previewUrl && !previewError ? (
          <img
            src={file.previewUrl}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setPreviewError(true)}
          />
        ) : (
          <div className="media-placeholder w-full h-full flex items-center justify-center bg-gray-800 text-white font-bold">
            {file.type === 'video' ? (
              <VideoCameraIcon className="w-10 h-10 text-white/80" />
            ) : (
              'IMG'
            )}
          </div>
        )}

        {selectionMode ? (
          <div className="selection-badge-container absolute top-2 left-2">
            <div className={`selection-badge w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-white bg-black/20'}`}>
              {isSelected && <CheckIcon className="w-4 h-4" />}
            </div>
          </div>
        ) : (
          <div className="file-menu-trigger-container absolute top-1 right-1 flex flex-col items-center gap-1 text-white">
            <ContextMenuButton
              onClick={handleMenuButtonClick}
              ariaLabel="File options"
              buttonSize={7}
              iconSize={4}
            />
            {isFavorited && (
              <BookmarkIconSvg className="w-4 h-4 text-yellow-400 drop-shadow" />
            )}
          </div>
        )}

        {file.type === 'video' && <div className="video-label absolute top-1 left-1 bg-black/50 px-1 rounded text-[10px] text-white">VID</div>}
      </div>
      <div className="file-name text-xs text-gray-700 truncate px-1">{file.name}</div>
    </div>
  );
}
