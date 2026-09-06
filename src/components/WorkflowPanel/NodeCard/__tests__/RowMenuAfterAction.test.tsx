import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RowActionsMenu } from '../RowActionsMenu';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';

/**
 * The sequence a reorder actually produces: a menu action mutates the order the
 * rows are keyed by, so the row that ran the action is torn down and rebuilt
 * while its menu is closing.
 */
function ReorderableRows() {
  const [order, setOrder] = useState(['a', 'b']);
  return (
    <>
      {order.map((name, index) => (
        // Keyed by POSITION, the way a widget row is keyed by its value index:
        // moving a row changes its key and remounts it.
        <div key={`row-${index}-${name}`} data-row={name}>
          <RowActionsMenu
            menuKey={`row:${name}`}
            rowName={name}
            sections={{
              primary: [
                {
                  key: 'move',
                  label: `move ${name}`,
                  onSelect: () => setOrder((current) => [...current].reverse()),
                },
              ],
              secondary: [],
            }}
          />
        </div>
      ))}
    </>
  );
}

describe('row menu after acting on its own row', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const triggerFor = (name: string) =>
    container
      .querySelector(`[data-row="${name}"]`)
      ?.querySelector<HTMLButtonElement>('.row-actions-button');

  const menuOpen = () => document.querySelectorAll('.row-actions-menu').length > 0;

  it('opens on the first tap after its own action reordered the rows', async () => {
    await act(async () => {
      root.render(<ReorderableRows />);
    });

    await act(async () => triggerFor('a')?.click());
    expect(menuOpen()).toBe(true);

    // The action reorders and the menu closes.
    const move = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'move a',
    );
    await act(async () => move?.click());
    expect(menuOpen()).toBe(false);
    expect(useRowMenuStore.getState().openKey).toBeNull();

    // One tap on the row that moved should open it again.
    await act(async () => triggerFor('a')?.click());
    expect(menuOpen()).toBe(true);
  });
});
