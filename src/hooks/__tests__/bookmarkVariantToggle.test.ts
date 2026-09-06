import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';
import { useBookmarksStore } from '../useBookmarks';
import { useWorkflowLineageStore } from '../useWorkflowLineage';
import { useSeedStore } from '../useSeed';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';
import { createEmptyRegistry } from '@/utils/workflowLineage';

// Regression: bookmarking on one variant of a workflow family must not drop
// a mark another variant carries. The display set is filtered to the current
// workflow's nodes, so writing it across the whole lineage deletes, for the
// whole family, whatever a sibling variant holds that this one cannot show.
const NODE_TYPES: NodeTypes = {
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
    nodeTypes: NODE_TYPES,
    hiddenItems: {},
    collapsedItems: {},
    connectionHighlightModes: {},
    mobileLayout: createEmptyMobileLayout(),
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    scopeStack: [{ type: 'root' }],
    currentFilename: null,
    currentWorkflowKey: null,
    currentLineageId: null,
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
  useWorkflowLineageStore.setState({
    registry: createEmptyRegistry(),
    serverSynced: false,
    serverDirty: false,
    registryReady: true,
  });
  useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
  useWorkflowErrorsStore.setState({
    error: null,
    nodeErrors: {},
    errorCycleIndex: 0,
    errorsDismissed: false,
  });
});

describe('bookmark toggles on one variant', () => {
  it("never drops another variant's bookmark from the shared family", () => {
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([1, 2, 3, 4, 5, 6]), 'original.json');
    useBookmarksStore.getState().toggleBookmark(rootKey(6));
    const lineageId = useWorkflowStore.getState().currentLineageId!;

    // A descendant that dropped node 6 hides the mark...
    const trimmed = makeWorkflow([1, 2, 3, 4, 5]);
    useWorkflowStore.getState().loadWorkflow(trimmed, 'trimmed.json');
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([]);
    expect(useWorkflowLineageStore.getState().getBookmarks(lineageId)).toEqual([rootKey(6)]);

    // ...and bookmarking something else there keeps the family's mark on 6.
    useBookmarksStore.getState().toggleBookmark(rootKey(2));
    expect(
      useWorkflowLineageStore.getState().getBookmarks(lineageId).sort(),
    ).toEqual([rootKey(2), rootKey(6)].sort());

    // Removing it again removes exactly that mark, not the sibling's.
    useBookmarksStore.getState().toggleBookmark(rootKey(2));
    expect(useWorkflowLineageStore.getState().getBookmarks(lineageId)).toEqual([rootKey(6)]);

    // Back on the original, the family's own set is what shows.
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([1, 2, 3, 4, 5, 6]), 'original.json');
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([rootKey(6)]);
  });
});
