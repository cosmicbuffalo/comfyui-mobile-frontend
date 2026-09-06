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
    vi.unstubAllGlobals();
  });

  it('shows Edit config only for relevant nodes and opens it from the menu', async () => {
    const onEditFastGroupsConfig = vi.fn();

    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={963}
          nodeHierarchicalKey="root/node:963"
          nodeType="rgthree.FastGroupsBypasser"
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
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
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
    const moveIndex = buttons.findIndex((button) => button.textContent?.includes('Move'));
    const editConfigIndex = buttons.findIndex((button) => button.textContent?.includes('Edit config'));
    const deleteIndex = buttons.findIndex((button) => button.textContent?.includes('Delete'));

    expect(changeColorIndex).toBeGreaterThan(-1);
    expect(moveIndex).toBeGreaterThan(changeColorIndex);
    expect(editConfigIndex).toBeGreaterThan(moveIndex);
    expect(deleteIndex).toBeGreaterThan(editConfigIndex);

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
          nodeType="SomeOtherNode"
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
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
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

  it('uses the persistent desktop bookmark shortcut without duplicating it in the menu', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const onToggleNodeBookmark = vi.fn();
    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={965}
          nodeHierarchicalKey="root/node:965"
          nodeType="SomeNode"
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
          onToggleNodeBookmark={onToggleNodeBookmark}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
          onMoveNode={() => {}}
          connectionHighlightMode="off"
          setConnectionHighlightMode={() => {}}
          leftLineCount={0}
          rightLineCount={0}
        />
      );
    });

    const bookmarkButton = document.querySelector(
      'button[aria-label="Bookmark node"]',
    ) as HTMLButtonElement | null;
    expect(bookmarkButton).toBeTruthy();
    await act(async () => bookmarkButton?.click());
    expect(onToggleNodeBookmark).toHaveBeenCalledTimes(1);

    const menuButton = document.querySelector(
      'button[aria-label="Node options"]',
    ) as HTMLButtonElement | null;
    await act(async () => menuButton?.click());
    const menuBookmarkButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Bookmark') as HTMLButtonElement | undefined;
    expect(menuBookmarkButton).toBeUndefined();
    expect(onToggleNodeBookmark).toHaveBeenCalledTimes(1);
  });

  it('offers moving a single node or placeholder into a subgraph', async () => {
    const onMoveIntoSubgraph = vi.fn();
    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={966}
          nodeHierarchicalKey="root/node:966"
          nodeType="SomeNode"
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
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
          onMoveNode={() => {}}
          onMoveIntoSubgraph={onMoveIntoSubgraph}
          connectionHighlightMode="off"
          setConnectionHighlightMode={() => {}}
          leftLineCount={0}
          rightLineCount={0}
        />,
      );
    });
    const menuButton = document.querySelector(
      'button[aria-label="Node options"]',
    ) as HTMLButtonElement;
    await act(async () => menuButton.click());
    const moveButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Move into subgraph') as HTMLButtonElement;
    expect(moveButton).toBeTruthy();
    await act(async () => moveButton.click());
    expect(onMoveIntoSubgraph).toHaveBeenCalledTimes(1);
  });

  it('promotes the only available widget immediately', async () => {
    const onPromoteWidget = vi.fn();
    const widget = { widgetIndex: 0, name: 'steps', inputName: 'steps', type: 'INT', value: 12 };
    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={967}
          nodeHierarchicalKey="subgraph:sg/node:967"
          nodeType="Sampler"
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
          promotableWidgets={[widget]}
          onPromoteWidget={onPromoteWidget}
          isNodeBookmarked={false}
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
          onMoveNode={() => {}}
          connectionHighlightMode="off"
          setConnectionHighlightMode={() => {}}
          leftLineCount={0}
          rightLineCount={0}
        />,
      );
    });
    await act(async () => {
      (document.querySelector('button[aria-label="Node options"]') as HTMLButtonElement).click();
    });
    const promote = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Promote widget') as HTMLButtonElement;
    await act(async () => promote.click());
    expect(onPromoteWidget).toHaveBeenCalledWith(widget);
  });

  it('opens a picker when multiple widgets can be promoted and hides the action when none can', async () => {
    const onPromoteWidget = vi.fn();
    const steps = { widgetIndex: 0, name: 'steps', inputName: 'steps', type: 'INT', value: 12 };
    const cfg = { widgetIndex: 1, name: 'cfg', inputName: 'cfg', type: 'FLOAT', value: 7 };
    const renderMenu = (promotableWidgets: typeof steps[]) => (
      <NodeCardMenu
        nodeId={968}
        nodeHierarchicalKey="subgraph:sg/node:968"
        nodeType="Sampler"
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
        promotableWidgets={promotableWidgets}
        onPromoteWidget={onPromoteWidget}
        isNodeBookmarked={false}
        onToggleNodeBookmark={() => {}}
        toggleBypass={() => {}}
        setItemHidden={() => {}}
        onDeleteNode={() => {}}
        onDuplicateNode={() => {}}
        onCopyNode={() => {}}
        onPasteBelow={() => {}}
        pasteSummary={null}
        onMoveNode={() => {}}
        connectionHighlightMode="off"
        setConnectionHighlightMode={() => {}}
        leftLineCount={0}
        rightLineCount={0}
      />
    );
    await act(async () => root.render(renderMenu([steps, cfg])));
    await act(async () => {
      (document.querySelector('button[aria-label="Node options"]') as HTMLButtonElement).click();
    });
    const promote = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Promote widget') as HTMLButtonElement;
    await act(async () => promote.click());
    expect(document.body.textContent).toContain('steps');
    expect(document.body.textContent).toContain('cfg');
    const cfgButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'cfg') as HTMLButtonElement;
    await act(async () => cfgButton.click());
    expect(onPromoteWidget).toHaveBeenCalledWith(cfg);

    await act(async () => root.render(renderMenu([])));
    await act(async () => {
      (document.querySelector('button[aria-label="Node options"]') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).not.toContain('Promote widget');
  });

  it('shows the subgraph-type actions only when their handlers are provided', async () => {
    const onReplaceSubgraph = vi.fn();
    const onDissolveSubgraph = vi.fn();
    const onEditSubgraphLabels = vi.fn();
    const onPopOutToRoot = vi.fn();

    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={7}
          nodeHierarchicalKey="root/node:7"
          nodeType="aaaaaaaa-0000-4000-8000-000000000000"
          isLoraManagerNode={false}
          showFastGroupsConfigAction={false}
          isBypassed={false}
          onEnterSubgraph={() => {}}
          onReplaceSubgraph={onReplaceSubgraph}
          onDissolveSubgraph={onDissolveSubgraph}
          onEditSubgraphLabels={onEditSubgraphLabels}
          onPopOutToRoot={onPopOutToRoot}
          onEditLabel={() => {}}
          onChangeColor={() => {}}
          pinnableWidgets={[]}
          singlePinnableWidget={null}
          isSingleWidgetPinned={false}
          hasPinnedWidget={false}
          toggleWidgetPin={() => {}}
          setPinnedWidget={() => {}}
          isNodeBookmarked={false}
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
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

    expect(document.body.textContent).toContain('Subgraph actions');
    expect(document.body.textContent).toContain('Pop out to root');
    expect(document.body.textContent).not.toContain('Replace subgraph');
    expect(document.body.textContent).not.toContain('Edit widget labels');
    expect(document.body.textContent).not.toContain('Dissolve subgraph');
    // Bypass is per-instance for placeholders, so it stays available here.
    expect(document.body.textContent).toContain('Bypass');

    const actionsButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Subgraph actions')) as HTMLButtonElement;
    await act(async () => {
      actionsButton.click();
    });
    for (const label of ['Replace subgraph', 'Edit widget labels', 'Dissolve subgraph']) {
      expect(document.body.textContent).toContain(label);
    }
    const replaceButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Replace subgraph')) as HTMLButtonElement;
    await act(async () => {
      replaceButton.click();
    });
    expect(onReplaceSubgraph).toHaveBeenCalledTimes(1);
  });

  it('hides the subgraph-type actions for regular nodes', async () => {
    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={8}
          nodeHierarchicalKey="root/node:8"
          nodeType="KSampler"
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
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
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

    for (const label of ['Replace subgraph', 'Edit widget labels', 'Dissolve subgraph', 'Pop out to root']) {
      expect(document.body.textContent).not.toContain(label);
    }
  });
});

