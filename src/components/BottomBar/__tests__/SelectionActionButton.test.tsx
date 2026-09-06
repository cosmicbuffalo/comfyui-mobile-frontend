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
      outputsViewerFileId: null,
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

  it('marks itself pressed while selection mode is on', () => {
    // The amber outline is what tells the user a mode is active rather than
    // this being a neutral action button.
    act(() => root.render(<SelectionActionButton />));
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.className).toContain('selection-mode-active');
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

describe('SelectionActionButton entering select mode from the viewer', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Select mode OFF, viewer open on an image: the state this button is in
    // when it replaces filter/sort inside the viewer.
    useOutputsStore.setState({
      selectionMode: false,
      selectedIds: [],
      selectionActionOpen: false,
      outputsViewerOpen: true,
      outputsViewerFileId: 'output/one.png',
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('enters selection mode and selects the image on screen', () => {
    act(() => root.render(<SelectionActionButton />));
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Select images');
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    act(() => button?.click());

    // The tap that turned the mode on also counts as picking this image,
    // rather than leaving an empty selection behind.
    expect(useOutputsStore.getState().selectionMode).toBe(true);
    expect(useOutputsStore.getState().selectedIds).toEqual(['output/one.png']);
  });

  it('enters selection mode with nothing selected when no image is open', () => {
    useOutputsStore.setState({ outputsViewerFileId: null });
    act(() => root.render(<SelectionActionButton />));

    act(() => container.querySelector('button')?.click());

    expect(useOutputsStore.getState().selectionMode).toBe(true);
    expect(useOutputsStore.getState().selectedIds).toEqual([]);
  });

  it('replaces an existing selection rather than adding to it', () => {
    // Entering the mode is a fresh start; toggleSelectionMode already clears.
    useOutputsStore.setState({ selectedIds: ['stale/id.png'] });
    act(() => root.render(<SelectionActionButton />));

    act(() => container.querySelector('button')?.click());

    expect(useOutputsStore.getState().selectedIds).toEqual(['output/one.png']);
  });
});
