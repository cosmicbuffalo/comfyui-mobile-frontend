import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GroupSelectionActions } from '@/components/WorkflowPanel/GroupSelectionActions';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';

describe('GroupSelectionActions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useWorkflowSelectionStore.setState({
      selectionMode: true,
      selectedKeys: [],
      actionMenuOpen: false,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderActions(
    childrenKeys: string[],
    descendantKeys: string[],
  ) {
    await act(async () => {
      root.render(
        <GroupSelectionActions
          childrenKeys={childrenKeys}
          descendantKeys={descendantKeys}
        />,
      );
    });
  }

  it('toggles direct children separately from all descendants', async () => {
    await renderActions(
      ['child-node', 'child-group'],
      ['child-node', 'child-group', 'nested-node'],
    );

    let buttons = container.querySelectorAll('button');
    expect(buttons[0].textContent).toContain('Select children');
    expect(buttons[1].textContent).toContain('Select descendants');
    expect(buttons[0].querySelector('.selection-check-mark')).toBeNull();
    expect(buttons[1].querySelector('.selection-check-mark')).toBeNull();

    await act(async () => buttons[0].click());
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual([
      'child-node',
      'child-group',
    ]);

    buttons = container.querySelectorAll('button');
    expect(buttons[0].textContent).toContain('Deselect children');
    expect(buttons[0].querySelector('.selection-check-mark')).not.toBeNull();
    expect(buttons[1].textContent).toContain('Select descendants');

    await act(async () => buttons[1].click());
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual([
      'child-node',
      'child-group',
      'nested-node',
    ]);

    buttons = container.querySelectorAll('button');
    expect(buttons[1].textContent).toContain('Deselect all');
    expect(buttons[1].querySelector('.selection-check-mark')).not.toBeNull();

    await act(async () => buttons[1].click());
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual([]);
  });

  it('disables both actions when the group has no direct children', async () => {
    await renderActions([], []);

    for (const button of container.querySelectorAll('button')) {
      expect(button.disabled).toBe(true);
      expect(button.className).toContain('disabled:bg-slate-800/40');
    }
  });

  it('disables descendants when the group only has direct children', async () => {
    await renderActions(['node-a', 'node-b'], ['node-a', 'node-b']);

    const buttons = container.querySelectorAll('button');
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[1].textContent).toContain('Select descendants');
  });

  it('deselects only the target scope and preserves unrelated selections', async () => {
    useWorkflowSelectionStore.setState({
      selectedKeys: ['unrelated', 'child-node', 'child-group'],
    });
    await renderActions(
      ['child-node', 'child-group'],
      ['child-node', 'child-group', 'nested-node'],
    );

    const childrenButton = container.querySelectorAll('button')[0];
    expect(childrenButton.textContent).toContain('Deselect children');
    await act(async () => childrenButton.click());

    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual(['unrelated']);
  });
});
