import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphContainerHeader } from '@/components/WorkflowPanel/GraphContainer/Header';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';

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
    canFoldAll: true,
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
    onMoveIntoSubgraph: vi.fn(),
    onDuplicate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    pasteSummary: null,
    onCommitTitle: vi.fn(),
    ...overrides,
  };
}

describe('GraphContainerHeader menu bypass actions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useWorkflowSelectionStore.setState({
      selectionMode: false,
      selectedKeys: [],
      actionMenuOpen: false,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
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

  it('puts common group capabilities in the action section and duplicates from it', async () => {
    const onDuplicate = vi.fn();
    await act(async () => {
      root.render(
        <GraphContainerHeader
          {...buildProps({
            selectionKey: 'stable-group-10',
            onChangeColor: vi.fn(),
            onDuplicate,
          })}
        />,
      );
    });
    const menuButton = document.querySelector(
      'button[aria-label="group options"]',
    ) as HTMLButtonElement;
    await act(async () => menuButton.click());

    const labels = Array.from(document.querySelectorAll('button'))
      .map((button) => button.textContent?.trim() ?? '');
    const indexOf = (label: string) => labels.indexOf(label);
    const ordered = [
      'Edit label',
      'Change color',
      'Bookmark',
      'Select',
      'Bypass all nodes',
      'Hide',
      'Duplicate',
      'Copy',
      'Move',
      'Move into subgraph',
      'Add node',
      'Delete',
    ].map(indexOf);
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));

    const duplicateButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Duplicate') as HTMLButtonElement;
    await act(async () => duplicateButton.click());
    expect(onDuplicate).toHaveBeenCalledTimes(1);
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

  it('selects only the group when its selection checkbox is clicked', async () => {
    useWorkflowSelectionStore.setState({ selectionMode: true });
    await act(async () => {
      root.render(
        <GraphContainerHeader
          {...buildProps({ selectionKey: 'stable-group-10' })}
        />
      );
    });

    const selectButton = document.querySelector(
      'button[aria-label="Select group"]',
    ) as HTMLButtonElement | null;
    expect(selectButton).toBeTruthy();
    await act(async () => {
      selectButton?.click();
    });

    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual([
      'stable-group-10',
    ]);
  });

  it('uses the persistent desktop bookmark shortcut without duplicating it in the menu', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const onToggleBookmark = vi.fn();
    await act(async () => {
      root.render(<GraphContainerHeader {...buildProps({ onToggleBookmark })} />);
    });

    const bookmarkButton = document.querySelector(
      'button[aria-label="Bookmark"]',
    ) as HTMLButtonElement | null;
    expect(bookmarkButton).toBeTruthy();
    await act(async () => bookmarkButton?.click());
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);

    const menuButton = document.querySelector(
      'button[aria-label="group options"]',
    ) as HTMLButtonElement | null;
    await act(async () => menuButton?.click());
    const menuBookmarkButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Bookmark') as HTMLButtonElement | undefined;
    expect(menuBookmarkButton).toBeUndefined();
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
  });
});
