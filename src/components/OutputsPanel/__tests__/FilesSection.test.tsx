import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@/api/client';
import { OutputsFilesSection } from '@/components/OutputsPanel/FilesSection';

function file(id: string): FileItem {
  return { id, name: id, type: 'image' };
}

// Two sections: 3 files + 2 files.
const sections = [
  { key: 's1', label: 'Section 1', files: [file('a'), file('b'), file('c')] },
  { key: 's2', label: 'Section 2', files: [file('d'), file('e')] },
];

describe('OutputsFilesSection incremental rendering', () => {
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

  function renderWith(
    maxRenderedFiles?: number,
    extra: Partial<React.ComponentProps<typeof OutputsFilesSection>> = {},
  ) {
    return act(async () => {
      root.render(
        <OutputsFilesSection
          fileSections={sections}
          collapsedSections={{}}
          viewMode="grid"
          selectionMode={false}
          selectedIds={[]}
          favorites={[]}
          setCurrentFolder={() => {}}
          handleOpen={() => {}}
          handleMenu={() => {}}
          toggleSelection={() => {}}
          toggleSectionCollapsed={() => {}}
          selectIds={() => {}}
          maxRenderedFiles={maxRenderedFiles}
          {...extra}
        />,
      );
    });
  }

  it('caps total rendered cards across sections at maxRenderedFiles', async () => {
    await renderWith(4);
    // 3 from section 1 + 1 from section 2 = 4
    expect(container.querySelectorAll('.file-card-grid-item').length).toBe(4);
  });

  it('renders every card when no cap is given', async () => {
    await renderWith(undefined);
    expect(container.querySelectorAll('.file-card-grid-item').length).toBe(5);
  });

  it('does not spend the budget on collapsed sections', async () => {
    // Collapse section 1 (3 files). With a budget of 2, the budget should go
    // entirely to the visible section 2 — collapsed cards mount nothing.
    await renderWith(2, { collapsedSections: { s1: true } });
    const cards = container.querySelectorAll('.file-card-grid-item');
    // Only section 2's 2 cards render; section 1 (collapsed) renders none.
    expect(cards.length).toBe(2);
    // Both section headers still present (full counts).
    expect(container.textContent).toContain('Section 1 (3)');
    expect(container.textContent).toContain('Section 2 (2)');
  });

  it('section header keeps the full count even when partially rendered', async () => {
    await renderWith(4);
    // Section 2 has 2 files but only 1 is rendered; the header still shows (2).
    expect(container.textContent).toContain('Section 2 (2)');
  });

  it('select-all uses the full section files, not just the visible slice', async () => {
    const selectIds = vi.fn();
    await renderWith(4, { selectionMode: true, selectIds });
    const selectAllButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Select all',
    );
    // Section 2's "Select all" — only 'd' is rendered, but it must select both.
    selectAllButtons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selectIds).toHaveBeenCalledWith(['d', 'e']);
  });
});
