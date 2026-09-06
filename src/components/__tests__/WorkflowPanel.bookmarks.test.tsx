import { act, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useBookmarksStore } from '@/hooks/useBookmarks';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';

vi.mock('@/hooks/useRepositionMode', () => ({
  useRepositionMode: () => ({
    overlayOpen: false,
    initialTarget: null,
    initialViewportAnchor: null,
    commitAndClose: vi.fn(),
    cancelOverlay: vi.fn(),
  }),
}));

vi.mock('@/components/RepositionOverlay', () => ({ RepositionOverlay: () => null }));
vi.mock('@/components/WorkflowPanel/NodeCard', () => ({
  NodeCard: ({ node }: { node: WorkflowNode }) => (
    <div data-testid={`node-card-${node.id}`}>
      {String(Array.isArray(node.widgets_values) ? (node.widgets_values[0] ?? '') : '')}
    </div>
  ),
}));
vi.mock('@/components/WorkflowPanel/ContainerFooter', () => ({ ContainerFooter: () => null }));
vi.mock('@/components/WorkflowPanel/GraphContainer/Header', () => ({ GraphContainerHeader: () => null }));
vi.mock('@/components/WorkflowPanel/GraphContainer/Placeholder', () => ({ GraphContainerPlaceholder: () => null }));
vi.mock('@/components/modals/AddNodeModal', () => ({ AddNodeModal: () => null }));
vi.mock('@/components/modals/DeleteContainerModal', () => ({ DeleteContainerModal: () => null }));
vi.mock('@/components/SearchBar', () => ({
  SearchBar: ({
    inputRef,
    placeholder,
  }: {
    inputRef?: Ref<HTMLInputElement>;
    placeholder?: string;
  }) => <input ref={inputRef} placeholder={placeholder} />,
}));

function makeNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: makeLocationPointer({ type: 'node', nodeId: id, subgraphId: null }),
    type: 'Any',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  };
}

