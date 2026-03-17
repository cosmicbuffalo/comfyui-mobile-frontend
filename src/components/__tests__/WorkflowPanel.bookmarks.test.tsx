import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useBookmarksStore } from '@/hooks/useBookmarks';
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
vi.mock('@/components/WorkflowPanel/NodeCard', () => ({ NodeCard: () => null }));
vi.mock('@/components/WorkflowPanel/AddNodePlaceholder', () => ({ AddNodePlaceholder: () => null }));
vi.mock('@/components/WorkflowPanel/ContainerFooter', () => ({ ContainerFooter: () => null }));
vi.mock('@/components/WorkflowPanel/GraphContainer/Header', () => ({ GraphContainerHeader: () => null }));
vi.mock('@/components/WorkflowPanel/GraphContainer/Placeholder', () => ({ GraphContainerPlaceholder: () => null }));
vi.mock('@/components/modals/AddNodeModal', () => ({ AddNodeModal: () => null }));
vi.mock('@/components/modals/DeleteContainerModal', () => ({ DeleteContainerModal: () => null }));
vi.mock('@/components/SearchBar', () => ({ SearchBar: () => null }));

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
    vi.stubGlobal('scrollIntoView', vi.fn());
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    } else {
      vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    }

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
      bookmarkRepositioningActive: false,
    });

    await act(async () => {
      root.render(<WorkflowPanel visible={true} />);
    });

    const bookmarkButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '10',
    );
    expect(bookmarkButton).toBeTruthy();

    await act(async () => {
      bookmarkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useWorkflowStore.getState().scopeStack).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: 'sg-a', placeholderNodeId: 5 },
    ]);
    expect(revealNodeWithParents).toHaveBeenCalledWith(innerNodeKey);
    expect(scrollToNode).toHaveBeenCalledWith(innerNodeKey, undefined);
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

    expect(useWorkflowStore.getState().scopeStack).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: 'sg-a', placeholderNodeId: 5 },
    ]);
    expect(revealNodeWithParents).toHaveBeenCalledWith(innerNodeKey);
    expect(scrollToNode).toHaveBeenCalledWith(innerNodeKey, undefined);
  });
});
