import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileItem } from '@/api/client';
import { FileCard } from '@/components/OutputsPanel/FileCard';
import {
  FAVORITE_INDICATORS,
  REJECTED_INDICATORS,
  visibleMatches,
  type Breakpoint,
} from './breakpointVisibility';

/**
 * Favorite and reject state must read off an outputs card at every breakpoint
 * and in every mode. Desktop swaps the static badges for interactive buttons,
 * and modes like selection suppress those buttons — so each combination needs
 * to keep at least one indicator on screen. Selection mode dropping the reject
 * badge on desktop is the regression this suite exists for.
 */

const BREAKPOINTS: Breakpoint[] = ['mobile', 'desktop'];

function makeFile(): FileItem {
  return { id: 'output/a.png', name: 'a.png', type: 'image' };
}

interface Mode {
  label: string;
  selectionMode: boolean;
  showContextMenu: boolean;
  hidden?: boolean;
}

const MODES: Mode[] = [
  { label: 'browsing', selectionMode: false, showContextMenu: true },
  { label: 'selection mode', selectionMode: true, showContextMenu: true },
  { label: 'no context menus', selectionMode: false, showContextMenu: false },
  { label: 'selection mode without context menus', selectionMode: true, showContextMenu: false },
  { label: 'a hidden item', selectionMode: false, showContextMenu: true, hidden: true },
  { label: 'a hidden item in selection mode', selectionMode: true, showContextMenu: true, hidden: true },
];

const STATES = [
  { label: 'favorited', props: { isFavorited: true, isRejected: false }, selector: FAVORITE_INDICATORS },
  { label: 'rejected', props: { isFavorited: false, isRejected: true }, selector: REJECTED_INDICATORS },
];

describe('FileCard favorite/reject indicators', () => {
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
    for (const mode of MODES) {
      for (const state of STATES) {
        it(`shows the ${state.label} indicator in ${viewMode} view during ${mode.label}`, async () => {
          await act(async () => {
            root.render(
              <FileCard
                file={{ ...makeFile(), hidden: mode.hidden }}
                viewMode={viewMode}
                selectionMode={mode.selectionMode}
                isSelected={false}
                showContextMenu={mode.showContextMenu}
                {...state.props}
                onNavigateFolder={() => {}}
                onOpen={() => {}}
                onMenu={() => {}}
                onToggleSelection={() => {}}
                onToggleFavorite={() => {}}
                onToggleRejected={() => {}}
              />,
            );
          });

          const card = container.firstElementChild!;
          for (const breakpoint of BREAKPOINTS) {
            expect(
              visibleMatches(card, state.selector, breakpoint).length,
              `no ${state.label} indicator visible on ${breakpoint}`,
            ).toBeGreaterThan(0);
          }
        });
      }
    }
  }

  it('shows both indicators at once when an item is favorited and rejected', async () => {
    await act(async () => {
      root.render(
        <FileCard
          file={makeFile()}
          viewMode="list"
          selectionMode
          isSelected={false}
          isFavorited
          isRejected
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          onToggleFavorite={() => {}}
          onToggleRejected={() => {}}
        />,
      );
    });

    const card = container.firstElementChild!;
    for (const breakpoint of BREAKPOINTS) {
      expect(visibleMatches(card, FAVORITE_INDICATORS, breakpoint).length).toBeGreaterThan(0);
      expect(visibleMatches(card, REJECTED_INDICATORS, breakpoint).length).toBeGreaterThan(0);
    }
  });
});
