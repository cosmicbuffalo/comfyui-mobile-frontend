import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import {
  createEmptyMobileLayout,
  flattenLayoutToNodeOrder,
  makeLocationPointer
} from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';
import { useBookmarksStore } from '../useBookmarks';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';
import { queueAndGetEmbeddedWorkflow } from './helpers/queueAndGetEmbeddedWorkflow';

function makeNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    stableKey: rootNodeStableKey(id),
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
    ...overrides
  };
}

function makeWorkflow(nodes: WorkflowNode[], links: WorkflowLink[]): Workflow {
  const rootGroupStableKey = 'sk-group-root-10';
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: Math.max(0, ...links.map((l) => l[0])),
    nodes,
    links,
    groups: [{ id: 10, stableKey: rootGroupStableKey, title: 'Group', color: '#fff', bounding: [100, 100, 500, 300] }],
    config: {},
    version: 1
  };
}

function rootNodePointer(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function rootNodeStableKey(nodeId: number): string {
  return `sk-node-root-${nodeId}`;
}

function rootNodeStableRegistry(nodeIds: number[]) {
  const stableKeyByPointer: Record<string, string> = {};
  const pointerByStableKey: Record<string, string> = {};
  for (const nodeId of nodeIds) {
    const pointer = rootNodePointer(nodeId);
    const stableKey = rootNodeStableKey(nodeId);
    stableKeyByPointer[pointer] = stableKey;
    pointerByStableKey[stableKey] = pointer;
  }
  return { stableKeyByPointer, pointerByStableKey };
}

const nodeTypes: NodeTypes = {
  TestNode: {
    input: {
      required: {
        model: ['MODEL'],
        steps: ['INT', { default: 8 }]
      }
    },
    output: ['MODEL'],
    output_name: ['MODEL'],
    name: 'TestNode',
    display_name: 'Test Node',
    description: '',
    python_module: '',
    category: 'test'
  }
};

const comboNodeTypes: NodeTypes = {
  ComboNode: {
    input: {
      required: {
        ckpt_name: [[
          'models/main/model.safetensors',
          'models/alt/model.safetensors'
        ] as unknown as string]
      }
    },
    output: ['MODEL'],
    output_name: ['MODEL'],
    name: 'ComboNode',
    display_name: 'Combo Node',
    description: '',
    python_module: '',
    category: 'test'
  }
};

const queueNodeTypes: NodeTypes = {
  ...nodeTypes,
  Any: {
    input: { required: {} },
    output: ['MODEL'],
    output_name: ['MODEL'],
    name: 'Any',
    display_name: 'Any',
    description: '',
    python_module: '',
    category: 'test'
  }
};

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null,
    nodeTypes: null,
    hiddenItems: {},
    connectionHighlightModes: {},
    mobileLayout: createEmptyMobileLayout(),
    stableKeyByPointer: {},
    pointerByStableKey: {}
  });
  useBookmarksStore.setState({ bookmarkedItems: [] });
  useWorkflowErrorsStore.setState({
    error: null,
    nodeErrors: {},
    errorCycleIndex: 0,
    errorsDismissed: false
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useWorkflow editing actions', () => {
  it('deleteNode reconnects compatible links and cleans ui state', () => {
    const source = makeNode(1, {
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }]
    });
    const mid = makeNode(2, {
      inputs: [{ name: 'in', type: 'MODEL', link: 1 }],
      outputs: [{ name: 'out', type: 'MODEL', links: [2] }]
    });
    const target = makeNode(3, {
      inputs: [{ name: 'model', type: 'MODEL', link: 2 }]
    });
    const wf = makeWorkflow(
      [source, mid, target],
      [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 2, 0, 3, 0, 'MODEL']
      ]
    );
    useWorkflowStore.setState({
      workflow: wf,
      ...rootNodeStableRegistry([1, 2, 3]),
      hiddenItems: {
        [rootNodeStableKey(2)]: true
      },
      connectionHighlightModes: { 2: 'both' },
      mobileLayout: {
        root: [{ type: 'node', id: 1 }, { type: 'group', id: 10, subgraphId: null, stableKey: makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null }) }, { type: 'node', id: 3 }],
        groups: { [makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null })]: [{ type: 'node', id: 2 }] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteNode(rootNodeStableKey(2), true);
    const next = useWorkflowStore.getState();
    expect(next.workflow?.nodes.map((n) => n.id)).toEqual([1, 3]);
    expect(next.workflow?.links).toHaveLength(1);
    expect(next.workflow?.links[0]?.slice(1, 5)).toEqual([1, 0, 3, 0]);
    expect(next.workflow?.last_link_id).toBe(3);
    expect(next.workflow?.nodes.find((n) => n.id === 3)?.inputs[0]?.link).toBe(3);
    expect(next.workflow?.nodes.find((n) => n.id === 1)?.outputs[0]?.links).toEqual([3]);
    expect(
      next.hiddenItems[
        makeLocationPointer({ type: 'node', nodeId: 2, subgraphId: null })
      ]
    ).toBeUndefined();
    expect(next.connectionHighlightModes[2]).toBeUndefined();
    expect(flattenLayoutToNodeOrder(next.mobileLayout!)).toEqual([1, 3]);
  });

  it('connectNodes replaces existing input link and cleans old source output list', () => {
    const sourceA = makeNode(1, {
      outputs: [{ name: 'out', type: 'MODEL', links: [1] }]
    });
    const sourceB = makeNode(2, {
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const target = makeNode(3, {
      inputs: [{ name: 'model', type: 'MODEL', link: 1 }]
    });
    useWorkflowStore.setState({
      workflow: makeWorkflow(
        [sourceA, sourceB, target],
        [[1, 1, 0, 3, 0, 'MODEL']]
      ),
      ...rootNodeStableRegistry([1, 2, 3])
    });

    useWorkflowStore.getState().connectNodes(rootNodeStableKey(2), 0, rootNodeStableKey(3), 0, 'MODEL');
    const next = useWorkflowStore.getState().workflow;
    expect(next?.links).toHaveLength(1);
    expect(next?.links[0]?.slice(1, 5)).toEqual([2, 0, 3, 0]);
    expect(next?.nodes.find((n) => n.id === 1)?.outputs[0]?.links).toBeNull();
    expect(next?.nodes.find((n) => n.id === 2)?.outputs[0]?.links).toEqual([2]);
    expect(next?.nodes.find((n) => n.id === 3)?.inputs[0]?.link).toBe(2);
  });

  it('addNode supports group placement and mobile ordering state', () => {
    const existing = makeNode(1, { pos: [140, 150] });
    useWorkflowStore.setState({
      workflow: makeWorkflow([existing], []),
      nodeTypes,
      ...rootNodeStableRegistry([1]),
      mobileLayout: {
        root: [{ type: 'node', id: 1 }, { type: 'group', id: 10, subgraphId: null, stableKey: makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null }) }],
        groups: { [makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null })]: [] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    const newId = useWorkflowStore.getState().addNode('TestNode', {
      nearNodeStableKey: rootNodeStableKey(1),
      inGroupId: 10
    });
    const next = useWorkflowStore.getState();
    const newNode = next.workflow?.nodes.find((n) => n.id === newId);
    expect(newId).toBe(2);
    expect(newNode?.inputs.map((i) => i.name)).toEqual(['model']);
    expect(newNode?.outputs.map((o) => o.type)).toEqual(['MODEL']);
    expect(newNode?.widgets_values).toEqual([8]);
    expect(newNode?.pos[0]).toBeGreaterThanOrEqual(124);
    expect(newNode?.pos[1]).toBeGreaterThanOrEqual(148);
    expect(flattenLayoutToNodeOrder(next.mobileLayout!)).toEqual([1, 2]);
    // Node 2 should be in group 10
    expect(next.mobileLayout!.groups[makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null })]).toContainEqual({ type: 'node', id: 2 });
  });

  it('setMobileLayout updates layout', () => {
    const layout: MobileLayout = {
      root: [{ type: 'node', id: 3 }, { type: 'node', id: 1 }, { type: 'node', id: 2 }],
      groups: {},
      subgraphs: {},
      hiddenBlocks: {}
    };
    useWorkflowStore.getState().setMobileLayout(layout);
    expect(flattenLayoutToNodeOrder(useWorkflowStore.getState().mobileLayout!)).toEqual([3, 1, 2]);
  });

  it('preserves node stable key and collapsed state when node moves across subgraph scope', () => {
    const nodeId = 1;
    const stableKey = rootNodeStableKey(nodeId);
    useWorkflowStore.setState({
      ...rootNodeStableRegistry([nodeId]),
      collapsedItems: {
        [stableKey]: true
      },
      mobileLayout: {
        root: [{ type: 'node', id: nodeId }],
        groups: {},
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    const movedLayout: MobileLayout = {
      root: [{ type: 'subgraph', id: 'sg-a' }],
      groups: {},
      subgraphs: {
        'sg-a': [{ type: 'node', id: nodeId }]
      },
      hiddenBlocks: {}
    };

    useWorkflowStore.getState().setMobileLayout(movedLayout);
    const next = useWorkflowStore.getState();
    const movedPointer = makeLocationPointer({
      type: 'node',
      nodeId,
      subgraphId: 'sg-a'
    });

    expect(next.stableKeyByPointer[movedPointer]).toBe(stableKey);
    expect(next.pointerByStableKey[stableKey]).toBe(movedPointer);
    expect(next.collapsedItems[stableKey]).toBe(true);
  });

  it('deleteContainer removes an empty group without deleting nodes', () => {
    const outside = makeNode(1, { pos: [10, 10] });
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupStableKey = 'sk-group-root-10';
    useWorkflowStore.setState({
      workflow: makeWorkflow([outside], []),
      ...rootNodeStableRegistry([1]),
      stableKeyByPointer: {
        ...rootNodeStableRegistry([1]).stableKeyByPointer,
        [groupPointer]: groupStableKey
      },
      pointerByStableKey: {
        ...rootNodeStableRegistry([1]).pointerByStableKey,
        [groupStableKey]: groupPointer
      },
      collapsedItems: {
        [groupStableKey]: true
      },
      hiddenItems: {
        [groupStableKey]: true
      },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, stableKey: groupPointer }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteContainer(groupStableKey, { deleteNodes: false });
    const next = useWorkflowStore.getState();
    expect(next.workflow?.groups).toEqual([]);
    expect(next.workflow?.nodes.map((n) => n.id)).toEqual([1]);
    expect(
      next.collapsedItems[
        groupStableKey
      ]
    ).toBeUndefined();
    expect(
      next.hiddenItems[
        groupStableKey
      ]
    ).toBeUndefined();
    // Group removed from layout, node promoted to root
    expect(next.mobileLayout!.groups[groupPointer]).toBeUndefined();
    expect(next.mobileLayout!.root).toContainEqual({ type: 'node', id: 1 });
  });

  it('deleteContainer can remove group and all nodes in it', () => {
    const inGroup = makeNode(1, {
      pos: [120, 120],
      outputs: [{ name: 'out', type: 'MODEL', links: [1] }]
    });
    const outside = makeNode(2, {
      pos: [900, 120],
      inputs: [{ name: 'model', type: 'MODEL', link: 1 }]
    });
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupStableKey = 'sk-group-root-10';
    const nodeRegistry = rootNodeStableRegistry([1, 2]);
    useWorkflowStore.setState({
      workflow: makeWorkflow(
        [inGroup, outside],
        [[1, 1, 0, 2, 0, 'MODEL']]
      ),
      stableKeyByPointer: {
        ...nodeRegistry.stableKeyByPointer,
        [groupPointer]: groupStableKey
      },
      pointerByStableKey: {
        ...nodeRegistry.pointerByStableKey,
        [groupStableKey]: groupPointer
      },
      hiddenItems: {
        [makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null })]: true,
        [groupStableKey]: true
      },
      connectionHighlightModes: { 1: 'both' },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, stableKey: groupPointer }, { type: 'node', id: 2 }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
        subgraphs: {},
        hiddenBlocks: {}
      },
      collapsedItems: {
        [groupStableKey]: true
      },
    });
    useBookmarksStore.setState({
      bookmarkedItems: [
        rootNodeStableKey(1),
        rootNodeStableKey(2)
      ]
    });

    useWorkflowStore.getState().deleteContainer(groupStableKey, { deleteNodes: true });
    const next = useWorkflowStore.getState();
    expect(next.workflow?.groups).toEqual([]);
    expect(next.workflow?.nodes.map((n) => n.id)).toEqual([2]);
    expect(next.workflow?.links).toEqual([]);
    expect(next.workflow?.nodes[0]?.inputs[0]?.link).toBeNull();
    expect(
      next.hiddenItems[
        makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null })
      ]
    ).toBeUndefined();
    expect(next.connectionHighlightModes[1]).toBeUndefined();
    expect(flattenLayoutToNodeOrder(next.mobileLayout!)).toEqual([2]);
    expect(next.mobileLayout!.groups[groupPointer]).toBeUndefined();
    expect(
      next.collapsedItems[
        groupStableKey
      ]
    ).toBeUndefined();
    expect(
      next.hiddenItems[
        groupStableKey
      ]
    ).toBeUndefined();
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([
      rootNodeStableKey(2)
    ]);
  });

  it('deleteContainer deletes a group and its nodes when given a valid stable key', () => {
    const inGroup = makeNode(1, {
      pos: [120, 120],
      outputs: [{ name: 'out', type: 'MODEL', links: [1] }]
    });
    const outside = makeNode(2, {
      pos: [900, 120],
      inputs: [{ name: 'model', type: 'MODEL', link: 1 }]
    });
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupStableKey = 'sk-group-root-10';
    const nodeRegistry = rootNodeStableRegistry([1, 2]);
    useWorkflowStore.setState({
      workflow: {
        ...makeWorkflow([inGroup, outside], [[1, 1, 0, 2, 0, 'MODEL']]),
        groups: [{ id: 10, title: 'Group', color: '#fff', bounding: [100, 100, 500, 300], stableKey: groupStableKey }]
      },
      stableKeyByPointer: {
        ...nodeRegistry.stableKeyByPointer,
        [groupPointer]: groupStableKey
      },
      pointerByStableKey: {
        ...nodeRegistry.pointerByStableKey,
        [groupStableKey]: groupPointer
      },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, stableKey: groupPointer }, { type: 'node', id: 2 }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
        subgraphs: {},
        hiddenBlocks: {}
      },
    });

    useWorkflowStore.getState().deleteContainer(groupStableKey, { deleteNodes: true });
    const next = useWorkflowStore.getState();
    expect(next.workflow?.groups).toEqual([]);
    expect(next.workflow?.nodes.map((n) => n.id)).toEqual([2]);
    expect(next.workflow?.links).toEqual([]);
  });

  it('clears workflow node errors when loading a workflow without node types', () => {
    useWorkflowErrorsStore.setState({
      error: 'Workflow load error: stale',
      nodeErrors: {
        '1': [{ type: 'workflow_load', message: 'Missing value', details: 'stale' }]
      },
      errorCycleIndex: 1,
      errorsDismissed: true
    });

    useWorkflowStore.getState().loadWorkflow(makeWorkflow([makeNode(1)], []), 'new.json');
    const nextErrors = useWorkflowErrorsStore.getState();
    expect(nextErrors.error).toBeNull();
    expect(nextErrors.nodeErrors).toEqual({});
    expect(nextErrors.errorCycleIndex).toBe(0);
    expect(nextErrors.errorsDismissed).toBe(false);
  });

  it('clears workflow node errors when unloading workflow', () => {
    useWorkflowStore.setState({
      workflow: makeWorkflow([makeNode(1)], []),
      currentWorkflowKey: 'wk-1'
    });
    useWorkflowErrorsStore.setState({
      error: 'Workflow load error: stale',
      nodeErrors: {
        '1': [{ type: 'workflow_load', message: 'Missing value', details: 'stale' }]
      },
      errorCycleIndex: 1,
      errorsDismissed: true
    });

    useWorkflowStore.getState().unloadWorkflow();
    const nextErrors = useWorkflowErrorsStore.getState();
    expect(nextErrors.error).toBeNull();
    expect(nextErrors.nodeErrors).toEqual({});
    expect(nextErrors.errorCycleIndex).toBe(0);
    expect(nextErrors.errorsDismissed).toBe(false);
  });

  it('clears node-specific errors when updating node widget values', () => {
    useWorkflowStore.setState({
      workflow: makeWorkflow([makeNode(1), makeNode(2)], []),
      ...rootNodeStableRegistry([1, 2])
    });
    useWorkflowErrorsStore.setState({
      error: 'Prompt error',
      nodeErrors: {
        '1': [{ type: 'prompt', message: 'Bad value', details: 'bad' }],
        '2': [{ type: 'prompt', message: 'Other issue', details: 'other' }]
      },
      errorCycleIndex: 0,
      errorsDismissed: false
    });

    useWorkflowStore.getState().updateNodeWidget(rootNodeStableKey(1), 0, 123);
    expect(useWorkflowErrorsStore.getState().nodeErrors['1']).toBeUndefined();
    expect(useWorkflowErrorsStore.getState().nodeErrors['2']).toBeDefined();

    useWorkflowErrorsStore.setState({
      error: 'Prompt error',
      nodeErrors: {
        '1': [{ type: 'prompt', message: 'Bad value', details: 'bad' }],
        '2': [{ type: 'prompt', message: 'Other issue', details: 'other' }]
      },
      errorCycleIndex: 0,
      errorsDismissed: false
    });
    useWorkflowStore.getState().updateNodeWidgets(rootNodeStableKey(1), { 0: 456, 1: 789 });
    expect(useWorkflowErrorsStore.getState().nodeErrors['1']).toBeUndefined();
    expect(useWorkflowErrorsStore.getState().nodeErrors['2']).toBeDefined();
  });

  it('restores only cosmetic cached state when loading another workflow with the same cache key', () => {
    const workflowA = makeWorkflow([
      makeNode(1, { type: 'Any', widgets_values: [111] })
    ], []);
    const workflowB = makeWorkflow([
      makeNode(1, { type: 'Any', widgets_values: [222] })
    ], []);

    useWorkflowStore.getState().loadWorkflow(workflowA, 'workflow-a.json');
    const initialState = useWorkflowStore.getState();
    const stableKey = initialState.workflow?.groups?.[0]?.stableKey ?? 'sk-group-root-10';

    useWorkflowStore.setState((state) => ({
      workflow: state.workflow
        ? {
            ...state.workflow,
            nodes: state.workflow.nodes.map((node) =>
              node.id === 1 ? { ...node, widgets_values: [999] } : node
            )
          }
        : state.workflow,
      hiddenItems: { [stableKey]: true },
      collapsedItems: { [stableKey]: true },
    }));
    useWorkflowStore.getState().saveCurrentWorkflowState();

    useWorkflowStore.getState().loadWorkflow(workflowB, 'workflow-b.json');
    const next = useWorkflowStore.getState();
    expect(next.workflow?.nodes.find((node) => node.id === 1)?.widgets_values).toEqual([222]);
  });

  it('canonicalizes legacy pointer-style group keys before building layout on load', () => {
    const groupPointer = makeLocationPointer({
      type: 'group',
      groupId: 10,
      subgraphId: null
    });
    const canonicalGroupStableKey = 'sk-group-root-10-canonical';
    const wf = makeWorkflow([makeNode(1, { pos: [120, 120] })], []);
    wf.groups = [
      {
        ...(wf.groups?.[0] ?? {
          id: 10,
          title: 'Group',
          color: '#fff',
          bounding: [100, 100, 500, 300]
        }),
        stableKey: groupPointer
      }
    ];

    useWorkflowStore.setState({
      ...rootNodeStableRegistry([1]),
      stableKeyByPointer: {
        ...rootNodeStableRegistry([1]).stableKeyByPointer,
        [groupPointer]: canonicalGroupStableKey
      },
      pointerByStableKey: {
        ...rootNodeStableRegistry([1]).pointerByStableKey,
        [canonicalGroupStableKey]: groupPointer
      }
    });

    useWorkflowStore.getState().loadWorkflow(wf, 'legacy-pointer-groups.json');
    const next = useWorkflowStore.getState();
    expect(next.workflow?.groups?.[0]?.stableKey).toBe(canonicalGroupStableKey);
    const rootGroup = next.mobileLayout?.root.find((ref) => ref.type === 'group');
    expect(rootGroup && rootGroup.type === 'group' ? rootGroup.stableKey : null).toBe(
      canonicalGroupStableKey
    );
    expect(next.mobileLayout?.groups[groupPointer]).toBeUndefined();
    expect(next.mobileLayout?.groups[canonicalGroupStableKey]).toBeDefined();
  });

  it('coerces out-of-range combo widget values on load', () => {
    const wf = makeWorkflow([
      makeNode(1, {
        type: 'ComboNode',
        widgets_values: ['other/path/model.safetensors']
      })
    ], []);
    useWorkflowStore.setState({
      nodeTypes: comboNodeTypes
    });

    useWorkflowStore.getState().loadWorkflow(wf, 'combo.json');
    const next = useWorkflowStore.getState();
    expect(next.workflow?.nodes.find((node) => node.id === 1)?.widgets_values).toEqual([
      'models/main/model.safetensors'
    ]);
  });

  it('syncs embed workflow when toggling bypass', () => {
    const wf = makeWorkflow([makeNode(1, { mode: 0 })], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      ...rootNodeStableRegistry([1]),
    });

    useWorkflowStore.getState().toggleBypass(rootNodeStableKey(1));
    const next = useWorkflowStore.getState();
    expect(next.workflow?.nodes.find((n) => n.id === 1)?.mode).toBe(4);
    expect(next.embedWorkflow?.nodes.find((n) => n.id === 1)?.mode).toBe(4);
  });

  it('syncs embed workflow for structural graph edits', () => {
    const source = makeNode(1, {
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const target = makeNode(2, {
      inputs: [{ name: 'model', type: 'MODEL', link: null }]
    });
    const wf = makeWorkflow([source, target], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      ...rootNodeStableRegistry([1, 2]),
    });

    useWorkflowStore.getState().connectNodes(
      rootNodeStableKey(1),
      0,
      rootNodeStableKey(2),
      0,
      'MODEL'
    );
    const next = useWorkflowStore.getState();
    expect(next.workflow?.links).toHaveLength(1);
    expect(next.embedWorkflow?.links).toHaveLength(1);
    expect(next.embedWorkflow?.nodes.find((n) => n.id === 2)?.inputs[0]?.link).toBe(1);
  });

  it('queues updated embed workflow after updateNodeWidget', async () => {
    const wf = makeWorkflow([makeNode(1, { widgets_values: [1] })], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
    });
    useWorkflowStore.getState().updateNodeWidget(rootNodeStableKey(1), 0, 42);
    const embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.find((n) => n.id === 1)?.widgets_values).toEqual([42]);
  });

  it('queues updated embed workflow after updateNodeWidgets', async () => {
    const wf = makeWorkflow([makeNode(1, { widgets_values: [1, 2] })], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
    });
    useWorkflowStore.getState().updateNodeWidgets(rootNodeStableKey(1), { 0: 7, 1: 9 });
    const embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.find((n) => n.id === 1)?.widgets_values).toEqual([7, 9]);
  });

  it('queues updated embed workflow after updateNodeTitle', async () => {
    const wf = makeWorkflow([makeNode(1, { title: 'old' } as Partial<WorkflowNode>)], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
    });
    useWorkflowStore.getState().updateNodeTitle(rootNodeStableKey(1), 'new title');
    const embedded = await queueAndGetEmbeddedWorkflow();
    const node = embedded.nodes.find((n) => n.id === 1) as WorkflowNode & { title?: string };
    expect(node.title).toBe('new title');
  });

  it('queues updated embed workflow after toggleBypass', async () => {
    const wf = makeWorkflow([makeNode(1, { mode: 0 })], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
    });
    useWorkflowStore.getState().toggleBypass(rootNodeStableKey(1));
    const embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.find((n) => n.id === 1)?.mode).toBe(4);
  });

  it('queues updated embed workflow after connect and disconnect edits', async () => {
    const source = makeNode(1, {
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const target = makeNode(2, {
      inputs: [{ name: 'model', type: 'MODEL', link: null }]
    });
    const wf = makeWorkflow([source, target], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1, 2]),
    });
    useWorkflowStore.getState().connectNodes(rootNodeStableKey(1), 0, rootNodeStableKey(2), 0, 'MODEL');
    let embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.links).toHaveLength(1);
    expect(embedded.nodes.find((n) => n.id === 2)?.inputs[0]?.link).toBe(1);

    useWorkflowStore.getState().disconnectInput(rootNodeStableKey(2), 0);
    embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.links).toHaveLength(0);
    expect(embedded.nodes.find((n) => n.id === 2)?.inputs[0]?.link).toBeNull();
  });

  it('queues updated embed workflow after addNode and deleteNode edits', async () => {
    const source = makeNode(1, {
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const wf = makeWorkflow([source], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
      mobileLayout: {
        root: [{ type: 'node', id: 1 }],
        groups: {},
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    const added = useWorkflowStore.getState().addNode('TestNode', {
      nearNodeStableKey: rootNodeStableKey(1),
    });
    expect(added).toBe(2);
    let embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.some((n) => n.id === 2)).toBe(true);

    const addedStableKey = useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === 2)?.stableKey;
    expect(addedStableKey).toBeDefined();
    useWorkflowStore.getState().deleteNode(addedStableKey as string, false);
    embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.some((n) => n.id === 2)).toBe(false);
  });

  it('queues updated embed workflow after bypassAllInContainer', async () => {
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupStableKey = 'sk-group-root-10';
    const wf = makeWorkflow([
      makeNode(1, { pos: [150, 150] }),
      makeNode(2, { pos: [250, 150] })
    ], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1, 2]),
      stableKeyByPointer: {
        ...rootNodeStableRegistry([1, 2]).stableKeyByPointer,
        [groupPointer]: groupStableKey
      },
      pointerByStableKey: {
        ...rootNodeStableRegistry([1, 2]).pointerByStableKey,
        [groupStableKey]: groupPointer
      },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, stableKey: groupPointer }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }, { type: 'node', id: 2 }] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });
    useWorkflowStore.getState().bypassAllInContainer(groupStableKey, true);
    const embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.find((n) => n.id === 1)?.mode).toBe(4);
    expect(embedded.nodes.find((n) => n.id === 2)?.mode).toBe(4);
  });

  it('queues updated embed workflow after container title and deleteContainer edits', async () => {
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupStableKey = 'sk-group-root-10';
    const wf = makeWorkflow([makeNode(1)], []);
    useWorkflowStore.setState({
      workflow: wf,
      embedWorkflow: JSON.parse(JSON.stringify(wf)),
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
      stableKeyByPointer: {
        ...rootNodeStableRegistry([1]).stableKeyByPointer,
        [groupPointer]: groupStableKey
      },
      pointerByStableKey: {
        ...rootNodeStableRegistry([1]).pointerByStableKey,
        [groupStableKey]: groupPointer
      },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, stableKey: groupPointer }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().updateContainerTitle(groupStableKey, 'Renamed Group');
    let embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.groups?.find((g) => g.id === 10)?.title).toBe('Renamed Group');

    useWorkflowStore.getState().deleteContainer(groupStableKey, { deleteNodes: false });
    embedded = await queueAndGetEmbeddedWorkflow();
    expect((embedded.groups ?? []).find((g) => g.id === 10)).toBeUndefined();
  });

  it('keeps canonical subgraph node IDs when syncing embed workflow', async () => {
    const origin = { scope: 'subgraph', subgraphId: 'sg1', nodeId: 7 };
    const current = makeWorkflow([
      makeNode(101, {
        type: 'Any',
        widgets_values: [11],
        properties: { __mobile_origin: origin }
      })
    ], []);
    const embed: Workflow = {
      ...makeWorkflow([], []),
      definitions: {
        subgraphs: [
          {
            id: 'sg1',
            nodes: [
              makeNode(7, { type: 'Any', widgets_values: [0], properties: {} })
            ],
            links: []
          }
        ]
      }
    };
    useWorkflowStore.setState({
      workflow: current,
      embedWorkflow: embed,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([101])
    });

    useWorkflowStore.getState().updateNodeWidget(rootNodeStableKey(101), 0, 33);
    const embedded = await queueAndGetEmbeddedWorkflow();
    const subgraph = embedded.definitions?.subgraphs?.find((sg) => sg.id === 'sg1');
    expect(subgraph?.nodes.some((n) => n.id === 7)).toBe(true);
    expect(subgraph?.nodes.some((n) => n.id === 101)).toBe(false);
    expect(subgraph?.nodes.find((n) => n.id === 7)?.widgets_values).toEqual([33]);
  });
});