describe('NodeCardMenu subgraph entry', () => {
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
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  const renderMenu = async (onEnterSubgraph?: () => void) => {
    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={814}
          nodeHierarchicalKey="root/node:814"
          nodeType="sg-1st-section"
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
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
          onMoveNode={() => {}}
          onEnterSubgraph={onEnterSubgraph}
          connectionHighlightMode="off"
          setConnectionHighlightMode={() => {}}
          leftLineCount={0}
          rightLineCount={0}
        />,
      );
    });

    const trigger = Array.from(document.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Node options',
    );
    await act(async () => trigger?.click());
  };

  it('puts Enter subgraph first, ahead of the cosmetic entries', async () => {
    await renderMenu(() => {});

    const labels = Array.from(document.querySelectorAll('button'))
      .map((button) => button.textContent?.trim())
      .filter((label): label is string => Boolean(label) && label !== '');
    // The trigger itself has no text, so the first labelled entry is the menu's.
    expect(labels[0]).toBe('Enter subgraph');
    expect(labels.indexOf('Enter subgraph')).toBeLessThan(labels.indexOf('Edit label'));
  });

  it('leaves it out entirely for a node that is not a subgraph', async () => {
    await renderMenu(undefined);

    const labels = Array.from(document.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain('Enter subgraph');
  });
});

