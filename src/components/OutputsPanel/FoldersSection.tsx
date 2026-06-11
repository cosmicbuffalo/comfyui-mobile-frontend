import type { MouseEvent } from 'react';
import type { FileItem } from '@/api/client';
import { Collapsible } from '@/components/Collapsible';
import { FoldIcon } from '@/components/FoldIcon';
import { FileCard } from './FileCard';

interface OutputsFoldersSectionProps {
  folders: FileItem[];
  foldersCollapsed: boolean;
  toggleFoldersCollapsed: (sectionElement: HTMLElement | null) => void;
  selectionMode: boolean;
  selectedIds: string[];
  favorites: string[];
  setCurrentFolder: (folder: string) => void;
  handleOpen: (file: FileItem) => void;
  handleMenu: (file: FileItem, event: MouseEvent) => void;
  toggleSelection: (id: string, event: MouseEvent, options?: { range?: boolean }) => void;
  showContextMenus?: boolean;
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
  toggleSelection,
  showContextMenus = true
}: OutputsFoldersSectionProps) {
  if (folders.length === 0) return null;

  return (
    <div id="outputs-folders-section" data-outputs-section className="mb-4">
      <button
        data-sticky-section-header
        onClick={(event) => toggleFoldersCollapsed(
          event.currentTarget.closest<HTMLElement>('[data-outputs-section]'),
        )}
        className="sticky top-[-16px] z-20 -mx-4 mb-2 flex w-[calc(100%+2rem)] items-center gap-2 bg-slate-950/95 px-4 py-2 text-left text-sm font-medium text-slate-400 backdrop-blur-sm hover:text-slate-100"
      >
        <FoldIcon open={!foldersCollapsed} variant="chevron" className="w-4 h-4" />
        <span>Folders ({folders.length})</span>
      </button>
      <Collapsible open={!foldersCollapsed}>
        <div className="flex flex-col gap-2">
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
              showContextMenu={showContextMenus}
            />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}