describe('WorkflowPanel bookmark navigation', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined;
  let hadOwnScrollIntoView: boolean;

  beforeEach(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    hadOwnScrollIntoView = Object.prototype.hasOwnProperty.call(
      Element.prototype,
      'scrollIntoView',
    );
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    useWorkflowStore.setState({
      workflow: null,
      originalWorkflow: null,
      nodeTypes: {},
      hiddenItems: {},
      collapsedItems: {},
      connectionHighlightModes: {},
      mobileLayout: createEmptyMobileLayout(),
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
      scopeStack: [{ type: 'root' }],
      currentWorkflowKey: null,
      savedWorkflowStates: {},
      executingNodeId: null,
      executingNodePath: null,
      executingPromptId: null,
      nodeOutputs: {},
      nodeTextOutputs: {},
      promptOutputs: {},
      searchOpen: false,
      searchQuery: '',
    });
    useBookmarksStore.setState({
      bookmarkedItems: [],
      bookmarkBarSide: 'right',
      bookmarkBarTop: 24,
      bookmarkBarCollapsed: false,
      bookmarkRepositioningActive: false,
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
    if (hadOwnScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: originalScrollIntoView,
      });
    } else {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('switches to the bookmarked node scope before scrolling to it', async () => {
    const placeholder = makeNode(5, {
      type: 'sg-a',
      itemKey: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null }),
    });
    const innerNodeKey = makeLocationPointer({ type: 'node', nodeId: 10, subgraphId: 'sg-a' });
    const innerNode = makeNode(10, {
      itemKey: innerNodeKey,
      type: 'InnerNode',
      bgcolor: '#553333',
    });
    const workflow: Workflow = {
      id: 'bookmark-scope-test',
      last_node_id: 10,
      last_link_id: 0,
      nodes: [placeholder],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          {
            id: 'sg-a',
            itemKey: makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' }),
            nodes: [innerNode],
            groups: [],
            links: [],
            config: {},
          },
        ],
      },
    };

    const revealNodeWithParents = vi.fn();
    const scrollToNode = vi.fn();

    useWorkflowStore.setState({
      workflow,
      nodeTypes: {
        InnerNode: {
          input: { required: {} },
          output: [],
          name: 'InnerNode',
          display_name: 'Inner Node',
          description: '',
          python_module: '',
          category: 'test',
        },
      },
      mobileLayout: {
        root: [{ type: 'subgraph', id: 'sg-a', nodeId: 5 }],
        groups: {},
        groupParents: {},
        subgraphs: {
          'sg-a': [{ type: 'node', id: 10 }],
        },
        hiddenBlocks: {},
      },
      itemKeyByPointer: {
        [makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null })]: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null }),
        [innerNodeKey]: innerNodeKey,
        [makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' })]: makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' }),
      },
      pointerByHierarchicalKey: {
        [makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null })]: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null }),
        [innerNodeKey]: innerNodeKey,
        [makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' })]: makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' }),
      },
      revealNodeWithParents,
      scrollToNode,
    });
    useBookmarksStore.setState({
      bookmarkedItems: [innerNodeKey],
      bookmarkBarSide: 'right',
      bookmarkBarTop: 24,
      bookmarkBarCollapsed: false,
      bookmarkRepositioningActive: false,
    });

    await act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });

    const bookmarkButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '10',
    );
    expect(bookmarkButton).toBeTruthy();
    // Exactly the colour the node's own card paints (#553333 at the card's 0.4
    // tint over the panel surface), carried at the chip alpha so the node list
    // shows faintly through. See utils/workflowSurfaceColor.ts.
    expect((bookmarkButton as HTMLButtonElement).style.backgroundColor).toBe(
      'rgba(35, 24, 34, 0.9)',
    );

    await act(async () => {
      bookmarkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Travelling to the right scope and revealing ancestors belong to the
    // shared jump and are covered in its own suite. The bar's part is naming
    // the right destination — which, for a bookmark inside a subgraph, is the
    // thing that used to need a scope-change state machine here.
    expect(scrollToNode).toHaveBeenCalledWith(innerNodeKey, undefined, undefined);
  });

  it('leaves workflow selection mode on Escape', async () => {
    await act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });
    await act(async () => {
      useWorkflowSelectionStore.setState({
        selectionMode: true,
        selectedKeys: ['root/node:1'],
      });
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useWorkflowSelectionStore.getState()).toMatchObject({
      selectionMode: false,
      selectedKeys: [],
    });
  });

  it('opens workflow search and focuses it with Command+F', async () => {
    const itemKey = makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null });
    const workflow: Workflow = {
      id: 'search-shortcut-test',
      last_node_id: 1,
      last_link_id: 0,
      nodes: [makeNode(1, { itemKey })],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const layout = createEmptyMobileLayout();
    layout.root = [{ type: 'node', id: 1 }];
    useWorkflowStore.setState({
      workflow,
      mobileLayout: layout,
      itemKeyByPointer: { [itemKey]: itemKey },
      pointerByHierarchicalKey: { [itemKey]: itemKey },
    });

    await act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });
    const nodeList = container.querySelector<HTMLElement>('#node-list-container');
    if (nodeList) nodeList.scrollTo = vi.fn();

    const shortcut = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.dispatchEvent(shortcut);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search nodes..."]');
    expect(shortcut.defaultPrevented).toBe(true);
    expect(useWorkflowStore.getState().searchOpen).toBe(true);
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('refocuses an already-open workflow search with Command+F', async () => {
    const itemKey = makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null });
    const layout = createEmptyMobileLayout();
    layout.root = [{ type: 'node', id: 1 }];
    useWorkflowStore.setState({
      workflow: {
        id: 'search-refocus-test',
        last_node_id: 1,
        last_link_id: 0,
        nodes: [makeNode(1, { itemKey })],
        links: [],
        groups: [],
        config: {},
        version: 1,
      },
      mobileLayout: layout,
      itemKeyByPointer: { [itemKey]: itemKey },
      pointerByHierarchicalKey: { [itemKey]: itemKey },
    });

    await act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });
    const nodeList = container.querySelector<HTMLElement>('#node-list-container');
    if (nodeList) nodeList.scrollTo = vi.fn();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search nodes..."]');
    const otherInput = document.createElement('input');
    container.appendChild(otherInput);
    otherInput.focus();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(document.activeElement).toBe(input);
  });

  it('refreshes rendered node data when widget values change without a layout change', async () => {
    const itemKey = makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null });
    const imageNode = makeNode(1, {
      itemKey,
      type: 'LoadImage',
      widgets_values: ['before.png'],
    });
    const workflow: Workflow = {
      id: 'live-widget-preview-test',
      last_node_id: 1,
      last_link_id: 0,
      nodes: [imageNode],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const layout = createEmptyMobileLayout();
    layout.root = [{ type: 'node', id: 1 }];
    useWorkflowStore.setState({
      workflow,
      mobileLayout: layout,
      itemKeyByPointer: { [itemKey]: itemKey },
      pointerByHierarchicalKey: { [itemKey]: itemKey },
    });

    await act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });
    expect(container.querySelector('[data-testid="node-card-1"]')?.textContent).toBe('before.png');

    await act(async () => {
      useWorkflowStore.getState().updateNodeWidget(itemKey, 0, 'after.png', 'image');
    });
    expect(container.querySelector('[data-testid="node-card-1"]')?.textContent).toBe('after.png');
  });

  it('navigates to the correct bookmark when root and subgraph nodes share the same id', async () => {
    const rootNodeKey = makeLocationPointer({ type: 'node', nodeId: 958, subgraphId: null });
    const innerNodeKey = makeLocationPointer({ type: 'node', nodeId: 958, subgraphId: 'sg-a' });
    const placeholder = makeNode(5, {
      type: 'sg-a',
      itemKey: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null }),
    });
    const rootNode = makeNode(958, {
      itemKey: rootNodeKey,
      type: 'Root958',
    });
    const innerNode = makeNode(958, {
      itemKey: innerNodeKey,
      type: 'Inner958',
    });
    const workflow: Workflow = {
      id: 'bookmark-id-collision-test',
      last_node_id: 958,
      last_link_id: 0,
      nodes: [rootNode, placeholder],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          {
            id: 'sg-a',
            itemKey: makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' }),
            nodes: [innerNode],
            groups: [],
            links: [],
            config: {},
          },
        ],
      },
    };

    const revealNodeWithParents = vi.fn();
    const scrollToNode = vi.fn();

    useWorkflowStore.setState({
      workflow,
      nodeTypes: {
        Root958: {
          input: { required: {} },
          output: [],
          name: 'Root958',
          display_name: 'Root 958',
          description: '',
          python_module: '',
          category: 'test',
        },
        Inner958: {
          input: { required: {} },
          output: [],
          name: 'Inner958',
          display_name: 'Inner 958',
          description: '',
          python_module: '',
          category: 'test',
        },
      },
      mobileLayout: {
        root: [{ type: 'node', id: 958 }, { type: 'subgraph', id: 'sg-a', nodeId: 5 }],
        groups: {},
        groupParents: {},
        subgraphs: {
          'sg-a': [{ type: 'node', id: 958 }],
        },
        hiddenBlocks: {},
      },
      itemKeyByPointer: {
        [rootNodeKey]: rootNodeKey,
        [makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null })]: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null }),
        [innerNodeKey]: innerNodeKey,
        [makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' })]: makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' }),
      },
      pointerByHierarchicalKey: {
        [rootNodeKey]: rootNodeKey,
        [makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null })]: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null }),
        [innerNodeKey]: innerNodeKey,
        [makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' })]: makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' }),
      },
      revealNodeWithParents,
      scrollToNode,
    });
    useBookmarksStore.setState({
      bookmarkedItems: [innerNodeKey],
      bookmarkBarSide: 'right',
      bookmarkBarTop: 24,
      bookmarkBarCollapsed: false,
      bookmarkRepositioningActive: false,
    });

    await act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });

    const bookmarkButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '958',
    );
    expect(bookmarkButton).toBeTruthy();

    await act(async () => {
      bookmarkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Travelling to the right scope and revealing ancestors belong to the
    // shared jump and are covered in its own suite. The bar's part is naming
    // the right destination — which, for a bookmark inside a subgraph, is the
    // thing that used to need a scope-change state machine here.
    expect(scrollToNode).toHaveBeenCalledWith(innerNodeKey, undefined, undefined);
  });


  it.each([
    { count: 5, expectBackButton: false },
    { count: 6, expectBackButton: true },
  ])(
    'shows the reverse cycle button only from 6 bookmarks ($count)',
    async ({ count, expectBackButton }) => {
      const nodes = Array.from({ length: count }, (_, index) => makeNode(index + 1));
      const workflow: Workflow = {
        id: 'bookmark-cycle-controls',
        revision: 0,
        last_node_id: count,
        last_link_id: 0,
        nodes,
        links: [],
        groups: [],
        config: {},
        extra: {},
        version: 0.4,
      };
      const layout = createEmptyMobileLayout();
      layout.root = nodes.map((node) => ({ type: 'node' as const, id: node.id }));
      const keys = nodes.map((node) => node.itemKey!);
      useWorkflowStore.setState({
        workflow,
        mobileLayout: layout,
        itemKeyByPointer: Object.fromEntries(keys.map((key) => [key, key])),
        pointerByHierarchicalKey: Object.fromEntries(keys.map((key) => [key, key])),
      });
      useBookmarksStore.setState({
        bookmarkedItems: keys,
        bookmarkBarSide: 'right',
        bookmarkBarTop: 24,
        bookmarkRepositioningActive: false,
      });

      await act(async () => {
        root.render(<WorkflowPanel visible={true} />);
      });

      const back = container.querySelector('[aria-label="Cycle bookmarks backwards"]');
      const forward = container.querySelector('[aria-label="Cycle bookmarks"]');
      expect(Boolean(back)).toBe(expectBackButton);
      // The forward control is there from two bookmarks up, either way.
      expect(forward).toBeTruthy();

      // Both stay pinned outside the scrolling list so they're reachable
      // however far it is scrolled.
      const list = container.querySelector('[data-bookmark-scroll="true"]');
      expect(list).toBeTruthy();
      expect(list!.contains(forward!)).toBe(false);
      if (back) expect(list!.contains(back)).toBe(false);
      expect(list!.querySelectorAll('[data-bookmark-flash-key]')).toHaveLength(count);
    },
  );

  it('renders desktop bookmarks as workflow-ordered named bars with parent context and removal', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const firstKey = makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null });
    const lastKey = makeLocationPointer({ type: 'node', nodeId: 2, subgraphId: null });
    const placeholderKey = makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null });
    const subgraphKey = makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' });
    const innerGroupKey = makeLocationPointer({ type: 'group', groupId: 7, subgraphId: 'sg-a' });
    const innerKey = makeLocationPointer({ type: 'node', nodeId: 10, subgraphId: 'sg-a' });
    const workflow: Workflow = {
      id: 'desktop-bookmark-bars',
      last_node_id: 10,
      last_link_id: 0,
      nodes: [
        makeNode(1, { itemKey: firstKey, title: 'First node', bgcolor: '#553333' }),
        makeNode(5, {
          itemKey: placeholderKey,
          type: 'sg-a',
          title: 'Nested workflow',
          bgcolor: '#335533',
        }),
        makeNode(2, { itemKey: lastKey, title: 'Last node' }),
      ],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [{
          id: 'sg-a',
          itemKey: subgraphKey,
          name: 'Fallback subgraph name',
          nodes: [makeNode(10, {
            itemKey: innerKey,
            type: 'KSampler',
            title: 'Inner sampler',
            bgcolor: '#333355',
          })],
          groups: [{
            id: 7,
            itemKey: innerGroupKey,
            title: 'Sampler group',
            bounding: [0, 0, 300, 200],
            color: '#553355',
          }],
          links: [],
        }],
      },
    };

    useWorkflowStore.setState({
      workflow,
      mobileLayout: {
        root: [
          { type: 'node', id: 1 },
          { type: 'subgraph', id: 'sg-a', nodeId: 5 },
          { type: 'node', id: 2 },
        ],
        groups: {
          [innerGroupKey]: [{ type: 'node', id: 10 }],
        },
        groupParents: {
          [innerGroupKey]: { scope: 'subgraph', subgraphId: 'sg-a' },
        },
        subgraphs: {
          'sg-a': [{
            type: 'group',
            id: 7,
            subgraphId: 'sg-a',
            itemKey: innerGroupKey,
          }],
        },
        hiddenBlocks: {},
      },
      itemKeyByPointer: {
        [firstKey]: firstKey,
        [lastKey]: lastKey,
        [placeholderKey]: placeholderKey,
        [subgraphKey]: subgraphKey,
        [innerGroupKey]: innerGroupKey,
        [innerKey]: innerKey,
      },
      pointerByHierarchicalKey: {
        [firstKey]: firstKey,
        [lastKey]: lastKey,
        [placeholderKey]: placeholderKey,
        [subgraphKey]: subgraphKey,
        [innerGroupKey]: innerGroupKey,
        [innerKey]: innerKey,
      },
    });
    // Deliberately reverse insertion order: the rendered order must come from
    // the workflow panel layout, not from when each bookmark was added.
    useBookmarksStore.setState({ bookmarkedItems: [lastKey, innerKey, firstKey] });

    await act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });

    const bar = container.querySelector('.desktop-bookmark-bar') as HTMLDivElement | null;
    const entries = Array.from(container.querySelectorAll('.desktop-bookmark-entry'));
    expect(bar?.style.left).toBe('calc(50% + 24.75rem)');
    expect(bar?.style.width).toBe('max-content');
    expect(bar?.style.minWidth).toBe('6.5rem');
    expect(bar?.style.maxWidth).toBe('calc(50% - 25.5rem)');
    expect(entries.map((entry) => entry.querySelector('button[title]')?.textContent)).toEqual([
      'First node',
      'Inner sampler',
      'Last node',
    ]);
    expect(entries[1]?.textContent).toContain(
      '→Nested workflow→Sampler group',
    );
    expect((entries[0] as HTMLElement).style.backgroundColor).toBe(
      'rgba(35, 24, 34, 0.9)',
    );
    expect(entries.every((entry) => entry.hasAttribute('data-bookmark-flash-key'))).toBe(true);
    const parentChips = Array.from(
      entries[1]?.querySelectorAll('.bookmark-parent-chip') ?? [],
    ) as HTMLElement[];
    expect(parentChips.map((chip) => chip.textContent)).toEqual([
      'Nested workflow',
      'Sampler group',
    ]);
    // A subgraph parent renders as a node card (0.4 tint); a group parent
    // renders as a group header (0.15 twice, over its own wrapper fill).
    expect(parentChips.map((chip) => chip.style.backgroundColor)).toEqual([
      'rgba(22, 38, 34, 0.9)',
      'rgba(25, 19, 40, 0.9)',
    ]);

    await act(async () => {
      (parentChips[1] as HTMLButtonElement)?.click();
    });
    expect(useWorkflowStore.getState().scopeStack).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: 'sg-a', placeholderNodeId: 5 },
    ]);

    await act(async () => {
      useBookmarksStore.getState().setBookmarkBarPosition({ side: 'left' });
    });
    expect(bar?.style.left).toBe('');
    // The chip above entered a subgraph, so the exit button now holds the top
    // of the left gutter. The bar keeps the gutter's column — stepping sideways
    // would put it over the node list — and starts below the button instead.
    expect(bar?.style.right).toBe('calc(50% + 24.75rem)');
    expect(container.querySelector('.subgraph-exit-desktop')).toBeTruthy();
    expect(bar?.style.maxHeight).toContain('68px');

    // And the bar is actually pushed down past the button, rather than merely
    // being allowed less height: parked at the top, it settles below it.
    const wrapper = bar!.parentElement as HTMLElement;
    Object.defineProperty(wrapper, 'offsetHeight', { value: 600, configurable: true });
    Object.defineProperty(bar!, 'offsetHeight', { value: 100, configurable: true });
    await act(async () => {
      useBookmarksStore.getState().setBookmarkBarPosition({ top: 0 });
    });
    expect(useBookmarksStore.getState().bookmarkBarTop).toBe(68);

    // The right side has nothing above it, so the floor drops back to 16 —
    // and crossing back to the left has to raise it again, which is what a
    // clamp computed from the side being LEFT rather than the side being
    // landed on would miss.
    await act(async () => {
      useBookmarksStore.getState().setBookmarkBarPosition({ side: 'right', top: 0 });
    });
    expect(useBookmarksStore.getState().bookmarkBarTop).toBe(16);
    await act(async () => {
      useBookmarksStore.getState().setBookmarkBarPosition({ side: 'left', top: 0 });
    });
    expect(useBookmarksStore.getState().bookmarkBarTop).toBe(68);

    await act(async () => {
      useWorkflowStore.getState().exitToRoot();
    });
    // Back at root there is nothing above it to clear.
    expect(bar?.style.maxHeight).toContain('16px');

    // The whole entry jumps, not just its label — but the remove button and the
    // parent chips inside it keep their own actions.
    const wholeEntry = entries[0] as HTMLElement;
    await act(async () => { wholeEntry.click(); });
    expect(useWorkflowStore.getState().scopeStack).toEqual([{ type: 'root' }]);

    await act(async () => {
      (entries[1]?.querySelector('.desktop-bookmark-remove') as HTMLButtonElement)?.click();
    });
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([lastKey, firstKey]);

    // Collapsing is pinned above the list, so it stays reachable in a bar too
    // tall to scroll to the end of — which is when you most want it.
    const collapse = container.querySelector<HTMLButtonElement>('.desktop-bookmark-collapse')!;
    expect(collapse.textContent).toContain('Collapse bookmarks');
    await act(async () => collapse.click());

    expect(useBookmarksStore.getState().bookmarkBarCollapsed).toBe(true);
    expect(container.querySelector('.desktop-bookmark-entry')).toBeNull();
    // One button in its place, and the gutter no longer holds a column's width
    // — otherwise the reposition outline would be drawn around the reserved
    // width rather than around the button.
    const collapsed = container.querySelector<HTMLButtonElement>('.bookmark-bar-collapsed')!;
    expect(collapsed).toBeTruthy();
    expect(container.querySelector('.desktop-bookmark-bar')).toBeNull();
    const gutter = collapsed.parentElement as HTMLElement;
    expect(gutter.style.minWidth).toBe('');
    expect(gutter.style.width).toBe('');

    await act(async () => collapsed.click());
    expect(useBookmarksStore.getState().bookmarkBarCollapsed).toBe(false);
    expect(container.querySelectorAll('.desktop-bookmark-entry')).toHaveLength(2);
  });

  // A three-node root workflow with every node bookmarked, rendered on mobile
  // (no matchMedia stub, so the form factor is phone-sized).
  function renderMobileBookmarkBar() {
    const nodes = [makeNode(1), makeNode(2), makeNode(3)];
    const keys = nodes.map((node) => node.itemKey!);
    const workflow: Workflow = {
      id: 'bookmark-interaction-test',
      last_node_id: 3,
      last_link_id: 0,
      nodes,
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const layout = createEmptyMobileLayout();
    layout.root = nodes.map((node) => ({ type: 'node' as const, id: node.id }));
    useWorkflowStore.setState({
      workflow,
      mobileLayout: layout,
      itemKeyByPointer: Object.fromEntries(keys.map((key) => [key, key])),
      pointerByHierarchicalKey: Object.fromEntries(keys.map((key) => [key, key])),
    });
    useBookmarksStore.setState({
      bookmarkedItems: keys,
      bookmarkBarSide: 'right',
      bookmarkBarTop: 24,
      // Explicit, because collapsing persists and the store outlives a test.
      bookmarkBarCollapsed: false,
      bookmarkBarCollapsedTop: null,
    });
    return act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });
  }

  function barElement(): HTMLElement {
    const list = container.querySelector('[data-bookmark-scroll="true"]');
    if (!list) throw new Error('bookmark list not rendered');
    const bar = (list as HTMLElement).parentElement?.parentElement;
    if (!bar) throw new Error('bookmark bar not rendered');
    return bar as HTMLElement;
  }

  /** jsdom reports every element as 0-high; give one a height to measure. */
  function stubHeight(element: HTMLElement, height: number) {
    Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true });
  }

  /** A short, fast, mostly-horizontal touch release — the flick. */
  async function flickBar(bar: HTMLElement, fromX: number, toX: number) {
    // jsdom does not implement capture; the handler only needs it to exist.
    bar.setPointerCapture = vi.fn();
    bar.releasePointerCapture = vi.fn();
    await act(async () => {
      bar.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'touch',
        clientX: fromX,
        clientY: 120,
      }));
      bar.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerType: 'touch',
        clientX: toX,
        clientY: 118,
      }));
    });
  }

  it('flips the bar to the opposite side on a flick away from its edge', async () => {
    await renderMobileBookmarkBar();
    const bar = barElement();
    expect(bar.style.right).toBe('0.75rem');

    // Pinned right, flicked left: the bar is being sent across, not dismissed.
    await flickBar(bar, 160, 100);

    expect(useBookmarksStore.getState().bookmarkBarSide).toBe('left');
    expect(useBookmarksStore.getState().bookmarkBarCollapsed).toBe(false);
    // And the bar actually re-anchors on the other edge of the panel.
    expect(bar.style.left).toBe('0.75rem');
    expect(bar.style.right).toBe('');
  });

  it('collapses the bar on a flick toward the edge it is pinned to', async () => {
    await renderMobileBookmarkBar();

    // Pinned right, flicked right: out of the way, not across.
    await flickBar(barElement(), 100, 160);

    expect(useBookmarksStore.getState().bookmarkBarCollapsed).toBe(true);
    expect(useBookmarksStore.getState().bookmarkBarSide).toBe('right');
    // The list is gone; one button stands in for it.
    expect(container.querySelector('[data-bookmark-scroll="true"]')).toBeNull();
    expect(container.querySelector('button.bookmark-bar-collapsed')).toBeTruthy();
  });

  it('keeps the collapsed button where it was left, apart from the bar', async () => {
    await renderMobileBookmarkBar();
    await flickBar(barElement(), 100, 160);

    // Carry the collapsed button somewhere of its own.
    await act(async () => {
      useBookmarksStore.getState().setBookmarkBarPosition({ collapsedTop: 300 });
    });
    expect(useBookmarksStore.getState().bookmarkBarCollapsedTop).toBe(300);
    // The expanded bar's own offset is untouched by moving the button.
    expect(useBookmarksStore.getState().bookmarkBarTop).toBe(24);

    const collapsed = container.querySelector<HTMLButtonElement>('button.bookmark-bar-collapsed')!;
    await act(async () => collapsed.click());

    // Expanding placed the bar for itself; the button still remembers its spot,
    // so re-collapsing returns it there rather than to wherever the bar went.
    expect(useBookmarksStore.getState().bookmarkBarCollapsedTop).toBe(300);
  });

  it('never opens the bar somewhere it would not fit', async () => {
    await renderMobileBookmarkBar();
    const bar = barElement();
    // jsdom lays nothing out, so the clamp has no geometry to work from unless
    // the gutter and its wrapper are given some: a 600px panel, a 400px bar.
    // `offsetHeight`, which is what the clamp measures — the bounding rect
    // would be the transformed box, and the bar animates as it opens.
    stubHeight(bar.parentElement as HTMLElement, 600);
    stubHeight(bar, 400);

    await flickBar(bar, 100, 160);

    // Park the button near the bottom, where a full-height bar cannot open.
    await act(async () => {
      useBookmarksStore.getState().setBookmarkBarPosition({ collapsedTop: 100000 });
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.bookmark-bar-collapsed')!.click();
    });

    // Pulled back up rather than opening off the bottom of the panel.
    const { bookmarkBarTop, bookmarkBarCollapsedTop } = useBookmarksStore.getState();
    expect(bookmarkBarTop).toBeLessThan(100000);
    // And the button's own offset was not rewritten by that correction.
    expect(bookmarkBarCollapsedTop).toBe(100000);
  });

  it('pulls the open bar back in when it no longer fits where it sits', async () => {
    await renderMobileBookmarkBar();
    const bar = barElement();
    stubHeight(bar.parentElement as HTMLElement, 600);

    // Parked low while it was short, then grown tall — bookmarks added while it
    // was collapsed, say. Nothing collapsed or expanded here, so a correction
    // that only ran on that transition would never fire.
    await act(async () => {
      useBookmarksStore.getState().setBookmarkBarPosition({ top: 500 });
    });
    stubHeight(bar, 400);
    await act(async () => {
      useBookmarksStore.setState({ bookmarkedItems: [...useBookmarksStore.getState().bookmarkedItems] });
    });

    // 600 tall, 400 of bar, 8 of bottom gap: as low as it can start is 192.
    expect(useBookmarksStore.getState().bookmarkBarTop).toBe(192);
  });

  it('moves both forms to the same side, since the gutter has only one edge', async () => {
    await renderMobileBookmarkBar();
    await flickBar(barElement(), 100, 160);

    await act(async () => {
      useBookmarksStore.getState().setBookmarkBarPosition({ side: 'left', collapsedTop: 200 });
    });

    expect(useBookmarksStore.getState().bookmarkBarSide).toBe('left');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.bookmark-bar-collapsed')!.click();
    });
    // Expanding keeps the side the button was on.
    expect(useBookmarksStore.getState().bookmarkBarSide).toBe('left');
  });

  it('collapses on a swipe that starts on a bookmark, without following it', async () => {
    await renderMobileBookmarkBar();
    const bar = barElement();
    bar.setPointerCapture = vi.fn();
    bar.releasePointerCapture = vi.fn();
    const entry = container.querySelector<HTMLButtonElement>('[data-bookmark-flash-key] button')
      ?? container.querySelector<HTMLButtonElement>('button[aria-label]')!;
    const scopeBefore = useWorkflowStore.getState().scopeStack;

    // The swipe begins on a bookmark, so the browser still fires that button's
    // click after the gesture. Collapsing must not also navigate to it.
    await act(async () => {
      entry.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'touch', clientX: 100, clientY: 120,
      }));
      entry.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerType: 'touch', clientX: 160, clientY: 118,
      }));
      entry.click();
    });

    expect(useBookmarksStore.getState().bookmarkBarCollapsed).toBe(true);
    expect(useWorkflowStore.getState().scopeStack).toEqual(scopeBefore);
  });

  it('scrolls the bookmark list only vertically', async () => {
    await renderMobileBookmarkBar();
    const list = container.querySelector<HTMLElement>('[data-bookmark-scroll="true"]')!;

    // Otherwise a sideways drag on an entry is eaten as a horizontal scroll
    // that rubber-bands back, and never reaches the collapse gesture.
    expect(list.className).toContain('overflow-x-hidden');
    expect(list.style.touchAction).toBe('pan-y');
  });

  it('ends repositioning when the collapsed gutter is tapped, without expanding', async () => {
    await renderMobileBookmarkBar();
    await flickBar(barElement(), 100, 160);
    // Collapsed, the gutter has no list to find it by — it IS the button.
    const bar = container.querySelector<HTMLElement>('.bookmark-bar-collapsed')!
      .parentElement as HTMLElement;
    bar.setPointerCapture = vi.fn();
    bar.releasePointerCapture = vi.fn();

    // Hold to enter the mode.
    vi.useFakeTimers();
    try {
      await act(async () => {
        bar.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, pointerType: 'touch', clientX: 100, clientY: 120,
        }));
        vi.advanceTimersByTime(600);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(useBookmarksStore.getState().bookmarkRepositioningActive).toBe(true);

    // Releasing the hold that STARTED the mode must leave it on — the finger
    // is stationary there too, so this is the press most easily mistaken for
    // the tap that ends it.
    await act(async () => {
      bar.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerType: 'touch', clientX: 101, clientY: 121,
      }));
    });
    expect(useBookmarksStore.getState().bookmarkRepositioningActive).toBe(true);

    // A fresh tap, begun with the mode already on, means "done" — and must not
    // also un-collapse the gutter.
    // Separate acts: the press starts a drag, and the release's handler only
    // sees that once React has re-rendered — which it does between two real
    // events, but not inside one batched block.
    await act(async () => {
      bar.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'touch', clientX: 100, clientY: 120,
      }));
    });
    await act(async () => {
      bar.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerType: 'touch', clientX: 101, clientY: 121,
      }));
    });

    expect(useBookmarksStore.getState().bookmarkRepositioningActive).toBe(false);
    expect(useBookmarksStore.getState().bookmarkBarCollapsed).toBe(true);
  });

  it('expands again when the collapsed button is tapped', async () => {
    await renderMobileBookmarkBar();
    await flickBar(barElement(), 100, 160);

    const collapsed = container.querySelector<HTMLButtonElement>('button.bookmark-bar-collapsed')!;
    await act(async () => collapsed.click());

    expect(useBookmarksStore.getState().bookmarkBarCollapsed).toBe(false);
    expect(container.querySelector('[data-bookmark-scroll="true"]')).toBeTruthy();
  });

  it('taps on a faded edge scroll the list instead of activating the end bookmark', async () => {
    // Navigation calls must stay silent — the tap is a scroll, not a jump.
    const revealNodeWithParents = vi.fn();
    const scrollToNode = vi.fn();
    useWorkflowStore.setState({ revealNodeWithParents, scrollToNode });

    await renderMobileBookmarkBar();
    const list = container.querySelector('[data-bookmark-scroll="true"]') as HTMLElement;
    // Give the list real scroll geometry: 300 of content, 100 visible.
    Object.defineProperty(list, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 60, configurable: true });
    // jsdom does not implement `Element.scrollTo`/`scrollBy`; give the list
    // the real methods it uses, as spies.
    const listScrollTo = vi.fn();
    const listScrollBy = vi.fn();
    (list as { scrollTo?: unknown }).scrollTo = listScrollTo;
    (list as { scrollBy?: unknown }).scrollBy = listScrollBy;

    await act(async () => {
      list.dispatchEvent(new Event('scroll'));
    });

    // Scrolled into the middle, so both ends are clipped and both fade
    // tap-zones are up.
    const upZone = container.querySelector('[aria-label="Scroll bookmarks up"]');
    const downZone = container.querySelector('[aria-label="Scroll bookmarks down"]');
    expect(upZone).toBeTruthy();
    expect(downZone).toBeTruthy();

    await act(async () => {
      (downZone as HTMLButtonElement).click();
    });

    // With no entry measurable past the edge in jsdom, the edge tap falls
    // back to scrolling the list to its end — and, either way, it must scroll
    // rather than activate.
    expect(listScrollTo).toHaveBeenCalled();
    const firstCall = listScrollTo.mock.calls[0]?.[0] as { top?: number };
    if (firstCall !== undefined) expect(firstCall.top).toBe(300);
    expect(revealNodeWithParents).not.toHaveBeenCalled();
    expect(scrollToNode).not.toHaveBeenCalled();
  });

  it('rings the bookmark button once the jump target arrives', async () => {
    const revealNodeWithParents = vi.fn();
    const scrollToNode = vi.fn();
    useWorkflowStore.setState({ revealNodeWithParents, scrollToNode });

    await renderMobileBookmarkBar();
    const button = container.querySelector('[data-bookmark-flash-key]') as HTMLButtonElement;
    expect(button).toBeTruthy();

    // Activating the bookmark arms the arrival flash...
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(scrollToNode).toHaveBeenCalled();

    // ...and the flash lands when the node's smooth scroll settles.
    await act(async () => {
      window.dispatchEvent(new Event('workflow-node-highlighted'));
    });
    expect(button.classList.contains('bookmark-highlight-pulse')).toBe(true);

    // ...and is let go again a moment later.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });
    expect(button.classList.contains('bookmark-highlight-pulse')).toBe(false);
  });
});