describe('NodeCardMenu widget pickers', () => {
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
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  const widgets = [
    { widgetIndex: 0, name: 'steps', inputName: 'steps', type: 'INT', value: 20 },
    { widgetIndex: 1, name: 'cfg', inputName: 'cfg', type: 'FLOAT', value: 7.5 },
  ];

  const openMenu = async (overrides: Record<string, unknown>) => {
    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={7}
          nodeHierarchicalKey="root/node:7"
          nodeType="KSampler"
          isLoraManagerNode={false}
          showFastGroupsConfigAction={false}
          isBypassed={false}
          onEditLabel={() => {}}
          onChangeColor={() => {}}
          pinnableWidgets={widgets}
          singlePinnableWidget={null}
          isSingleWidgetPinned={false}
          hasPinnedWidget={false}
          toggleWidgetPin={() => {}}
          setPinnedWidget={() => {}}
          isNodeBookmarked={false}
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
          onMoveNode={() => {}}
          connectionHighlightMode="off"
          setConnectionHighlightMode={() => {}}
          leftLineCount={0}
          rightLineCount={0}
          {...overrides}
        />,
      );
    });
    const trigger = Array.from(document.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Node options',
    );
    await act(async () => trigger?.click());
  };

  const clickLabel = async (label: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    await act(async () => button?.click());
  };

  it('asks which widget to pin in a modal rather than unfolding the menu', async () => {
    const setPinnedWidget = vi.fn();
    await openMenu({ setPinnedWidget });

    // The menu itself lists the action once, not the widgets under it.
    const menuLabels = Array.from(document.querySelectorAll('button')).map((b) => b.textContent);
    expect(menuLabels).toContain('Pin widget');
    expect(menuLabels).not.toContain('steps');

    await clickLabel('Pin widget');

    const entries = Array.from(document.querySelectorAll('.widget-picker-entry')).map(
      (entry) => entry.textContent,
    );
    expect(entries).toEqual(['steps', 'cfg']);

    await clickLabel('cfg');
    expect(setPinnedWidget).toHaveBeenCalledWith({
      nodeId: 7,
      widgetIndex: 1,
      widgetName: 'cfg',
      inputName: 'cfg',
      widgetType: 'FLOAT',
      options: undefined,
    });
    // The modal closes behind the choice.
    expect(document.querySelector('.widget-picker-list')).toBeNull();
  });

  it('asks which widget to promote the same way', async () => {
    const onPromoteWidget = vi.fn();
    await openMenu({ promotableWidgets: widgets, onPromoteWidget });

    await clickLabel('Promote widget');
    const entries = Array.from(document.querySelectorAll('.widget-picker-entry')).map(
      (entry) => entry.textContent,
    );
    expect(entries).toEqual(['steps', 'cfg']);

    await clickLabel('steps');
    expect(onPromoteWidget).toHaveBeenCalledWith(widgets[0]);
  });

  it('pins directly when a node has only one pinnable widget', async () => {
    const toggleWidgetPin = vi.fn();
    await openMenu({
      pinnableWidgets: [widgets[0]],
      singlePinnableWidget: widgets[0],
      toggleWidgetPin,
    });

    await clickLabel('Pin widget');
    // No picker for a single choice — it just pins.
    expect(document.querySelector('.widget-picker-list')).toBeNull();
    expect(toggleWidgetPin).toHaveBeenCalledWith(0, 'steps', 'INT', undefined, 'steps');
  });

  it('opens the colour picker from the menu, and applies a colour', async () => {
    // "Change color" opens the popover and then closes the menu. Closing the
    // popover from the menu's own close ran in the same tick, so the picker
    // could never be reached at all.
    const onChangeColor = vi.fn();
    await act(async () => {
      root.render(
        <NodeCardMenu
          nodeId={970}
          nodeHierarchicalKey="root/node:970"
          nodeType="SomeNode"
          isLoraManagerNode={false}
          showFastGroupsConfigAction={false}
          isBypassed={false}
          onEditLabel={() => {}}
          onChangeColor={onChangeColor}
          pinnableWidgets={[]}
          singlePinnableWidget={null}
          isSingleWidgetPinned={false}
          hasPinnedWidget={false}
          toggleWidgetPin={() => {}}
          setPinnedWidget={() => {}}
          isNodeBookmarked={false}
          onToggleNodeBookmark={() => {}}
          toggleBypass={() => {}}
          setItemHidden={() => {}}
          onDeleteNode={() => {}}
          onDuplicateNode={() => {}}
          onCopyNode={() => {}}
          onPasteBelow={() => {}}
          pasteSummary={null}
          onMoveNode={() => {}}
          connectionHighlightMode="off"
          setConnectionHighlightMode={() => {}}
          leftLineCount={0}
          rightLineCount={0}
        />,
      );
    });

    await act(async () => {
      (document.querySelector('button[aria-label="Node options"]') as HTMLButtonElement).click();
    });
    const change = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Change color') as HTMLButtonElement;
    await act(async () => change.click());

    const swatches = document.querySelectorAll('button[aria-label^="Set color"]');
    expect(swatches.length).toBeGreaterThan(0);

    await act(async () => (swatches[1] as HTMLButtonElement).click());
    expect(onChangeColor).toHaveBeenCalledTimes(1);
  });
});