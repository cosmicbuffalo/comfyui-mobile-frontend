import { useMemo, type MouseEvent } from 'react';
import type { FileItem } from '@/api/client';
import { Collapsible } from '@/components/Collapsible';
import { FoldIcon } from '@/components/FoldIcon';
import { FileCard } from './FileCard';

const OUTPUTS_GRID_TEMPLATE_COLUMNS =
  'repeat(auto-fill, minmax(min(200px, calc((100% - 1rem) / 2)), 1fr))';

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
  toggleSelection: (id: string, event: MouseEvent, options?: { range?: boolean }) => void;
  toggleSectionCollapsed: (key: string, sectionElement: HTMLElement | null) => void;
  selectIds: (ids: string[]) => void;
  showContextMenus?: boolean;
  /** Cap on the total number of FileCards rendered across all sections, so a
   *  huge folder doesn't mount thousands of cards at once. The parent grows this
   *  on scroll. Section headers/counts/select-all still reflect the full data. */
  maxRenderedFiles?: number;
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
  selectIds,
  showContextMenus = true,
  maxRenderedFiles
}: OutputsFilesSectionProps) {
  // O(1) membership for the per-card selected/favorited checks, so rendering n
  // cards is O(n) instead of O(n²) (a `.includes()` per card on every selection
  // toggle was the hot path on large folders).
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const favoriteIdSet = useMemo(() => new Set(favorites), [favorites]);

  // Walk sections in order, rendering cards until the shared budget is spent.
  // Each section keeps its full `files` (for the count + select-all) but only
  // `visibleFiles` are mounted; the parent grows the budget as the user scrolls.
  // Collapsed sections paint nothing, so they get no cards and spend NO budget —
  // otherwise a collapsed early section would consume the budget on invisible
  // cards, starving the visible sections and tricking the parent's auto-grow
  // (which measures painted height) into rendering everything. Headers always
  // render so the user can see/expand every section.
  let budget = maxRenderedFiles ?? Infinity;
  const sectionsToRender: Array<{
    section: { key: string; label: string; files: FileItem[] };
    visibleFiles: FileItem[];
  }> = [];
  for (const section of fileSections) {
    if (collapsedSections[section.key] || budget <= 0) {
      sectionsToRender.push({ section, visibleFiles: [] });
      continue;
    }
    const visibleFiles = section.files.slice(0, budget);
    budget -= visibleFiles.length;
    sectionsToRender.push({ section, visibleFiles });
  }

  return (
    <div id="outputs-files-section" className="flex flex-col gap-4">
      {sectionsToRender.map(({ section, visibleFiles }) => (
        <div key={section.key} data-outputs-section className="flex flex-col gap-2">
          <div
            data-sticky-section-header
            className="sticky top-[-16px] z-20 -mx-4 flex items-center justify-between gap-3 bg-slate-950/95 px-4 py-2 backdrop-blur-sm"
          >
            <button
              className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-100"
              onClick={(event) => toggleSectionCollapsed(
                section.key,
                event.currentTarget.closest<HTMLElement>('[data-outputs-section]'),
              )}
            >
              <FoldIcon
                open={!collapsedSections[section.key]}
                variant="chevron"
                className="w-3.5 h-3.5"
              />
              <span>{section.label} ({section.files.length})</span>
            </button>
            {selectionMode && (
              <button
                className="text-[10px] font-bold uppercase text-cyan-300 hover:text-cyan-200"
                onClick={() => selectIds(section.files.map((file) => file.id))}
              >
                Select all
              </button>
            )}
          </div>
          <Collapsible open={!collapsedSections[section.key]}>
            {viewMode === 'grid' ? (
              <div
                className="grid gap-4 auto-rows-min"
                style={{ gridTemplateColumns: OUTPUTS_GRID_TEMPLATE_COLUMNS }}
              >
                {visibleFiles.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    viewMode={viewMode}
                    selectionMode={selectionMode}
                    isSelected={selectedIdSet.has(file.id)}
                    isFavorited={favoriteIdSet.has(file.id)}
                    onNavigateFolder={setCurrentFolder}
                    onOpen={handleOpen}
                    onMenu={handleMenu}
                    onToggleSelection={toggleSelection}
                    showContextMenu={showContextMenus}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {visibleFiles.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    viewMode={viewMode}
                    selectionMode={selectionMode}
                    isSelected={selectedIdSet.has(file.id)}
                    isFavorited={favoriteIdSet.has(file.id)}
                    onNavigateFolder={setCurrentFolder}
                    onOpen={handleOpen}
                    onMenu={handleMenu}
                    onToggleSelection={toggleSelection}
                    showContextMenu={showContextMenus}
                  />
                ))}
              </div>
            )}
          </Collapsible>
        </div>
      ))}
    </div>
  );
}
