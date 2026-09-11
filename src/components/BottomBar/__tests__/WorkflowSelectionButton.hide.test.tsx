import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { WorkflowSelectionButton } from '../WorkflowSelectionButton';

const FIRST = 'root/node:1';
const SECOND = 'root/node:2';

function hideEntry(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('.hide-selection-action')
    ?? document.querySelector<HTMLButtonElement>('.hide-selection-action');
}

describe('bulk hide from workflow select mode', () => {
  let container: HTMLDivElement;
  let root: Root;

  const openMenuWith = async (selectedKeys: string[]) => {
    useWorkflowSelectionStore.setState({ selectedKeys, actionMenuOpen: true });
    await act(async () => {
      root.render(<WorkflowSelectionButton />);
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useWorkflowStore.setState({
      hiddenItems: {},
      itemKeyByPointer: { [FIRST]: FIRST, [SECOND]: SECOND },
    });
    useWorkflowSelectionStore.setState({ selectedKeys: [], actionMenuOpen: false });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useWorkflowStore.setState({ hiddenItems: {} });
    useWorkflowSelectionStore.setState({ selectedKeys: [], actionMenuOpen: false });
  });

  it('hides every selected item and leaves select mode', async () => {
    await openMenuWith([FIRST, SECOND]);

    const entry = hideEntry(container);
    expect(entry?.textContent).toContain('Hide');
    await act(async () => entry?.click());

    expect(useWorkflowStore.getState().hiddenItems).toEqual({
      [FIRST]: true,
      [SECOND]: true,
    });
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual([]);
  });

  it('offers the other direction once everything selected is already hidden', async () => {
    // Select mode can pick hidden items, so an all-hidden selection is
    // reachable — and "Hide" would be the one thing it cannot do.
    useWorkflowStore.setState({ hiddenItems: { [FIRST]: true, [SECOND]: true } });
    await openMenuWith([FIRST, SECOND]);

    const entry = hideEntry(container);
    expect(entry?.textContent).toContain('Unhide');
    await act(async () => entry?.click());

    expect(useWorkflowStore.getState().hiddenItems).toEqual({});
  });

  it('hides a mixed selection rather than unhiding half of it', async () => {
    useWorkflowStore.setState({ hiddenItems: { [FIRST]: true } });
    await openMenuWith([FIRST, SECOND]);

    const entry = hideEntry(container);
    expect(entry?.textContent).toContain('Hide');
    await act(async () => entry?.click());

    expect(useWorkflowStore.getState().hiddenItems).toEqual({
      [FIRST]: true,
      [SECOND]: true,
    });
  });
});
