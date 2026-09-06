import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileItem } from '@/api/client';
import { OutputsFilesSection } from '@/components/OutputsPanel/FilesSection';
import {
  FAVORITE_INDICATORS,
  REJECTED_INDICATORS,
  visibleMatches,
  type Breakpoint,
} from './breakpointVisibility';

/**
 * The card-level suite proves a card renders its badges; this one proves the
 * list still hands each card its favorited/rejected state in every mode, so the
 * indicators can't vanish through the wiring instead of the markup.
 */

const BREAKPOINTS: Breakpoint[] = ['mobile', 'desktop'];

const FILES: FileItem[] = [
  { id: 'output/fav.png', name: 'fav.png', type: 'image' },
  { id: 'output/rejected.png', name: 'rejected.png', type: 'image' },
  { id: 'output/plain.png', name: 'plain.png', type: 'image' },
];

describe('OutputsFilesSection favorite/reject indicators', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  for (const viewMode of ['grid', 'list'] as const) {
    for (const selectionMode of [false, true]) {
      const mode = selectionMode ? 'selection mode' : 'browsing';
      it(`marks favorited and rejected files in ${viewMode} view during ${mode}`, async () => {
        await act(async () => {
          root.render(
            <OutputsFilesSection
              fileSections={[{ key: 'all', label: 'All', files: FILES }]}
              collapsedSections={{}}
              viewMode={viewMode}
              selectionMode={selectionMode}
              selectedIds={selectionMode ? ['output/fav.png'] : []}
              favorites={['output/fav.png']}
              rejected={['output/rejected.png']}
              setCurrentFolder={() => {}}
              handleOpen={() => {}}
              handleMenu={() => {}}
              toggleFavorite={() => {}}
              toggleRejected={() => {}}
              toggleSelection={() => {}}
              toggleSectionCollapsed={() => {}}
              selectIds={() => {}}
              sortMode="created"
            />,
          );
        });

        const cards = Array.from(container.querySelectorAll(
          viewMode === 'grid' ? '.file-card-grid-item' : '.file-card-list-item',
        ));
        expect(cards).toHaveLength(FILES.length);
        const [favoritedCard, rejectedCard, plainCard] = cards;

        for (const breakpoint of BREAKPOINTS) {
          expect(
            visibleMatches(favoritedCard, FAVORITE_INDICATORS, breakpoint).length,
            `favorited file lost its indicator on ${breakpoint}`,
          ).toBeGreaterThan(0);
          expect(
            visibleMatches(rejectedCard, REJECTED_INDICATORS, breakpoint).length,
            `rejected file lost its indicator on ${breakpoint}`,
          ).toBeGreaterThan(0);
          // The state is per-file, not per-list: an unmarked file stays unmarked.
          expect(visibleMatches(plainCard, FAVORITE_INDICATORS, breakpoint)).toHaveLength(0);
          expect(visibleMatches(plainCard, REJECTED_INDICATORS, breakpoint)).toHaveLength(0);
        }
      });
    }
  }
});
