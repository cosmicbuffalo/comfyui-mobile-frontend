import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowObjectContextMenu } from '@/components/WorkflowPanel/WorkflowObjectContextMenu';

describe('WorkflowObjectContextMenu', () => {
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

  it('renders the five workflow sections in their canonical order', async () => {
    await act(async () => {
      root.render(
        <WorkflowObjectContextMenu
          ariaLabel="Object options"
          sections={{
            cosmetic: [{ key: 'cosmetic', label: 'Cosmetic' }],
            bookmarkNavigation: [{ key: 'navigation', label: 'Navigation' }],
            actions: [{ key: 'action', label: 'Action' }],
            special: [{ key: 'special', label: 'Special' }],
            delete: [{ key: 'delete', label: 'Delete', color: 'danger' }],
          }}
        />,
      );
    });

    const trigger = document.querySelector(
      'button[aria-label="Object options"]',
    ) as HTMLButtonElement;
    await act(async () => trigger.click());

    const labels = Array.from(document.querySelectorAll('button'))
      .map((button) => button.textContent?.trim())
      .filter((label) => ['Cosmetic', 'Navigation', 'Action', 'Special', 'Delete'].includes(label ?? ''));
    expect(labels).toEqual(['Cosmetic', 'Navigation', 'Action', 'Special', 'Delete']);
  });

  it('closes after commands while allowing expandable commands to stay open', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <WorkflowObjectContextMenu
          ariaLabel="Object options"
          sections={{
            cosmetic: [],
            bookmarkNavigation: [],
            actions: [],
            special: [
              { key: 'expand', label: 'Expand', keepOpen: true },
              { key: 'choose', label: 'Choose', onSelect },
            ],
            delete: [],
          }}
        />,
      );
    });

    const trigger = document.querySelector(
      'button[aria-label="Object options"]',
    ) as HTMLButtonElement;
    await act(async () => trigger.click());
    const findButton = (label: string) => Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === label) as HTMLButtonElement | undefined;

    await act(async () => findButton('Expand')?.click());
    expect(findButton('Choose')).toBeTruthy();
    await act(async () => findButton('Choose')?.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(findButton('Choose')).toBeUndefined();
  });
});
