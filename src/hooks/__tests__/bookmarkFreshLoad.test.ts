import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';
import { useBookmarksStore } from '../useBookmarks';
import { useSeedStore } from '../useSeed';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

const nodeTypes: NodeTypes = {
  Any: {
    input: { required: { value: ['INT', { default: 0 }] } },
    output: [],
    output_name: [],
    name: 'Any',
    display_name: 'Any',
    description: '',
    python_module: '',
    category: 'test',
  },
};

function rootKey(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function makeNode(id: number): WorkflowNode {
  return {
    id,
    itemKey: rootKey(id),
    type: 'Any',
    pos: [0, id * 100],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [0],
  };
}

function makeWorkflow(ids: number[]): Workflow {
  return {
    last_node_id: Math.max(0, ...ids),
    last_link_id: 0,
    nodes: ids.map(makeNode),
    links: [],
    groups: [],
    config: {},
    version: 1,
  };
}

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null,
    originalWorkflow: null,
    nodeTypes,
    hiddenItems: {},
    collapsedItems: {},
    connectionHighlightModes: {},
    mobileLayout: createEmptyMobileLayout(),
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    scopeStack: [{ type: 'root' }],
    currentFilename: null,
    currentWorkflowKey: null,
    savedWorkflowStates: {},
    nodeOutputs: {},
    nodeTextOutputs: {},
    promptOutputs: {},
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    promptToSession: {},
  });
  useBookmarksStore.setState({ bookmarkedItems: [] });
  useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
  useWorkflowErrorsStore.setState({
    error: null,
    nodeErrors: {},
    errorCycleIndex: 0,
    errorsDismissed: false,
  });
});

describe('bookmarks across a fresh load', () => {
  it('keeps bookmarks when the same workflow is re-opened fresh', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([1, 2, 3]), 'a.json');
    useBookmarksStore.getState().toggleBookmark(rootKey(2));
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([rootKey(2)]);

    // What opening a workflow from the workflows list (or hitting Reload)
    // does: a pristine load that discards the cached widget/fold state.
    useWorkflowStore
      .getState()
      .loadWorkflow(makeWorkflow([1, 2, 3]), 'a.json', {
        fresh: true,
        replaceActive: true,
      });

    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([rootKey(2)]);
  });

  it('drops bookmarks whose node the fresh copy no longer has', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([1, 2, 3]), 'a.json');
    useBookmarksStore.getState().toggleBookmark(rootKey(2));
    useBookmarksStore.getState().toggleBookmark(rootKey(3));
    expect(useBookmarksStore.getState().bookmarkedItems).toHaveLength(2);

    // Same node types and count, so the workflow cache key is unchanged and
    // the saved state still applies — but node 3 was rebuilt as node 4, so
    // its bookmark no longer points at anything.
    useWorkflowStore
      .getState()
      .loadWorkflow(makeWorkflow([1, 2, 4]), 'a.json', {
        fresh: true,
        replaceActive: true,
      });

    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([rootKey(2)]);
  });
});
