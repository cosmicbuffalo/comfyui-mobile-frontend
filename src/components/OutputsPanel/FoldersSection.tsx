import type { MouseEvent } from 'react';
import type { FileItem } from '@/api/client';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons';
import { FileCard } from './FileCard';

interface OutputsFoldersSectionProps {
  folders: FileItem[];
  foldersCollapsed: boolean;
  toggleFoldersCollapsed: () => void;
  selectionMode: boolean;
  selectedIds: string[];
  favorites: string[];
  setCurrentFolder: (folder: string) => void;
  handleOpen: (file: FileItem) => void;
  handleMenu: (file: FileItem, event: MouseEvent) => void;
  toggleSelection: (id: string) => void;
}

export function OutputsFoldersSection({
  folders,
  foldersCollapsed,
  toggleFoldersCollapsed,
  selectionMode,
  selectedIds,
  favorites,
  setCurrentFolder,
  handleOpen,
  handleMenu,
  toggleSelection
}: OutputsFoldersSectionProps) {
  if (folders.length === 0) return null;

  return (
    <div id="outputs-folders-section" className="mb-4">
      <button
        onClick={toggleFoldersCollapsed}
        className="flex items-center gap-2 w-full text-left mb-2 py-1 text-sm font-medium text-gray-600 hover:text-gray-900"
      >
        {foldersCollapsed ? (
          <ChevronRightIcon className="w-4 h-4" />
        ) : (
          <ChevronDownIcon className="w-4 h-4" />
        )}
        <span>Folders ({folders.length})</span>
      </button>
      {!foldersCollapsed && (
        <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden">
          {folders.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              viewMode="list"
              selectionMode={selectionMode}
              isSelected={selectedIds.includes(file.id)}
              isFavorited={favorites.includes(file.id)}
              onNavigateFolder={setCurrentFolder}
              onOpen={handleOpen}
              onMenu={handleMenu}
              onToggleSelection={toggleSelection}
            />
          ))}
        </div>
      )}
    </div>
  );
}
