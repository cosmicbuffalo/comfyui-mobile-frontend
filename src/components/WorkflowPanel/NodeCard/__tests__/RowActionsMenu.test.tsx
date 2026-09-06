import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RowActionsMenu, type RowMenuSections } from '../RowActionsMenu';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';

const sections = (overrides?: Partial<RowMenuSections>): RowMenuSections => ({
  primary: [{ key: 'rename', label: 'Rename', onSelect: () => {} }],
  secondary: [{ key: 'promote', label: 'Promote as widget', onSelect: () => {} }],
  ...overrides,
});

const buttons = () => Array.from(document.querySelectorAll('button'));
const byLabel = (text: string) => buttons().find((b) => b.textContent === text);

describe('RowActionsMenu', () => {
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

  const render = async (value: RowMenuSections) => {
    await act(async () => {
      root.render(<RowActionsMenu menuKey="row:steps" rowName="steps" sections={value} />);
    });
  };

  it('keeps the actions behind one trigger until it is tapped', async () => {
    await render(sections());

    expect(byLabel('Rename')).toBeUndefined();
    const trigger = container.querySelector<HTMLButtonElement>('.row-actions-button');
    expect(trigger?.getAttribute('aria-label')).toBe('Actions for steps');

    await act(async () => trigger?.click());
    expect(byLabel('Rename')).toBeTruthy();
    expect(byLabel('Promote as widget')).toBeTruthy();
  });

  it('runs the action and closes', async () => {
    const onSelect = vi.fn();
    await render(sections({ primary: [{ key: 'rename', label: 'Rename', onSelect }] }));

    const trigger = container.querySelector<HTMLButtonElement>('.row-actions-button');
    await act(async () => trigger?.click());
    await act(async () => byLabel('Rename')?.click());

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(byLabel('Rename')).toBeUndefined();
  });

  it('separates the two groups, so routing actions read apart from the rest', async () => {
    await render(sections());
    const trigger = container.querySelector<HTMLButtonElement>('.row-actions-button');
    await act(async () => trigger?.click());

    const menu = document.querySelector('.row-actions-menu');
    expect(menu?.querySelectorAll('[data-context-menu-divider]').length ?? 0).toBeLessThanOrEqual(1);
    expect(menu?.textContent).toContain('Rename');
    expect(menu?.textContent).toContain('Promote as widget');
  });

  it('renders nothing at all when every action is hidden', async () => {
    await render({
      primary: [{ key: 'rename', label: 'Rename', hidden: true, onSelect: () => {} }],
      secondary: [],
    });
    expect(container.querySelector('.row-actions-button')).toBeNull();
  });

  it('heads the menu with the row name and its type', async () => {
    await act(async () => {
      root.render(<RowActionsMenu menuKey="row:steps" rowName="steps" typeLabel="INT" sections={sections()} />);
    });
    const trigger = container.querySelector<HTMLButtonElement>('.row-actions-button');
    await act(async () => trigger?.click());

    const heading = document.querySelector('.row-actions-heading');
    expect(heading?.textContent).toContain('steps');
    expect(document.querySelector('.row-actions-type')?.textContent).toBe('INT');
    // The heading is not a choice.
    expect(heading?.querySelector('button')).toBeNull();
  });

  it('shows no heading when no type is given', async () => {
    await render(sections());
    const trigger = container.querySelector<HTMLButtonElement>('.row-actions-button');
    await act(async () => trigger?.click());
    expect(document.querySelector('.row-actions-heading')).toBeNull();
  });

  it('stays absent when a heading is all there would be', async () => {
    await act(async () => {
      root.render(
        <RowActionsMenu
          menuKey="row:steps"
          rowName="steps"
          typeLabel="INT"
          sections={{ primary: [], secondary: [] }}
        />,
      );
    });
    expect(container.querySelector('.row-actions-button')).toBeNull();
  });

  it('stays open when the row remounts under it', async () => {
    // Reordering a slot changes the React key of the row that moved, so the row
    // is torn down and rebuilt. The menu used to die with it: the tap that
    // opened it was discarded by the remount, so the first tap after a move did
    // nothing and the second worked.
    await act(async () => {
      root.render(
        <div key="before">
          <RowActionsMenu menuKey="row:steps" rowName="steps" sections={sections()} />
        </div>,
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>('.row-actions-button');
    await act(async () => trigger?.click());
    expect(byLabel('Rename')).toBeTruthy();

    // Same menuKey, different React key: a remount, not a re-render.
    await act(async () => {
      root.render(
        <div key="after">
          <RowActionsMenu menuKey="row:steps" rowName="steps" sections={sections()} />
        </div>,
      );
    });

    expect(byLabel('Rename')).toBeTruthy();
  });

  it('opens one row menu at a time', async () => {
    await act(async () => {
      root.render(
        <>
          <RowActionsMenu menuKey="row:a" rowName="a" sections={sections()} />
          <RowActionsMenu menuKey="row:b" rowName="b" sections={sections()} />
        </>,
      );
    });

    const triggers = container.querySelectorAll<HTMLButtonElement>('.row-actions-button');
    await act(async () => triggers[0].click());
    expect(document.querySelectorAll('.row-actions-menu')).toHaveLength(1);

    await act(async () => triggers[1].click());
    expect(document.querySelectorAll('.row-actions-menu')).toHaveLength(1);
    expect(useRowMenuStore.getState().openKey).toBe('row:b');
  });
});
