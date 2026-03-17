import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphContainerHeader } from '@/components/WorkflowPanel/GraphContainer/Header';

function buildProps(
  overrides: Partial<ComponentProps<typeof GraphContainerHeader>> = {}
): ComponentProps<typeof GraphContainerHeader> {
  return {
    containerType: 'group',
    containerId: 10,
    title: 'Test Group',
    nodeCount: 2,
    isCollapsed: false,
    hiddenNodeCount: 0,
    isBookmarked: false,
    canShowBookmarkAction: true,
    foldAllLabel: 'Fold all',
    color: '#ffffff',
    onToggleCollapse: vi.fn(),
    onToggleFoldAll: vi.fn(),
    onToggleBookmark: vi.fn(),
    onBypassAll: vi.fn(),
    onHide: vi.fn(),
    onAddNode: vi.fn(),
    onDelete: vi.fn(),
    onShowHiddenNodes: vi.fn(),
    onMove: vi.fn(),
    onCommitTitle: vi.fn(),
    ...overrides,
  };
}

describe('GraphContainerHeader menu bypass actions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('hides "Bypass all nodes" when showBypassAllAction is false', async () => {
    await act(async () => {
      root.render(
        <GraphContainerHeader
          {...buildProps({
            showBypassAllAction: false,
            showUnbypassAllAction: true,
          })}
        />
      );
    });

    const button = document.querySelector('button[aria-label="group options"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });

    expect(document.body.textContent).not.toContain('Bypass all nodes');
    expect(document.body.textContent).toContain('Engage all nodes');
  });

  it('shows "Bypass all nodes" when showBypassAllAction is true', async () => {
    await act(async () => {
      root.render(
        <GraphContainerHeader
          {...buildProps({
            showBypassAllAction: true,
            showUnbypassAllAction: false,
          })}
        />
      );
    });

    const button = document.querySelector('button[aria-label="group options"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });

    expect(document.body.textContent).toContain('Bypass all nodes');
    expect(document.body.textContent).not.toContain('Engage all nodes');
  });

  it('dismisses the color popover on outside click', async () => {
    await act(async () => {
      root.render(
        <GraphContainerHeader
          {...buildProps({
            onChangeColor: vi.fn(),
          })}
        />
      );
    });

    const menuButton = document.querySelector('button[aria-label="group options"]') as HTMLButtonElement | null;
    expect(menuButton).toBeTruthy();

    await act(async () => {
      menuButton?.click();
    });

    const changeColorButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Change color')) as HTMLButtonElement | undefined;
    expect(changeColorButton).toBeTruthy();

    await act(async () => {
      changeColorButton?.click();
    });

    expect(document.querySelector('button[aria-label^="Set color:"]')).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(document.querySelector('button[aria-label^="Set color:"]')).toBeNull();
  });
});
