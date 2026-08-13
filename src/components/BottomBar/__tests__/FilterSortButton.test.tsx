import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilterSortButton } from '../FilterSortButton';
import { useOutputsStore } from '@/hooks/useOutputs';

// The button lights up when the listing is NARROWED, so the user can tell that
// files are being hidden from view rather than simply absent.
describe('FilterSortButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useOutputsStore.setState({
      filter: { search: '', favoritesMode: 'off', rejectsMode: 'off', type: 'all' },
      sort: { mode: 'modified' },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = () => act(async () => { root.render(<FilterSortButton />); });
  const button = () => container.querySelector('button');

  it('is unlit with no filter applied', async () => {
    await render();
    expect(button()?.classList.contains('filter-active')).toBe(false);
    expect(button()?.getAttribute('aria-label')).toBe('筛选与排序');
  });

  it('lights up for favorites-only', async () => {
    useOutputsStore.setState({ filter: { search: '', favoritesMode: 'only', rejectsMode: 'off', type: 'all' } });
    await render();
    expect(button()?.classList.contains('filter-active')).toBe(true);
    expect(button()?.getAttribute('aria-label')).toBe('筛选与排序（已应用筛选）');
  });

  it('lights up for rejects-only', async () => {
    useOutputsStore.setState({
      filter: { search: '', favoritesMode: 'off', rejectsMode: 'only', type: 'all' },
    });
    await render();
    expect(button()?.classList.contains('filter-active')).toBe(true);
  });

  it('lights up for a type filter', async () => {
    useOutputsStore.setState({ filter: { search: '', favoritesMode: 'off', rejectsMode: 'off', type: 'video' } });
    await render();
    expect(button()?.classList.contains('filter-active')).toBe(true);
  });

  it('lights up for an active search', async () => {
    useOutputsStore.setState({ filter: { search: 'sunset', favoritesMode: 'off', rejectsMode: 'off', type: 'all' } });
    await render();
    expect(button()?.classList.contains('filter-active')).toBe(true);
  });

  it('stays unlit for a non-default sort', async () => {
    // Sorting reorders what is already there; nothing is hidden, so there is
    // nothing to warn about.
    useOutputsStore.setState({ sort: { mode: 'size-reverse' } });
    await render();
    expect(button()?.classList.contains('filter-active')).toBe(false);
  });
});
