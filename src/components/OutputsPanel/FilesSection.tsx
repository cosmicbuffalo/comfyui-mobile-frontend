import type { MouseEvent } from 'react';
import type { FileItem } from '@/api/client';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons';
import { FileCard } from './FileCard';

interface OutputsFilesSectionProps {
  fileSections: Array<{ key: string; label: string; files: FileItem[] }>;
  collapsedSections: Record<string, boolean>;
  viewMode: 'grid' | 'list';
  selectionMode: boolean;
  selectedIds: string[];
  favorites: string[];
  setCurrentFolder: (folder: string) => void;
  handleOpen: (file: FileItem) => void;
  handleMenu: (file: FileItem, event: MouseEvent) => void;
  toggleSelection: (id: string) => void;
  toggleSectionCollapsed: (key: string) => void;
  selectIds: (ids: string[]) => void;
}

export function OutputsFilesSection({
  fileSections,
  collapsedSections,
  viewMode,
  selectionMode,
  selectedIds,
  favorites,
  setCurrentFolder,
  handleOpen,
  handleMenu,
  toggleSelection,
  toggleSectionCollapsed,
  selectIds
}: OutputsFilesSectionProps) {
  return (
    <div id="outputs-files-section" className="flex flex-col gap-4">
      {fileSections.map((section) => (
        <div key={section.key} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <button
              className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800"
              onClick={() => toggleSectionCollapsed(section.key)}
            >
              {collapsedSections[section.key] ? (
                <ChevronRightIcon className="w-3.5 h-3.5" />
              ) : (
                <ChevronDownIcon className="w-3.5 h-3.5" />
              )}
              <span>{section.label} ({section.files.length})</span>
            </button>
            {selectionMode && (
              <button
                className="text-[10px] font-bold uppercase text-blue-600 hover:text-blue-700"
                onClick={() => selectIds(section.files.map((file) => file.id))}
              >
                Select all
              </button>
            )}
          </div>
          {!collapsedSections[section.key] && (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-2 gap-4 auto-rows-min">
                {section.files.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    viewMode={viewMode}
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
            ) : (
              <div className="flex flex-col">
                {section.files.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    viewMode={viewMode}
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
            )
          )}
        </div>
      ))}
    </div>
  );
}
