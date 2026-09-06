import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';
import { useBookmarksStore } from '../useBookmarks';
import { useWorkflowLineageStore } from '../useWorkflowLineage';
import { useSeedStore } from '../useSeed';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';
import { createEmptyRegistry } from '@/utils/workflowLineage';

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

/** The workflow as it now sits in the store — i.e. carrying its lineage stamp. */
function currentWorkflow(): Workflow {
  const workflow = useWorkflowStore.getState().workflow;
  if (!workflow) throw new Error('no workflow loaded');
  return structuredClone(workflow);
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

describe('bookmarks follow a workflow lineage', () => {
  it('survives the edit-and-save-as-a-new-name loop that changes the cache key', () => {
    // Open a workflow and bookmark a node.
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([1, 2, 3, 4, 5, 6]), 'original.json');
    useBookmarksStore.getState().toggleBookmark(rootKey(3));
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([rootKey(3)]);
    const originalKey = useWorkflowStore.getState().currentWorkflowKey;

    // Tweak it structurally and open the result under a new name, the way a
    // save-as (and then re-opening one of its outputs) would.
    const variant = currentWorkflow();
    variant.nodes.push(makeNode(7));
    useWorkflowStore.getState().loadWorkflow(variant, 'variant.json');

    // The structural cache key has moved, so the pre-lineage per-workflow
    // state no longer applies — the lineage is what carries the bookmark.
    expect(useWorkflowStore.getState().currentWorkflowKey).not.toBe(originalKey);
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([rootKey(3)]);
  });

  it('propagates a bookmark added on the variant back to the original', () => {
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([1, 2, 3, 4, 5, 6]), 'original.json');
    const original = currentWorkflow();

    const variant = currentWorkflow();
    variant.nodes.push(makeNode(7));
    useWorkflowStore.getState().loadWorkflow(variant, 'variant.json');
    useBookmarksStore.getState().toggleBookmark(rootKey(2));

    useWorkflowStore.getState().loadWorkflow(original, 'original.json');
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([rootKey(2)]);
  });

  it('keeps a mark on a node this variant lacks, and shows it again where it exists', () => {
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([1, 2, 3, 4, 5, 6]), 'original.json');
    useBookmarksStore.getState().toggleBookmark(rootKey(6));
    const original = currentWorkflow();
    const lineageId = useWorkflowStore.getState().currentLineageId!;

    // A descendant that dropped node 6 hides the mark...
    const trimmed = currentWorkflow();
    trimmed.nodes = trimmed.nodes.filter((node) => node.id !== 6);
    useWorkflowStore.getState().loadWorkflow(trimmed, 'trimmed.json');
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([]);
    // ...but the lineage still holds it, because a sibling may still have
    // that node. Dropping it here would delete it for the whole family.
    expect(useWorkflowLineageStore.getState().getBookmarks(lineageId)).toEqual([rootKey(6)]);

    useWorkflowStore.getState().loadWorkflow(original, 'original.json');
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([rootKey(6)]);
  });

  it('seeds a newly founded lineage from bookmarks made before it existed', () => {
    const workflow = makeWorkflow([1, 2, 3, 4, 5, 6]);
    useWorkflowStore.getState().loadWorkflow(workflow, 'original.json');
    const workflowKey = useWorkflowStore.getState().currentWorkflowKey!;
    useBookmarksStore.getState().toggleBookmark(rootKey(4));

    // Simulate upgrading into lineages: the per-workflow bookmarks exist
    // locally, but no lineage has ever been resolved.
    useWorkflowLineageStore.setState({ registry: createEmptyRegistry() });
    useWorkflowStore.setState({ currentLineageId: null });
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([1, 2, 3, 4, 5, 6]), 'original.json');

    const lineageId = useWorkflowStore.getState().currentLineageId!;
    expect(useWorkflowLineageStore.getState().getBookmarks(lineageId)).toEqual([rootKey(4)]);
    expect(useWorkflowStore.getState().savedWorkflowStates[workflowKey]?.bookmarkedItems).toEqual([
      rootKey(4),
    ]);
  });

  it('does not resurrect bookmarks another device cleared from an existing lineage', () => {
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([1, 2, 3, 4, 5, 6]), 'original.json');
    useBookmarksStore.getState().toggleBookmark(rootKey(4));
    const lineageId = useWorkflowStore.getState().currentLineageId!;
    const workflow = currentWorkflow();

    // The registry arrives from the server with the family's bookmarks
    // cleared, while this device's local mirror still holds the old set.
    useWorkflowLineageStore.getState().setBookmarks(lineageId, []);
    useWorkflowStore.getState().loadWorkflow(workflow, 'original.json');

    expect(useWorkflowLineageStore.getState().getBookmarks(lineageId)).toEqual([]);
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([]);
  });
});
