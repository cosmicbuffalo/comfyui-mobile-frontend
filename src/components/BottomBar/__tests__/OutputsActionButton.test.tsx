import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useOutputsStore } from '@/hooks/useOutputs';
import { OutputsActionButton } from '../OutputsActionButton';

/**
 * This slot holds filter/sort normally, and the select-mode checkbox whenever
 * selecting is the useful thing to do — which includes the whole time the
 * viewer is open, since filter/sort has no listing to act on there.
 */
describe('OutputsActionButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useOutputsStore.setState({
      selectionMode: false,
      selectedIds: [],
      selectionActionOpen: false,
      outputsViewerOpen: false,
      outputsViewerFileId: null,
      filter: { search: '', favoritesMode: 'off', rejectsMode: 'off', type: 'all' },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const label = () => container.querySelector('button')?.getAttribute('aria-label');
  const render = () => act(() => root.render(<OutputsActionButton />));

  it('shows filter and sort on the plain listing', () => {
    render();
    expect(label()).toBe('Filter and sort');
  });

  it('shows the select button while selection mode is on', () => {
    useOutputsStore.setState({ selectionMode: true });
    render();
    expect(label()).toBe('Cancel selection mode');
  });

  it('shows the select button while the viewer is open, even outside selection mode', () => {
    useOutputsStore.setState({ outputsViewerOpen: true });
    render();
    expect(label()).toBe('Select images');
  });

  it('goes back to filter and sort once the viewer closes', () => {
    useOutputsStore.setState({ outputsViewerOpen: true });
    render();
    act(() => { useOutputsStore.setState({ outputsViewerOpen: false }); });
    expect(label()).toBe('Filter and sort');
  });
});
