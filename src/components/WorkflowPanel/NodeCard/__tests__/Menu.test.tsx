import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeCardMenu } from '@/components/WorkflowPanel/NodeCard/Menu';

describe('NodeCardMenu fast groups actions', () => {
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

  it('shows Edit config only for relevant nodes and opens it from the menu', async () => {
    const onEditFastGroupsConfig = vi.fn();

    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={963}
          nodeHierarchicalKey="root/node:963"
          isLoraManagerNode={false}
          showFastGroupsConfigAction
          isBypassed={false}
          onEditLabel={() => {}}
          onEditFastGroupsConfig={onEditFastGroupsConfig}
          onChangeColor={() => {}}
          pinnableWidgets={[]}
          singlePinnableWidget={null}
          isSingleWidgetPinned={false}
          hasPinnedWidget={false}
          toggleWidgetPin={() => {}}
          setPinnedWidget={() => {}}
          isNodeBookmarked={false}
          canAddNodeBookmark={false}
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onMoveNode={() => {}}
          connectionHighlightMode="off"
          setConnectionHighlightMode={() => {}}
          leftLineCount={0}
          rightLineCount={0}
        />
      );
    });

    const menuButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Node options') as HTMLButtonElement | undefined;
    expect(menuButton).toBeTruthy();

    await act(async () => {
      menuButton?.click();
    });

    const buttons = Array.from(document.querySelectorAll('button'));
    const changeColorIndex = buttons.findIndex((button) => button.textContent?.includes('Change color'));
    const editConfigIndex = buttons.findIndex((button) => button.textContent?.includes('Edit config'));

    expect(changeColorIndex).toBeGreaterThan(-1);
    expect(editConfigIndex).toBe(changeColorIndex + 1);

    await act(async () => {
      buttons[editConfigIndex]?.click();
    });

    expect(onEditFastGroupsConfig).toHaveBeenCalledTimes(1);
  });

  it('hides Edit config for nodes where it is not relevant', async () => {
    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={964}
          nodeHierarchicalKey="root/node:964"
          isLoraManagerNode={false}
          showFastGroupsConfigAction={false}
          isBypassed={false}
          onEditLabel={() => {}}
          onChangeColor={() => {}}
          pinnableWidgets={[]}
          singlePinnableWidget={null}
          isSingleWidgetPinned={false}
          hasPinnedWidget={false}
          toggleWidgetPin={() => {}}
          setPinnedWidget={() => {}}
          isNodeBookmarked={false}
          canAddNodeBookmark={false}
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onMoveNode={() => {}}
          connectionHighlightMode="off"
          setConnectionHighlightMode={() => {}}
          leftLineCount={0}
          rightLineCount={0}
        />
      );
    });

    const menuButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Node options') as HTMLButtonElement | undefined;

    await act(async () => {
      menuButton?.click();
    });

    expect(document.body.textContent).not.toContain('Edit config');
  });
});
