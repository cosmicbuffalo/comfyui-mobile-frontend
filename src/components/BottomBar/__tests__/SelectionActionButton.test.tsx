import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useOutputsStore } from '@/hooks/useOutputs';
import { SelectionActionButton } from '../SelectionActionButton';

describe('SelectionActionButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useOutputsStore.setState({
      selectionMode: true,
      selectedIds: [],
      selectionActionOpen: false,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('cancels selection mode when nothing is selected', () => {
    act(() => root.render(<SelectionActionButton />));

    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Cancel selection mode');

    act(() => button?.click());

    expect(useOutputsStore.getState().selectionMode).toBe(false);
    expect(useOutputsStore.getState().selectionActionOpen).toBe(false);
  });

  it('opens selection actions when items are selected', () => {
    useOutputsStore.setState({ selectedIds: ['output/image.png'] });
    act(() => root.render(<SelectionActionButton />));

    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Selection actions');

    act(() => button?.click());

    expect(useOutputsStore.getState().selectionMode).toBe(true);
    expect(useOutputsStore.getState().selectionActionOpen).toBe(true);
  });
});
