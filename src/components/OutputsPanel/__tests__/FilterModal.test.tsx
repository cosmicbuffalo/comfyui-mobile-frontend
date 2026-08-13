import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterModal } from '@/components/OutputsPanel/FilterModal';
import type { FilterState } from '@/hooks/useOutputs';

describe('Outputs FilterModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const renderModal = async (
    filter: FilterState,
    handlers: Partial<Pick<
      ComponentProps<typeof FilterModal>,
      'onChangeFilter' | 'onCycleStatusFilter' | 'onChangeSort'
    >> = {},
  ) => {
    await act(async () => {
      root.render(
        <FilterModal
          open
          onClose={() => {}}
          filter={filter}
          sort={{ mode: 'modified' }}
          onChangeFilter={handlers.onChangeFilter ?? (() => {})}
          onCycleStatusFilter={handlers.onCycleStatusFilter ?? (() => {})}
          onChangeSort={handlers.onChangeSort ?? (() => {})}
        />,
      );
    });
  };

  const allOff: FilterState = {
    search: '',
    favoritesMode: 'off',
    rejectsMode: 'off',
    type: 'all',
  };

  it('shows concise status filters and four sort choices', async () => {
    const onCycleStatusFilter = vi.fn();
    const onChangeSort = vi.fn();
    await renderModal(allOff, { onCycleStatusFilter, onChangeSort });

    expect(container.querySelector('#favorites-toggle-button')?.textContent).toBe('收藏');
    expect(container.querySelector('#rejects-toggle-button')?.textContent).toBe('拒收');
    expect(container.querySelector('#sort-group-options')?.children).toHaveLength(4);
    expect(container.querySelector('#sort-group-options')?.textContent).toContain('创建时间');
    expect(container.querySelector('#sort-group-options')?.textContent).toContain('修改时间');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('#rejects-toggle-button')?.click();
    });
    expect(onCycleStatusFilter).toHaveBeenCalledWith('rejectsMode');

    const createdButton = Array.from(container.querySelectorAll<HTMLButtonElement>('#sort-group-options button'))
      .find((button) => button.textContent === '创建时间');
    await act(async () => createdButton?.click());
    expect(onChangeSort).toHaveBeenCalledWith({ mode: 'created' });
  });

  it('labels each status mode with what the listing is doing', async () => {
    await renderModal({ ...allOff, favoritesMode: 'only', rejectsMode: 'off' });
    expect(container.querySelector('#favorites-toggle-button')?.textContent).toBe('仅收藏');

    await renderModal({ ...allOff, favoritesMode: 'exclude', rejectsMode: 'exclude' });
    expect(container.querySelector('#favorites-toggle-button')?.textContent).toBe('无收藏');
    expect(container.querySelector('#rejects-toggle-button')?.textContent).toBe('无拒收');
    expect(
      container.querySelector('#rejects-toggle-button')?.getAttribute('data-status-mode'),
    ).toBe('exclude');
    // Both excluding modes still report as pressed — the filter is doing work.
    expect(
      container.querySelector('#favorites-toggle-button')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
