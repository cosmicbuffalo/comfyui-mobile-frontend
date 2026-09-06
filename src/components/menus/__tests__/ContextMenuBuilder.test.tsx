import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextMenuBuilder, type ContextMenuItemDefinition } from '@/components/menus/ContextMenuBuilder';

describe('ContextMenuBuilder dividers', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderMenu = (items: ContextMenuItemDefinition[]) => {
    act(() => {
      root.render(<ContextMenuBuilder items={items} />);
    });
  };

  const dividerCount = () => container.querySelectorAll('div.border-t.my-1').length;

  it('collapses a divider pair left behind by a hidden section', () => {
    // Mirrors a subgraph placeholder menu: everything between the two dividers
    // is hidden for that node type.
    renderMenu([
      { key: 'edit-label', label: 'Edit label' },
      { type: 'divider', key: 'divider-top-edit-color' },
      { key: 'toggle-bookmark', label: 'Bookmark node', hidden: true },
      { type: 'divider', key: 'divider-node-actions' },
      { key: 'hide-node', label: 'Hide node' },
    ]);
    expect(dividerCount()).toBe(1);
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  it('treats a divider hidden by class name as not visible', () => {
    renderMenu([
      { key: 'edit-label', label: 'Edit label' },
      { type: 'divider', key: 'divider-enter-subgraph', className: 'hidden' },
      { type: 'divider', key: 'divider-top-edit-color' },
      { key: 'hide-node', label: 'Hide node' },
    ]);
    expect(dividerCount()).toBe(1);
  });

  it('drops leading and trailing dividers', () => {
    renderMenu([
      { type: 'divider', key: 'leading' },
      { key: 'only-action', label: 'Delete node' },
      { type: 'divider', key: 'trailing' },
    ]);
    expect(dividerCount()).toBe(0);
  });

  it('keeps a divider that separates two visible sections', () => {
    renderMenu([
      { key: 'copy-node', label: 'Copy' },
      { type: 'divider', key: 'divider-delete' },
      { key: 'delete-node', label: 'Delete node' },
    ]);
    expect(dividerCount()).toBe(1);
  });
});
