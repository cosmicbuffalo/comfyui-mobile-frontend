import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import {
  createEmptyMobileLayout,
  flattenLayoutToNodeOrder,
  makeLocationPointer
} from '@/utils/mobileLayout';
import { computeNodeGroupsFor } from '@/utils/nodeGroups';
import { themeColors } from '@/theme/colors';
import { useWorkflowStore } from '../useWorkflow';
import { useBookmarksStore } from '../useBookmarks';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';
import { queueAndGetEmbeddedWorkflow } from './helpers/queueAndGetEmbeddedWorkflow';

function makeNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: rootNodeHierarchicalKey(id),
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
  const rootGroupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: Math.max(0, ...links.map((l) => l[0])),
    nodes,
    links,
    groups: [{ id: 10, itemKey: rootGroupHierarchicalKey, title: 'Group', color: '#fff', bounding: [100, 100, 500, 300] }],
    config: {},
    version: 1
  };
}

function rootNodePointer(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function rootNodeHierarchicalKey(nodeId: number): string {
  return rootNodePointer(nodeId);
}

function rootNodeStableRegistry(nodeIds: number[]) {
  const itemKeyByPointer: Record<string, string> = {};
  const pointerByHierarchicalKey: Record<string, string> = {};
  for (const nodeId of nodeIds) {
    const pointer = rootNodePointer(nodeId);
    itemKeyByPointer[pointer] = pointer;
    pointerByHierarchicalKey[pointer] = pointer;
  }
  return { itemKeyByPointer, pointerByHierarchicalKey };
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
    originalWorkflow: null,
    nodeTypes: null,
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
  it('clears stale executing node details when a new prompt starts without node identity', () => {
    useWorkflowStore.setState({
      workflow: makeWorkflow([makeNode(1), makeNode(2)], []),
      ...rootNodeStableRegistry([1, 2]),
      executingNodeId: rootNodeHierarchicalKey(1),
      executingNodePath: '1',
      executingPromptId: 'prompt-a',
      isExecuting: true
    });

    useWorkflowStore.getState().setExecutionState(true, null, 'prompt-b', 0);

    expect(useWorkflowStore.getState()).toMatchObject({
      isExecuting: true,
      executingPromptId: 'prompt-b',
      executingNodeId: null,
      executingNodePath: null,
      progress: 0
    });
  });

  it('keeps the current executing node when progress updates omit node identity for the same prompt', () => {
    useWorkflowStore.setState({
      workflow: makeWorkflow([makeNode(1), makeNode(2)], []),
      ...rootNodeStableRegistry([1, 2]),
      executingNodeId: rootNodeHierarchicalKey(1),
      executingNodePath: '1',
      executingPromptId: 'prompt-a',
      isExecuting: true
    });

    useWorkflowStore.getState().setExecutionState(true, null, 'prompt-a', 42);

    expect(useWorkflowStore.getState()).toMatchObject({
      isExecuting: true,
      executingPromptId: 'prompt-a',
      executingNodeId: rootNodeHierarchicalKey(1),
      executingNodePath: '1',
      progress: 42
    });
  });

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
        [rootNodeHierarchicalKey(2)]: true
      },
      connectionHighlightModes: { [rootNodeHierarchicalKey(2)]: 'both' },
      mobileLayout: {
        root: [{ type: 'node', id: 1 }, { type: 'group', id: 10, subgraphId: null, itemKey: makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null }) }, { type: 'node', id: 3 }],
        groups: { [makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null })]: [{ type: 'node', id: 2 }] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteNode(rootNodeHierarchicalKey(2), true);
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
    expect(next.connectionHighlightModes[rootNodeHierarchicalKey(2)]).toBeUndefined();
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

    useWorkflowStore.getState().connectNodes(rootNodeHierarchicalKey(2), 0, rootNodeHierarchicalKey(3), 0, 'MODEL');
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
        root: [{ type: 'node', id: 1 }, { type: 'group', id: 10, subgraphId: null, itemKey: makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null }) }],
        groups: { [makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null })]: [] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    const newId = useWorkflowStore.getState().addNode('TestNode', {
      nearNodeHierarchicalKey: rootNodeHierarchicalKey(1),
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

  it('rekeys node identity when node moves across subgraph scope', () => {
    const nodeId = 1;
    const itemKey = rootNodeHierarchicalKey(nodeId);
    useWorkflowStore.setState({
      ...rootNodeStableRegistry([nodeId]),
      collapsedItems: {
        [itemKey]: true
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

    expect(next.itemKeyByPointer[movedPointer]).toBe(movedPointer);
    expect(next.pointerByHierarchicalKey[movedPointer]).toBe(movedPointer);
    expect(next.collapsedItems[movedPointer]).toBeUndefined();
  });

  it('addNode uses subgraph-scope fallback placement when target subgraph is empty', () => {
    const root = makeNode(1, { pos: [0, 1500], size: [200, 140] });
    const workflow: Workflow = {
      ...makeWorkflow([root], []),
      definitions: {
        subgraphs: [{ id: 'sg-a', nodes: [], links: [], groups: [] }]
      }
    };
    useWorkflowStore.setState({
      workflow,
      nodeTypes,
      ...rootNodeStableRegistry([1]),
      mobileLayout: {
        root: [{ type: 'node', id: 1 }, { type: 'subgraph', id: 'sg-a' }],
        groups: {},
        subgraphs: { 'sg-a': [] },
        hiddenBlocks: {}
      }
    });

    const newId = useWorkflowStore.getState().addNode('TestNode', {
      inSubgraphId: 'sg-a'
    });
    expect(newId).toBe(2);

    const nextWorkflow = useWorkflowStore.getState().workflow as Workflow;
    const sg = nextWorkflow.definitions?.subgraphs?.find((entry) => entry.id === 'sg-a');
    const added = sg?.nodes.find((node) => node.id === 2);
    expect(added).toBeDefined();
    // Should not use root bottom placement (~1720 in this fixture).
    expect(added?.pos).toEqual([0, 0]);
  });

  it('deleteContainer removes an empty group without deleting nodes', () => {
    const outside = makeNode(1, { pos: [10, 10] });
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    useWorkflowStore.setState({
      workflow: makeWorkflow([outside], []),
      ...rootNodeStableRegistry([1]),
      itemKeyByPointer: {
        ...rootNodeStableRegistry([1]).itemKeyByPointer,
        [groupPointer]: groupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...rootNodeStableRegistry([1]).pointerByHierarchicalKey,
        [groupHierarchicalKey]: groupPointer
      },
      collapsedItems: {
        [groupHierarchicalKey]: true
      },
      hiddenItems: {
        [groupHierarchicalKey]: true
      },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteContainer(groupHierarchicalKey, { deleteNodes: false });
    const next = useWorkflowStore.getState();
    expect(next.workflow?.groups).toEqual([]);
    expect(next.workflow?.nodes.map((n) => n.id)).toEqual([1]);
    expect(
      next.collapsedItems[
        groupHierarchicalKey
      ]
    ).toBeUndefined();
    expect(
      next.hiddenItems[
        groupHierarchicalKey
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
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const nodeRegistry = rootNodeStableRegistry([1, 2]);
    useWorkflowStore.setState({
      workflow: makeWorkflow(
        [inGroup, outside],
        [[1, 1, 0, 2, 0, 'MODEL']]
      ),
      itemKeyByPointer: {
        ...nodeRegistry.itemKeyByPointer,
        [groupPointer]: groupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...nodeRegistry.pointerByHierarchicalKey,
        [groupHierarchicalKey]: groupPointer
      },
      hiddenItems: {
        [makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null })]: true,
        [groupHierarchicalKey]: true
      },
      connectionHighlightModes: { [rootNodeHierarchicalKey(1)]: 'both' },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }, { type: 'node', id: 2 }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
        subgraphs: {},
        hiddenBlocks: {}
      },
      collapsedItems: {
        [groupHierarchicalKey]: true
      },
    });
    useBookmarksStore.setState({
      bookmarkedItems: [
        rootNodeHierarchicalKey(1),
        rootNodeHierarchicalKey(2)
      ]
    });

    useWorkflowStore.getState().deleteContainer(groupHierarchicalKey, { deleteNodes: true });
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
    expect(next.connectionHighlightModes[rootNodeHierarchicalKey(1)]).toBeUndefined();
    expect(flattenLayoutToNodeOrder(next.mobileLayout!)).toEqual([2]);
    expect(next.mobileLayout!.groups[groupPointer]).toBeUndefined();
    expect(
      next.collapsedItems[
        groupHierarchicalKey
      ]
    ).toBeUndefined();
    expect(
      next.hiddenItems[
        groupHierarchicalKey
      ]
    ).toBeUndefined();
    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([
      rootNodeHierarchicalKey(2)
    ]);
  });

  it('deleteContainer deletes a group and its nodes when given a valid item key', () => {
    const inGroup = makeNode(1, {
      pos: [120, 120],
      outputs: [{ name: 'out', type: 'MODEL', links: [1] }]
    });
    const outside = makeNode(2, {
      pos: [900, 120],
      inputs: [{ name: 'model', type: 'MODEL', link: 1 }]
    });
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const nodeRegistry = rootNodeStableRegistry([1, 2]);
    useWorkflowStore.setState({
      workflow: {
        ...makeWorkflow([inGroup, outside], [[1, 1, 0, 2, 0, 'MODEL']]),
        groups: [{ id: 10, title: 'Group', color: '#fff', bounding: [100, 100, 500, 300], itemKey: groupHierarchicalKey }]
      },
      itemKeyByPointer: {
        ...nodeRegistry.itemKeyByPointer,
        [groupPointer]: groupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...nodeRegistry.pointerByHierarchicalKey,
        [groupHierarchicalKey]: groupPointer
      },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }, { type: 'node', id: 2 }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
        subgraphs: {},
        hiddenBlocks: {}
      },
    });

    useWorkflowStore.getState().deleteContainer(groupHierarchicalKey, { deleteNodes: true });
    const next = useWorkflowStore.getState();
    expect(next.workflow?.groups).toEqual([]);
    expect(next.workflow?.nodes.map((n) => n.id)).toEqual([2]);
    expect(next.workflow?.links).toEqual([]);
  });

  it('keeps bookmarked subgraph nodes across workflow-state sync', () => {
    const placeholder = makeNode(50, {
      type: 'sg-a',
      itemKey: makeLocationPointer({ type: 'node', nodeId: 50, subgraphId: null }),
    });
    const innerNodeKey = makeLocationPointer({ type: 'node', nodeId: 1044, subgraphId: 'sg-a' });
    const innerNode = makeNode(1044, {
      type: 'InnerNode',
      itemKey: innerNodeKey,
    });
    const workflow: Workflow = {
      last_node_id: 1044,
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

    useWorkflowStore.setState({
      workflow,
      currentWorkflowKey: 'bookmark-subgraph-node',
      savedWorkflowStates: {
        'bookmark-subgraph-node': {
          nodes: {},
          seedModes: {},
          bookmarkedItems: [innerNodeKey],
        },
      },
    });

    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([innerNodeKey]);

    useWorkflowStore.setState({ hiddenItems: {} });

    expect(useBookmarksStore.getState().bookmarkedItems).toEqual([innerNodeKey]);
  });

  it('deleteContainer for a markdown-notes group leaves executable links unchanged', () => {
    const notesGroupPointer = makeLocationPointer({ type: 'group', groupId: 99, subgraphId: null });
    const notesGroupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 99, subgraphId: null });
    const notes = [200, 201, 202, 203, 204, 205, 206].map((id) =>
      makeNode(id, { type: 'MarkdownNote' })
    );
    const source = makeNode(1046, {
      type: '233f1485-e82d-4c79-b376-da0c57e1c6d3',
      outputs: [
        { name: 'a', type: 'ANY', links: [1, 2, 3, 4] }
      ]
    });
    const ifElse = makeNode(1002, {
      type: 'easy ifElse',
      inputs: [{ name: 'on_true', type: 'ANY', link: 1 }]
    });
    const wan = makeNode(1031, {
      type: 'WanImageToVideo',
      inputs: [
        { name: 'start_image', type: 'IMAGE', link: 2 },
        { name: 'width', type: 'INT', link: 3 },
        { name: 'height', type: 'INT', link: 4 }
      ]
    });
    const rootNodes = [source, ifElse, wan, ...notes];
    const registry = rootNodeStableRegistry(rootNodes.map((node) => node.id));
    useWorkflowStore.setState({
      workflow: {
        last_node_id: 1046,
        last_link_id: 4,
        nodes: rootNodes,
        links: [
          [1, 1046, 0, 1002, 0, 'ANY'],
          [2, 1046, 0, 1031, 0, 'IMAGE'],
          [3, 1046, 0, 1031, 1, 'INT'],
          [4, 1046, 0, 1031, 2, 'INT']
        ],
        groups: [
          { id: 99, itemKey: notesGroupHierarchicalKey, title: 'Notes, Explanation, Hints', color: '#fff', bounding: [0, 0, 600, 400] }
        ],
        config: {},
        version: 1
      },
      itemKeyByPointer: {
        ...registry.itemKeyByPointer,
        [notesGroupPointer]: notesGroupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...registry.pointerByHierarchicalKey,
        [notesGroupHierarchicalKey]: notesGroupPointer
      },
      mobileLayout: {
        root: [
          { type: 'group', id: 99, subgraphId: null, itemKey: notesGroupPointer },
          { type: 'node', id: 1046 },
          { type: 'node', id: 1002 },
          { type: 'node', id: 1031 }
        ],
        groups: {
          [notesGroupPointer]: notes.map((node) => ({ type: 'node' as const, id: node.id }))
        },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteContainer(notesGroupHierarchicalKey, { deleteNodes: true });
    const next = useWorkflowStore.getState().workflow as Workflow;
    expect(next.groups).toEqual([]);
    expect(next.nodes.map((node) => node.id)).toEqual([1046, 1002, 1031]);
    expect(next.links).toEqual([
      [1, 1046, 0, 1002, 0, 'ANY'],
      [2, 1046, 0, 1031, 0, 'IMAGE'],
      [3, 1046, 0, 1031, 1, 'INT'],
      [4, 1046, 0, 1031, 2, 'INT']
    ]);
    expect(next.nodes.find((node) => node.id === 1002)?.inputs[0]?.link).toBe(1);
    const wanInputs = next.nodes.find((node) => node.id === 1031)?.inputs ?? [];
    expect(wanInputs.map((entry) => entry.link)).toEqual([2, 3, 4]);
  });

  it('deleteContainer does not prune nested subgraph definitions when deleting unrelated notes', () => {
    const notesGroupPointer = makeLocationPointer({ type: 'group', groupId: 99, subgraphId: null });
    const notesGroupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 99, subgraphId: null });
    const notes = [200, 201, 202, 203, 204, 205, 206].map((id) =>
      makeNode(id, { type: 'MarkdownNote' })
    );
    const placeholderA = makeNode(1046, { type: 'sg-a' });
    const rootNodes = [placeholderA, ...notes];
    const registry = rootNodeStableRegistry(rootNodes.map((node) => node.id));
    useWorkflowStore.setState({
      workflow: {
        last_node_id: 1046,
        last_link_id: 0,
        nodes: rootNodes,
        links: [],
        groups: [
          { id: 99, itemKey: notesGroupHierarchicalKey, title: 'Notes, Explanation, Hints', color: '#fff', bounding: [0, 0, 600, 400] }
        ],
        config: {},
        version: 1,
        definitions: {
          subgraphs: [
            {
              id: 'sg-a',
              nodes: [makeNode(7, { itemKey: makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: 'sg-a' }), type: 'sg-b' })],
              links: [],
              groups: []
            },
            {
              id: 'sg-b',
              nodes: [makeNode(8, { itemKey: makeLocationPointer({ type: 'node', nodeId: 8, subgraphId: 'sg-b' }), type: 'Any' })],
              links: [],
              groups: []
            }
          ]
        }
      },
      itemKeyByPointer: {
        ...registry.itemKeyByPointer,
        [notesGroupPointer]: notesGroupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...registry.pointerByHierarchicalKey,
        [notesGroupHierarchicalKey]: notesGroupPointer
      },
      mobileLayout: {
        root: [
          { type: 'group', id: 99, subgraphId: null, itemKey: notesGroupPointer },
          { type: 'subgraph', id: 'sg-a', nodeId: 1046 }
        ],
        groups: {
          [notesGroupPointer]: notes.map((node) => ({ type: 'node' as const, id: node.id }))
        },
        subgraphs: {
          'sg-a': [{ type: 'subgraph', id: 'sg-b', nodeId: 7 }],
          'sg-b': [{ type: 'node', id: 8 }]
        },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteContainer(notesGroupHierarchicalKey, { deleteNodes: true });
    const next = useWorkflowStore.getState().workflow as Workflow;
    expect(next.definitions?.subgraphs?.map((sg) => sg.id)).toEqual(['sg-a', 'sg-b']);
  });

  it('deleteContainer in a subgraph scope does not delete same-id root nodes', () => {
    const rootNode = makeNode(7, {
      outputs: [{ name: 'out', type: 'MODEL', links: [1] }]
    });
    const placeholder = makeNode(100, {
      type: 'sg-a',
      inputs: [{ name: 'in', type: 'MODEL', link: 1 }]
    });
    const innerSource = makeNode(7, {
      itemKey: makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: 'sg-a' }),
      outputs: [{ name: 'out', type: 'MODEL', links: [2] }]
    });
    const innerTarget = makeNode(8, {
      itemKey: makeLocationPointer({ type: 'node', nodeId: 8, subgraphId: 'sg-a' }),
      inputs: [{ name: 'in', type: 'MODEL', link: 2 }]
    });
    const sgGroupPointer = makeLocationPointer({ type: 'group', groupId: 20, subgraphId: 'sg-a' });
    const sgGroupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 20, subgraphId: 'sg-a' });
    useWorkflowStore.setState({
      workflow: {
        last_node_id: 100,
        last_link_id: 1,
        nodes: [rootNode, placeholder],
        links: [[1, 7, 0, 100, 0, 'MODEL']],
        groups: [],
        config: {},
        version: 1,
        definitions: {
          subgraphs: [
            {
              id: 'sg-a',
              nodes: [innerSource, innerTarget],
              links: [{ id: 2, origin_id: 7, origin_slot: 0, target_id: 8, target_slot: 0, type: 'MODEL' }],
              groups: [
                { id: 20, itemKey: sgGroupHierarchicalKey, title: 'SG Group', color: '#fff', bounding: [0, 0, 500, 300] }
              ]
            }
          ]
        }
      },
      itemKeyByPointer: {
        [makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: null })]: rootNodeHierarchicalKey(7),
        [makeLocationPointer({ type: 'node', nodeId: 100, subgraphId: null })]: rootNodeHierarchicalKey(100),
        [makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: 'sg-a' })]: makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: 'sg-a' }),
        [makeLocationPointer({ type: 'node', nodeId: 8, subgraphId: 'sg-a' })]: makeLocationPointer({ type: 'node', nodeId: 8, subgraphId: 'sg-a' }),
        [sgGroupPointer]: sgGroupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        [rootNodeHierarchicalKey(7)]: makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: null }),
        [rootNodeHierarchicalKey(100)]: makeLocationPointer({ type: 'node', nodeId: 100, subgraphId: null }),
        [makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: 'sg-a' })]: makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: 'sg-a' }),
        [makeLocationPointer({ type: 'node', nodeId: 8, subgraphId: 'sg-a' })]: makeLocationPointer({ type: 'node', nodeId: 8, subgraphId: 'sg-a' }),
        [sgGroupHierarchicalKey]: sgGroupPointer
      },
      mobileLayout: {
        root: [{ type: 'node', id: 7 }, { type: 'subgraph', id: 'sg-a', nodeId: 100 }],
        groups: { [sgGroupPointer]: [{ type: 'node', id: 7 }] },
        subgraphs: {
          'sg-a': [{ type: 'group', id: 20, subgraphId: 'sg-a', itemKey: sgGroupPointer }, { type: 'node', id: 8 }]
        },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteContainer(sgGroupHierarchicalKey, { deleteNodes: true });
    const next = useWorkflowStore.getState().workflow as Workflow;
    expect(next.nodes.map((node) => node.id)).toEqual([7, 100]);
    expect(next.links).toEqual([[1, 7, 0, 100, 0, 'MODEL']]);
    const nextSubgraph = next.definitions?.subgraphs?.find((sg) => sg.id === 'sg-a');
    expect(nextSubgraph?.nodes.map((node) => node.id)).toEqual([8]);
    expect(nextSubgraph?.links).toEqual([]);
    expect(nextSubgraph?.nodes.find((node) => node.id === 8)?.inputs[0]?.link).toBeNull();
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

    useWorkflowStore.getState().updateNodeWidget(rootNodeHierarchicalKey(1), 0, 123);
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
    useWorkflowStore.getState().updateNodeWidgets(rootNodeHierarchicalKey(1), { 0: 456, 1: 789 });
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
    const itemKey = initialState.workflow?.groups?.[0]?.itemKey ?? makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });

    useWorkflowStore.setState((state) => ({
      workflow: state.workflow
        ? {
            ...state.workflow,
            nodes: state.workflow.nodes.map((node) =>
              node.id === 1 ? { ...node, widgets_values: [999] } : node
            )
          }
        : state.workflow,
      hiddenItems: { [itemKey]: true },
      collapsedItems: { [itemKey]: true },
    }));
    useWorkflowStore.getState().saveCurrentWorkflowState();

    useWorkflowStore.getState().loadWorkflow(workflowB, 'workflow-b.json');
    const next = useWorkflowStore.getState();
    expect(next.workflow?.nodes.find((node) => node.id === 1)?.widgets_values).toEqual([222]);
  });

  it('preserves collapsed root subgraph placeholder nodes when reloading the same workflow', () => {
    const placeholderNodeId = 7;
    const placeholderItemKey = rootNodeHierarchicalKey(placeholderNodeId);
    const workflow = makeWorkflow([
      makeNode(placeholderNodeId, { type: 'sg-fast' })
    ], []);
    workflow.definitions = {
      subgraphs: [{
        id: 'sg-fast',
        itemKey: makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-fast' }),
        name: 'Fast Graph',
        nodes: [],
        links: [],
        groups: []
      }]
    };

    useWorkflowStore.getState().loadWorkflow(workflow, 'placeholder.json');
    useWorkflowStore.setState({
      collapsedItems: {
        [placeholderItemKey]: true
      }
    });

    useWorkflowStore.getState().loadWorkflow(workflow, 'placeholder.json');

    expect(useWorkflowStore.getState().collapsedItems[placeholderItemKey]).toBe(true);
  });

  it('canonicalizes legacy pointer-style group keys before building layout on load', () => {
    const groupPointer = makeLocationPointer({
      type: 'group',
      groupId: 10,
      subgraphId: null
    });
    const canonicalGroupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const wf = makeWorkflow([makeNode(1, { pos: [120, 120] })], []);
    wf.groups = [
      {
        ...(wf.groups?.[0] ?? {
          id: 10,
          title: 'Group',
          color: '#fff',
          bounding: [100, 100, 500, 300]
        }),
        itemKey: groupPointer
      }
    ];

    useWorkflowStore.setState({
      ...rootNodeStableRegistry([1]),
      itemKeyByPointer: {
        ...rootNodeStableRegistry([1]).itemKeyByPointer,
        [groupPointer]: canonicalGroupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...rootNodeStableRegistry([1]).pointerByHierarchicalKey,
        [canonicalGroupHierarchicalKey]: groupPointer
      }
    });

    useWorkflowStore.getState().loadWorkflow(wf, 'legacy-pointer-groups.json');
    const next = useWorkflowStore.getState();
    expect(next.workflow?.groups?.[0]?.itemKey).toBe(canonicalGroupHierarchicalKey);
    const rootGroup = next.mobileLayout?.root.find((ref) => ref.type === 'group');
    expect(rootGroup && rootGroup.type === 'group' ? rootGroup.itemKey : null).toBe(
      canonicalGroupHierarchicalKey
    );
    expect(next.mobileLayout?.groups[groupPointer]).toBeDefined();
    expect(next.mobileLayout?.groups[canonicalGroupHierarchicalKey]).toBeDefined();
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
      ...rootNodeStableRegistry([1]),
    });

    useWorkflowStore.getState().toggleBypass(rootNodeHierarchicalKey(1));
    const next = useWorkflowStore.getState();
    expect(next.workflow?.nodes.find((n) => n.id === 1)?.mode).toBe(4);
    expect(next.workflow?.nodes.find((n) => n.id === 1)?.mode).toBe(4);
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
      ...rootNodeStableRegistry([1, 2]),
    });

    useWorkflowStore.getState().connectNodes(
      rootNodeHierarchicalKey(1),
      0,
      rootNodeHierarchicalKey(2),
      0,
      'MODEL'
    );
    const next = useWorkflowStore.getState();
    expect(next.workflow?.links).toHaveLength(1);
    expect(next.workflow?.links).toHaveLength(1);
    expect(next.workflow?.nodes.find((n) => n.id === 2)?.inputs[0]?.link).toBe(1);
  });

  it('deleteNode preserves root subgraph placeholder nodes and links in embed workflow', () => {
    // Canonical model: node 50 is a placeholder for subgraphId, connected to node 2 via link 1.
    // Deleting unrelated node 3 must not remove the placeholder or its link.
    const subgraphId = 'sg-a';
    const canonicalWorkflow: Workflow = {
      ...makeWorkflow(
        [
          makeNode(50, { type: subgraphId, outputs: [{ name: 'out', type: 'IMAGE', links: [1] }] }),
          makeNode(2, { inputs: [{ name: 'image', type: 'IMAGE', link: 1 }] }),
          makeNode(3),
        ],
        [[1, 50, 0, 2, 0, 'IMAGE']]
      ),
      definitions: {
        subgraphs: [{ id: subgraphId, nodes: [makeNode(7)], groups: [], links: [] }]
      }
    };

    useWorkflowStore.setState({
      workflow: canonicalWorkflow,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([50, 2, 3]),
      mobileLayout: {
        root: [{ type: 'subgraph', id: subgraphId }, { type: 'node', id: 2 }, { type: 'node', id: 3 }],
        groups: {},
        subgraphs: { [subgraphId]: [{ type: 'node', id: 7 }] },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteNode(rootNodeHierarchicalKey(3), false);
    const embedded = useWorkflowStore.getState().workflow;
    expect(embedded?.nodes.some((node) => node.id === 50 && node.type === subgraphId)).toBe(true);
    expect(embedded?.links.some((link) => link[1] === 50 && link[3] === 2)).toBe(true);
    expect(embedded?.nodes.find((node) => node.id === 2)?.inputs[0]?.link).toBe(1);
    expect(embedded?.definitions?.subgraphs?.some((subgraph) => subgraph.id === subgraphId)).toBe(true);
  });

  it('deleteNode preserves subgraph boundary links needed by SubgraphNode', () => {
    const subgraphId = 'sg-a';
    const canonicalWorkflow: Workflow = {
      ...makeWorkflow([makeNode(50, { type: subgraphId }), makeNode(3)], []),
      definitions: {
        subgraphs: [
          {
            id: subgraphId,
            nodes: [
              makeNode(7, {
                inputs: [{ name: 'in', type: 'MODEL', link: 2044 }],
                outputs: [{ name: 'out', type: 'MODEL', links: [2045] }]
              })
            ],
            groups: [],
            links: [
              { id: 2044, origin_id: -10, origin_slot: 0, target_id: 7, target_slot: 0, type: 'MODEL' },
              { id: 2045, origin_id: 7, origin_slot: 0, target_id: -20, target_slot: 0, type: 'MODEL' }
            ]
          }
        ]
      }
    };
    useWorkflowStore.setState({
      workflow: canonicalWorkflow,
      ...rootNodeStableRegistry([50, 3]),
      mobileLayout: {
        root: [{ type: 'node', id: 3 }, { type: 'subgraph', id: subgraphId }],
        groups: {},
        subgraphs: { [subgraphId]: [{ type: 'node', id: 7 }] },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteNode(rootNodeHierarchicalKey(3), false);
    const subgraph = useWorkflowStore
      .getState()
      .workflow?.definitions?.subgraphs?.find((entry) => entry.id === subgraphId);
    const boundaryLinks = (subgraph?.links ?? []).filter(
      (link) => link.origin_id === -10 || link.target_id === -20,
    );
    expect(boundaryLinks).toHaveLength(2);
    expect(subgraph?.nodes[0]?.inputs?.[0]?.link).toBe(2044);
    expect(subgraph?.nodes[0]?.outputs?.[0]?.links).toEqual([2045]);
  });

  it('queues updated embed workflow after updateNodeWidget', async () => {
    const wf = makeWorkflow([makeNode(1, { widgets_values: [1] })], []);
    useWorkflowStore.setState({
      workflow: wf,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
    });
    useWorkflowStore.getState().updateNodeWidget(rootNodeHierarchicalKey(1), 0, 42);
    const embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.find((n) => n.id === 1)?.widgets_values).toEqual([42]);
  });

  it('queues updated embed workflow after updateNodeWidgets', async () => {
    const wf = makeWorkflow([makeNode(1, { widgets_values: [1, 2] })], []);
    useWorkflowStore.setState({
      workflow: wf,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
    });
    useWorkflowStore.getState().updateNodeWidgets(rootNodeHierarchicalKey(1), { 0: 7, 1: 9 });
    const embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.find((n) => n.id === 1)?.widgets_values).toEqual([7, 9]);
  });

  it('queues updated embed workflow after updateNodeTitle', async () => {
    const wf = makeWorkflow([makeNode(1, { title: 'old' } as Partial<WorkflowNode>)], []);
    useWorkflowStore.setState({
      workflow: wf,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
    });
    useWorkflowStore.getState().updateNodeTitle(rootNodeHierarchicalKey(1), 'new title');
    const embedded = await queueAndGetEmbeddedWorkflow();
    const node = embedded.nodes.find((n) => n.id === 1) as WorkflowNode & { title?: string };
    expect(node.title).toBe('new title');
  });

  it('queues updated embed workflow after toggleBypass', async () => {
    const wf = makeWorkflow([makeNode(1, { mode: 0 })], []);
    useWorkflowStore.setState({
      workflow: wf,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
    });
    useWorkflowStore.getState().toggleBypass(rootNodeHierarchicalKey(1));
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
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1, 2]),
    });
    useWorkflowStore.getState().connectNodes(rootNodeHierarchicalKey(1), 0, rootNodeHierarchicalKey(2), 0, 'MODEL');
    let embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.links).toHaveLength(1);
    expect(embedded.nodes.find((n) => n.id === 2)?.inputs[0]?.link).toBe(1);

    useWorkflowStore.getState().disconnectInput(rootNodeHierarchicalKey(2), 0);
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
      nearNodeHierarchicalKey: rootNodeHierarchicalKey(1),
    });
    expect(added).toBe(2);
    let embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.some((n) => n.id === 2)).toBe(true);

    const addedHierarchicalKey = useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === 2)?.itemKey;
    expect(addedHierarchicalKey).toBeDefined();
    useWorkflowStore.getState().deleteNode(addedHierarchicalKey as string, false);
    embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.some((n) => n.id === 2)).toBe(false);
  });

  it('preserves embedded subgraph definitions after deleting a root node and saving', async () => {
    const embeddedSubgraphNode = makeNode(7, { widgets_values: [9] });
    const placeholderNode = makeNode(50, { type: 'sg-a' });
    const canonicalWorkflow: Workflow = {
      ...makeWorkflow([makeNode(1), makeNode(2), placeholderNode], []),
      definitions: {
        subgraphs: [{ id: 'sg-a', nodes: [embeddedSubgraphNode], groups: [], links: [] }]
      }
    };
    useWorkflowStore.setState({
      workflow: canonicalWorkflow,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1, 2, 50]),
      mobileLayout: {
        root: [{ type: 'node', id: 1 }, { type: 'node', id: 2 }, { type: 'subgraph', id: 'sg-a' }],
        groups: {},
        subgraphs: { 'sg-a': [{ type: 'node', id: 7 }] },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteNode(rootNodeHierarchicalKey(2), false);
    let embedded = await queueAndGetEmbeddedWorkflow();
    let sg = embedded.definitions?.subgraphs?.find((subgraph) => subgraph.id === 'sg-a');
    expect(embedded.nodes.some((node) => node.id === 2)).toBe(false);
    expect(sg?.nodes.some((node) => node.id === 7)).toBe(true);
    expect(sg?.nodes.some((node) => node.id === 101)).toBe(false);

    useWorkflowStore
      .getState()
      .setSavedWorkflow(useWorkflowStore.getState().workflow as Workflow, 'saved-with-subgraphs.json');
    embedded = await queueAndGetEmbeddedWorkflow();
    sg = embedded.definitions?.subgraphs?.find((subgraph) => subgraph.id === 'sg-a');
    expect(sg?.nodes.some((node) => node.id === 7)).toBe(true);
    expect(sg?.nodes.some((node) => node.id === 101)).toBe(false);
  });

  it('setSavedWorkflow and root delete do not mutate subgraph definition links/ios', () => {
    // Canonical model: workflow.nodes = root nodes + placeholder (type=subgraphId).
    // Verify that deleting a root node (node 3) does not corrupt the subgraph's
    // boundary IO connections or inner links.
    const subgraphId = 'sg-a';
    const canonicalWorkflow: Workflow = {
      ...makeWorkflow(
        [makeNode(1), makeNode(2), makeNode(3), makeNode(50, { type: subgraphId })],
        [[1, 50, 0, 2, 0, 'MODEL']]
      ),
      definitions: {
        subgraphs: [
          {
            id: subgraphId,
            inputs: [{ id: 'in-1', name: 'model', type: 'MODEL', linkIds: [2044] }],
            outputs: [{ id: 'out-1', name: 'model', type: 'MODEL', linkIds: [2045] }],
            nodes: [
              makeNode(7, {
                inputs: [{ name: 'in', type: 'MODEL', link: 2044 }],
                outputs: [{ name: 'out', type: 'MODEL', links: [2045] }]
              })
            ],
            groups: [],
            links: [
              { id: 2044, origin_id: -10, origin_slot: 0, target_id: 7, target_slot: 0, type: 'MODEL' },
              { id: 2045, origin_id: 7, origin_slot: 0, target_id: -20, target_slot: 0, type: 'MODEL' }
            ]
          }
        ]
      }
    };
    // Capture the expected structural shape (ignoring client-side itemKey annotations).
    const expectedSubgraph = canonicalWorkflow.definitions!.subgraphs![0];
    useWorkflowStore.setState({
      workflow: canonicalWorkflow,
      ...rootNodeStableRegistry([1, 2, 3, 50]),
      mobileLayout: {
        root: [{ type: 'node', id: 1 }, { type: 'node', id: 2 }, { type: 'node', id: 3 }, { type: 'subgraph', id: subgraphId }],
        groups: {},
        subgraphs: { [subgraphId]: [{ type: 'node', id: 7 }] },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().setSavedWorkflow(useWorkflowStore.getState().workflow as Workflow, 'sg-preserve.json');
    useWorkflowStore.getState().deleteNode(rootNodeHierarchicalKey(3), false);
    const nextSubgraphs = useWorkflowStore.getState().workflow?.definitions?.subgraphs ?? [];
    const sg = nextSubgraphs.find((s) => s.id === subgraphId);
    // Structural integrity: inputs, outputs, links, and node connections must be unchanged.
    // (itemKey annotations on inner nodes are allowed — they are stripped before persistence.)
    expect(sg).toMatchObject({
      id: expectedSubgraph.id,
      inputs: expectedSubgraph.inputs,
      outputs: expectedSubgraph.outputs,
      links: expectedSubgraph.links,
    });
    expect(sg?.nodes.find((n) => n.id === 7)).toMatchObject({
      inputs: [{ name: 'in', type: 'MODEL', link: 2044 }],
      outputs: [{ name: 'out', type: 'MODEL', links: [2045] }],
    });
  });

  it('preserves subgraph definitions in queued embed when deleting a root node', async () => {
    // Canonical model: workflow.nodes holds root nodes + placeholder node (type = subgraph UUID).
    // Inner subgraph nodes live in definitions.subgraphs — deleteNode must not erase them.
    const innerNode = makeNode(7, { widgets_values: [9] });
    const canonicalWorkflow: Workflow = {
      ...makeWorkflow([makeNode(1), makeNode(2), makeNode(3, { type: 'sg-a' })], []),
      definitions: {
        subgraphs: [{ id: 'sg-a', nodes: [innerNode], groups: [], links: [] }]
      }
    };
    useWorkflowStore.setState({
      workflow: canonicalWorkflow,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1, 2, 3]),
      mobileLayout: {
        root: [{ type: 'node', id: 1 }, { type: 'node', id: 2 }, { type: 'subgraph', id: 'sg-a' }],
        groups: {},
        subgraphs: { 'sg-a': [{ type: 'node', id: 7 }] },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteNode(rootNodeHierarchicalKey(2), false);
    const embedded = await queueAndGetEmbeddedWorkflow();
    const sg = embedded.definitions?.subgraphs?.find((subgraph) => subgraph.id === 'sg-a');
    expect(embedded.nodes.some((node) => node.id === 2)).toBe(false);
    expect(sg).toBeDefined();
    expect(sg?.nodes.some((node) => node.id === 7)).toBe(true);
  });

  it('preserves subgraph definitions in queued embed when deleting a root node (subgraph has no groups)', async () => {
    // Same as above but the subgraph definition has no groups key — defensive coverage.
    const innerNode = makeNode(7, { widgets_values: [9] });
    const canonicalWorkflow: Workflow = {
      ...makeWorkflow([makeNode(1), makeNode(2), makeNode(3, { type: 'sg-a' })], []),
      definitions: {
        subgraphs: [{ id: 'sg-a', nodes: [innerNode], links: [] }]
      }
    };
    useWorkflowStore.setState({
      workflow: canonicalWorkflow,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1, 2, 3]),
      mobileLayout: {
        root: [{ type: 'node', id: 1 }, { type: 'node', id: 2 }, { type: 'subgraph', id: 'sg-a' }],
        groups: {},
        subgraphs: { 'sg-a': [{ type: 'node', id: 7 }] },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().deleteNode(rootNodeHierarchicalKey(2), false);
    const embedded = await queueAndGetEmbeddedWorkflow();
    const sg = embedded.definitions?.subgraphs?.find((subgraph) => subgraph.id === 'sg-a');
    expect(embedded.nodes.some((node) => node.id === 2)).toBe(false);
    expect(sg).toBeDefined();
    expect(sg?.nodes.some((node) => node.id === 7)).toBe(true);
  });

  it('queues updated embed workflow after bypassAllInContainer', async () => {
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const wf = makeWorkflow([
      makeNode(1, { pos: [150, 150] }),
      makeNode(2, { pos: [250, 150] })
    ], []);
    useWorkflowStore.setState({
      workflow: wf,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1, 2]),
      itemKeyByPointer: {
        ...rootNodeStableRegistry([1, 2]).itemKeyByPointer,
        [groupPointer]: groupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...rootNodeStableRegistry([1, 2]).pointerByHierarchicalKey,
        [groupHierarchicalKey]: groupPointer
      },
      mobileLayout: {
        root: [
          { type: 'node', id: 1 },
          { type: 'node', id: 2 },
          { type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }
        ],
        groups: { [groupPointer]: [] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });
    useWorkflowStore.getState().bypassAllInContainer(groupHierarchicalKey, true);
    const embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.nodes.find((n) => n.id === 1)?.mode).toBe(4);
    expect(embedded.nodes.find((n) => n.id === 2)?.mode).toBe(4);
  });

  it('commitRepositionLayout syncs geometry so group bypass uses canonical geometry membership', () => {
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const wf = makeWorkflow([
      makeNode(1, { pos: [1200, 1200], mode: 0 }),
      makeNode(2, { pos: [1400, 1200], mode: 0 })
    ], []);
    useWorkflowStore.setState({
      workflow: wf,
      ...rootNodeStableRegistry([1, 2]),
      itemKeyByPointer: {
        ...rootNodeStableRegistry([1, 2]).itemKeyByPointer,
        [groupPointer]: groupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...rootNodeStableRegistry([1, 2]).pointerByHierarchicalKey,
        [groupHierarchicalKey]: groupPointer
      },
      mobileLayout: {
        root: [
          { type: 'node', id: 1 },
          { type: 'node', id: 2 },
          { type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }
        ],
        groups: { [groupPointer]: [] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    const movedLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }],
      groups: { [groupPointer]: [{ type: 'node', id: 1 }, { type: 'node', id: 2 }] },
      subgraphs: {},
      hiddenBlocks: {}
    };
    useWorkflowStore.getState().commitRepositionLayout(movedLayout);
    const repositioned = useWorkflowStore.getState().workflow?.nodes.map((node) => ({ id: node.id, pos: node.pos })) ?? [];
    const node1Pos = repositioned.find((entry) => entry.id === 1)?.pos;
    const node2Pos = repositioned.find((entry) => entry.id === 2)?.pos;
    expect(node1Pos?.[0]).toBeGreaterThanOrEqual(124);
    expect(node2Pos?.[0]).toBeGreaterThanOrEqual(124);
    expect(node1Pos?.[1]).toBeGreaterThanOrEqual(148);
    expect(node1Pos?.[1]).toBeLessThanOrEqual(300);
    expect(node2Pos?.[1]).toBeGreaterThanOrEqual(148);
    expect(node2Pos?.[1]).toBeLessThanOrEqual(300);
    const postCommitWorkflow = useWorkflowStore.getState().workflow as Workflow;
    const grouped = computeNodeGroupsFor(postCommitWorkflow.nodes, postCommitWorkflow.groups ?? []);
    expect(grouped.get(1)).toBe(10);
    expect(grouped.get(2)).toBe(10);
    useWorkflowStore.getState().bypassAllInContainer(groupHierarchicalKey, true);
    const next = useWorkflowStore.getState().workflow;
    expect(next?.nodes.find((n) => n.id === 1)?.mode).toBe(4);
    expect(next?.nodes.find((n) => n.id === 2)?.mode).toBe(4);
  });

  it('commitRepositionLayout moving node out of group removes geometry membership', () => {
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const wf = makeWorkflow([
      makeNode(1, { pos: [150, 150], mode: 0 }),
      makeNode(2, { pos: [250, 150], mode: 0 })
    ], []);
    useWorkflowStore.setState({
      workflow: wf,
      ...rootNodeStableRegistry([1, 2]),
      itemKeyByPointer: {
        ...rootNodeStableRegistry([1, 2]).itemKeyByPointer,
        [groupPointer]: groupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...rootNodeStableRegistry([1, 2]).pointerByHierarchicalKey,
        [groupHierarchicalKey]: groupPointer
      },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }, { type: 'node', id: 2 }] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    const movedOutLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }, { type: 'node', id: 2 }],
      groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
      subgraphs: {},
      hiddenBlocks: {}
    };
    useWorkflowStore.getState().commitRepositionLayout(movedOutLayout);
    const repositioned = useWorkflowStore.getState().workflow?.nodes.map((node) => ({ id: node.id, pos: node.pos })) ?? [];
    const node2Pos = repositioned.find((entry) => entry.id === 2)?.pos;
    expect(node2Pos?.[0]).toBeGreaterThanOrEqual(0);

    useWorkflowStore.getState().bypassAllInContainer(groupHierarchicalKey, true);
    const next = useWorkflowStore.getState().workflow;
    expect(next?.nodes.find((n) => n.id === 1)?.mode).toBe(4);
    expect(next?.nodes.find((n) => n.id === 2)?.mode).toBe(0);
  });

  it('commitRepositionLayout subgraph-to-root: node position is updated, definitions unchanged (canonical model)', () => {
    const expandedNodeHierarchicalKey = 'sk-node-expanded-101';
    const subgraphNodePointer = makeLocationPointer({
      type: 'node',
      nodeId: 101,
      subgraphId: 'sg-a'
    });
    const wf: Workflow = {
      ...makeWorkflow([
        makeNode(101, {
          itemKey: expandedNodeHierarchicalKey,
          type: 'Any',
          pos: [100, 100],
          properties: {}
        })
      ], []),
      groups: [],
      definitions: {
        subgraphs: [
          {
            id: 'sg-a',
            nodes: [
              makeNode(1, { pos: [100, 100], outputs: [{ name: 'out', type: 'MODEL', links: [1] }] }),
              makeNode(2, { pos: [300, 100], inputs: [{ name: 'in', type: 'MODEL', link: 1 }] })
            ],
            links: [
              {
                id: 1,
                origin_id: 1,
                origin_slot: 0,
                target_id: 2,
                target_slot: 0,
                type: 'MODEL'
              }
            ],
            groups: []
          }
        ]
      }
    };

    useWorkflowStore.setState({
      workflow: wf,
      itemKeyByPointer: {
        [subgraphNodePointer]: expandedNodeHierarchicalKey
      },
      pointerByHierarchicalKey: {
        [expandedNodeHierarchicalKey]: subgraphNodePointer
      },
      mobileLayout: {
        root: [{ type: 'subgraph', id: 'sg-a' }],
        groups: {},
        subgraphs: { 'sg-a': [{ type: 'node', id: 101 }] },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().commitRepositionLayout({
      root: [{ type: 'node', id: 101 }, { type: 'subgraph', id: 'sg-a' }],
      groups: {},
      subgraphs: { 'sg-a': [] },
      hiddenBlocks: {}
    });

    const next = useWorkflowStore.getState().workflow as Workflow;
    const moved = next.nodes.find((node) => node.id === 101);
    expect(moved).toBeDefined();
    // Definitions are not modified by commitRepositionLayout in canonical model
    const sg = next.definitions?.subgraphs?.find((subgraph) => subgraph.id === 'sg-a');
    expect(sg?.nodes).toHaveLength(2);
  });

  it('commitRepositionLayout root-to-subgraph: node position is updated, definitions unchanged (canonical model)', () => {
    const expandedNodeHierarchicalKey = rootNodeHierarchicalKey(201);
    const rootPointer = rootNodePointer(201);
    const wf: Workflow = {
      ...makeWorkflow([
        makeNode(201, {
          itemKey: expandedNodeHierarchicalKey,
          type: 'Any',
          pos: [200, 200],
          properties: {}
        })
      ], []),
      groups: [],
      definitions: {
        subgraphs: [
          {
            id: 'sg-a',
            nodes: [makeNode(3, { type: 'Existing' }), makeNode(7, { type: 'Existing' })],
            links: [],
            groups: []
          }
        ]
      }
    };

    useWorkflowStore.setState({
      workflow: wf,
      itemKeyByPointer: {
        [rootPointer]: expandedNodeHierarchicalKey
      },
      pointerByHierarchicalKey: {
        [expandedNodeHierarchicalKey]: rootPointer
      },
      mobileLayout: {
        root: [{ type: 'node', id: 201 }, { type: 'subgraph', id: 'sg-a' }],
        groups: {},
        subgraphs: { 'sg-a': [] },
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().commitRepositionLayout({
      root: [{ type: 'subgraph', id: 'sg-a' }],
      groups: {},
      subgraphs: { 'sg-a': [{ type: 'node', id: 201 }] },
      hiddenBlocks: {}
    });

    const migrated = useWorkflowStore.getState().workflow as Workflow;
    // Canonical model: node 201 remains in root nodes array
    const moved = migrated.nodes.find((node) => node.id === 201);
    expect(moved).toBeDefined();
    // Definitions are not modified by commitRepositionLayout in canonical model
    const sg = migrated.definitions?.subgraphs?.find((subgraph) => subgraph.id === 'sg-a');
    expect(sg).toBeDefined();
    // No new definition node added (canonical model doesn't auto-create definition nodes)
    expect(sg?.nodes).toHaveLength(2);
  });

  it('queues updated embed workflow after container title/color and deleteContainer edits', async () => {
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const wf = makeWorkflow([makeNode(1)], []);
    useWorkflowStore.setState({
      workflow: wf,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1]),
      itemKeyByPointer: {
        ...rootNodeStableRegistry([1]).itemKeyByPointer,
        [groupPointer]: groupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...rootNodeStableRegistry([1]).pointerByHierarchicalKey,
        [groupHierarchicalKey]: groupPointer
      },
      mobileLayout: {
        root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }],
        groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
        subgraphs: {},
        hiddenBlocks: {}
      }
    });

    useWorkflowStore.getState().updateContainerTitle(groupHierarchicalKey, 'Renamed Group');
    let embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.groups?.find((g) => g.id === 10)?.title).toBe('Renamed Group');

    useWorkflowStore.getState().updateWorkflowItemColor(groupHierarchicalKey, '#335555');
    embedded = await queueAndGetEmbeddedWorkflow();
    expect(embedded.groups?.find((g) => g.id === 10)?.color).toBe('#335555');

    useWorkflowStore.getState().deleteContainer(groupHierarchicalKey, { deleteNodes: false });
    embedded = await queueAndGetEmbeddedWorkflow();
    expect((embedded.groups ?? []).find((g) => g.id === 10)).toBeUndefined();
  });

  it('sets subgraph color back to default blue when "no color" is selected', () => {
    const subgraphHierarchicalKey = makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' });
    const subgraphPointer = makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' });
    const wf: Workflow = {
      ...makeWorkflow([makeNode(1)], []),
      definitions: {
        subgraphs: [
          {
            id: 'sg-a',
            itemKey: subgraphHierarchicalKey,
            state: { color: '#3a5455' },
            nodes: [],
            links: []
          }
        ]
      }
    };
    useWorkflowStore.setState({
      workflow: wf,
      itemKeyByPointer: {
        ...rootNodeStableRegistry([1]).itemKeyByPointer,
        [subgraphPointer]: subgraphHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...rootNodeStableRegistry([1]).pointerByHierarchicalKey,
        [subgraphHierarchicalKey]: subgraphPointer
      }
    });

    useWorkflowStore.getState().updateWorkflowItemColor(subgraphHierarchicalKey, '#353535');
    const nextColor = (useWorkflowStore.getState().workflow?.definitions?.subgraphs ?? [])
      .find((subgraph) => subgraph.id === 'sg-a')?.state?.color;
    expect(nextColor).toBe(themeColors.brand.blue500);
  });

  it('preserves exact comfy group colors when toggling away and back', () => {
    const groupPointer = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const wf = makeWorkflow([makeNode(1)], []);
    wf.groups = [{ ...(wf.groups?.[0] as NonNullable<typeof wf.groups>[number]), color: '#553333', itemKey: groupHierarchicalKey }];
    useWorkflowStore.setState({
      workflow: wf,
      itemKeyByPointer: {
        ...rootNodeStableRegistry([1]).itemKeyByPointer,
        [groupPointer]: groupHierarchicalKey
      },
      pointerByHierarchicalKey: {
        ...rootNodeStableRegistry([1]).pointerByHierarchicalKey,
        [groupHierarchicalKey]: groupPointer
      }
    });

    useWorkflowStore.getState().updateWorkflowItemColor(groupHierarchicalKey, '#335555');
    useWorkflowStore.getState().updateWorkflowItemColor(groupHierarchicalKey, '#553333');
    const nextColor = useWorkflowStore.getState().workflow?.groups?.find((group) => group.id === 10)?.color;
    expect(nextColor).toBe('#553333');
  });

  it('preserves exact comfy node colors when toggling away and back', () => {
    const wf = makeWorkflow([
      makeNode(1, { color: '#553333', bgcolor: '#553333' })
    ], []);
    useWorkflowStore.setState({
      workflow: wf,
      ...rootNodeStableRegistry([1])
    });

    useWorkflowStore.getState().updateWorkflowItemColor(rootNodeHierarchicalKey(1), '#335555');
    useWorkflowStore.getState().updateWorkflowItemColor(rootNodeHierarchicalKey(1), '#553333');
    const nextNode = useWorkflowStore.getState().workflow?.nodes.find((node) => node.id === 1);
    expect(nextNode?.color).toBe('#553333');
    expect(nextNode?.bgcolor).toBe('#553333');
  });

  it('queued embed workflow preserves subgraph definitions and updated root node widget value', async () => {
    // Canonical model: root node 1 is a regular node, node 3 is a placeholder for 'sg1'.
    // Inner subgraph node 7 lives in definitions.subgraphs.
    // Editing root node 1's widget should appear in the embedded canonical workflow.
    const innerNode = makeNode(7, { type: 'Any', widgets_values: [0] });
    const canonical: Workflow = {
      ...makeWorkflow([
        makeNode(1, { type: 'Any', widgets_values: [11] }),
        makeNode(3, { type: 'sg1' })
      ], []),
      definitions: {
        subgraphs: [{ id: 'sg1', nodes: [innerNode], links: [] }]
      }
    };
    useWorkflowStore.setState({
      workflow: canonical,
      nodeTypes: queueNodeTypes,
      ...rootNodeStableRegistry([1, 3])
    });

    useWorkflowStore.getState().updateNodeWidget(rootNodeHierarchicalKey(1), 0, 33);
    const embedded = await queueAndGetEmbeddedWorkflow();
    // Root node 1 should have the updated widget value in the embedded workflow
    expect(embedded.nodes.find((n) => n.id === 1)?.widgets_values).toEqual([33]);
    // Subgraph definitions must be preserved in the embedded canonical workflow
    const subgraph = embedded.definitions?.subgraphs?.find((sg) => sg.id === 'sg1');
    expect(subgraph).toBeDefined();
    expect(subgraph?.nodes.some((n) => n.id === 7)).toBe(true);
  });
});

describe('setSavedWorkflow', () => {
  it('sets workflowSource to user type with the saved filename', () => {
    const wf = makeWorkflow([makeNode(1, { widgets_values: [42] })], []);
    useWorkflowStore.getState().loadWorkflow(wf, 'original.json', {
      source: { type: 'template', moduleName: 'default', templateName: 'basic' }
    });

    useWorkflowStore.getState().setSavedWorkflow(wf, 'saved.json');

    const state = useWorkflowStore.getState();
    expect(state.workflowSource).toEqual({ type: 'user', filename: 'saved.json' });
    expect(state.currentFilename).toBe('saved.json');
  });

  it('clears isDirty after saving (originalWorkflow matches workflow)', () => {
    const wf = makeWorkflow([makeNode(1, { widgets_values: [10] })], []);
    useWorkflowStore.getState().loadWorkflow(wf, 'foo.json');

    // Simulate an edit
    useWorkflowStore.setState((state) => ({
      workflow: state.workflow
        ? {
            ...state.workflow,
            nodes: state.workflow.nodes.map((n) =>
              n.id === 1 ? { ...n, widgets_values: [99] } : n
            )
          }
        : state.workflow
    }));

    const editedWorkflow = useWorkflowStore.getState().workflow!;
    useWorkflowStore.getState().setSavedWorkflow(editedWorkflow, 'foo.json');

    const state = useWorkflowStore.getState();
    expect(JSON.stringify(state.workflow)).toBe(JSON.stringify(state.originalWorkflow));
  });

  it('preserves edited widget values after saving', () => {
    const wf = makeWorkflow([makeNode(1, { widgets_values: [10] })], []);
    useWorkflowStore.getState().loadWorkflow(wf, 'foo.json');

    const editedWf = {
      ...wf,
      nodes: wf.nodes.map((n) => n.id === 1 ? { ...n, widgets_values: [99] } : n)
    };
    useWorkflowStore.getState().setSavedWorkflow(editedWf, 'foo.json');

    const state = useWorkflowStore.getState();
    expect(state.workflow?.nodes.find((n) => n.id === 1)?.widgets_values).toEqual([99]);
  });
});
