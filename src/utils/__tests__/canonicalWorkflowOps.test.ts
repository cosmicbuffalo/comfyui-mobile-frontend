import { describe, expect, it, beforeEach } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import {
  type ScopeFrame,
  resolveCurrentScope,
  resolveNodeByHierarchicalKey,
  updateNodeInScope,
  isSubgraphPlaceholder,
} from '@/utils/canonicalWorkflowOps';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';

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

function makeWorkflow(
  rootNodes: WorkflowNode[],
  subgraphId?: string,
  innerNodes?: WorkflowNode[],
): Workflow {
  return {
    last_node_id: Math.max(0, ...rootNodes.map((n) => n.id)),
    last_link_id: 0,
    nodes: rootNodes,
    links: [],
    groups: [],
    config: {},
    version: 0.4,
    ...(subgraphId && innerNodes
      ? {
          definitions: {
            subgraphs: [
              { id: subgraphId, nodes: innerNodes, groups: [], links: [] },
            ],
          },
        }
      : {}),
  };
}

describe('resolveCurrentScope', () => {
  it('root scope: nodes/links/groups come from canonical root', () => {
    const node1 = makeNode(1);
    const workflow = makeWorkflow([node1]);
    const scopeStack: ScopeFrame[] = [{ type: 'root' }];
    const scope = resolveCurrentScope(scopeStack, workflow);
    expect(scope.subgraphId).toBeNull();
    expect(scope.nodes).toBe(workflow.nodes);
    expect(scope.links).toBe(workflow.links);
  });

  it('root scope: applyPatch updates root nodes', () => {
    const workflow = makeWorkflow([makeNode(1), makeNode(2)]);
    const scopeStack: ScopeFrame[] = [{ type: 'root' }];
    const scope = resolveCurrentScope(scopeStack, workflow);
    const nextNodes = workflow.nodes.map((n) =>
      n.id === 1 ? { ...n, mode: 4 } : n,
    );
    const updated = scope.applyPatch(workflow, { nodes: nextNodes });
    expect(updated.nodes[0]?.mode).toBe(4);
    expect(updated.nodes[1]?.mode).toBe(0);
    // definitions unchanged
    expect(updated.definitions).toBeUndefined();
  });

  it('subgraph scope: nodes/links/groups come from subgraph definition', () => {
    const inner = makeNode(10, {
      itemKey: makeLocationPointer({ type: 'node', nodeId: 10, subgraphId: 'sg-uuid' }),
    });
    const placeholder = makeNode(5, { type: 'sg-uuid' });
    const workflow = makeWorkflow([placeholder], 'sg-uuid', [inner]);
    const scopeStack: ScopeFrame[] = [
      { type: 'root' },
      { type: 'subgraph', id: 'sg-uuid', placeholderNodeId: 5 },
    ];
    const scope = resolveCurrentScope(scopeStack, workflow);
    expect(scope.subgraphId).toBe('sg-uuid');
    expect(scope.nodes).toEqual([inner]);
    expect(scope.nodes).toBe(
      workflow.definitions!.subgraphs![0]!.nodes,
    );
  });

  it('subgraph scope: applyPatch updates inner nodes without touching root', () => {
    const inner = makeNode(10);
    const placeholder = makeNode(5, { type: 'sg-uuid' });
    const workflow = makeWorkflow([placeholder], 'sg-uuid', [inner]);
    const scopeStack: ScopeFrame[] = [
      { type: 'root' },
      { type: 'subgraph', id: 'sg-uuid', placeholderNodeId: 5 },
    ];
    const scope = resolveCurrentScope(scopeStack, workflow);
    const nextInnerNodes = scope.nodes.map((n) => ({ ...n, mode: 4 }));
    const updated = scope.applyPatch(workflow, { nodes: nextInnerNodes });
    // Root nodes unchanged
    expect(updated.nodes[0]?.id).toBe(5);
    expect(updated.nodes[0]?.mode).toBe(0);
    // Inner node updated
    expect(updated.definitions?.subgraphs?.[0]?.nodes[0]?.mode).toBe(4);
  });

  it('fallback to root when subgraph id not found in definitions', () => {
    const workflow = makeWorkflow([makeNode(1)]);
    const scopeStack: ScopeFrame[] = [
      { type: 'subgraph', id: 'missing-sg', placeholderNodeId: 99 },
    ];
    const scope = resolveCurrentScope(scopeStack, workflow);
    expect(scope.subgraphId).toBeNull();
    expect(scope.nodes).toBe(workflow.nodes);
  });

  it('empty scopeStack defaults to root', () => {
    const workflow = makeWorkflow([makeNode(1)]);
    const scope = resolveCurrentScope([], workflow);
    expect(scope.subgraphId).toBeNull();
  });
});

describe('resolveNodeByHierarchicalKey', () => {
  it('finds a node by itemKey', () => {
    const itemKey = makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null });
    const node = makeNode(1, { itemKey });
    const result = resolveNodeByHierarchicalKey([node, makeNode(2)], itemKey);
    expect(result).toBe(node);
  });

  it('returns null when not found', () => {
    const result = resolveNodeByHierarchicalKey([makeNode(1)], 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('updateNodeInScope', () => {
  it('updates a node in root scope', () => {
    const workflow = makeWorkflow([makeNode(1), makeNode(2)]);
    const scopeStack: ScopeFrame[] = [{ type: 'root' }];
    const scope = resolveCurrentScope(scopeStack, workflow);
    const updated = updateNodeInScope(workflow, scope, 1, (n) => ({
      ...n,
      mode: 4,
    }));
    expect(updated.nodes.find((n) => n.id === 1)?.mode).toBe(4);
    expect(updated.nodes.find((n) => n.id === 2)?.mode).toBe(0);
  });

  it('updates a node in subgraph scope without touching root', () => {
    const inner = makeNode(10);
    const placeholder = makeNode(5, { type: 'sg-uuid' });
    const workflow = makeWorkflow([placeholder], 'sg-uuid', [inner]);
    const scopeStack: ScopeFrame[] = [
      { type: 'root' },
      { type: 'subgraph', id: 'sg-uuid', placeholderNodeId: 5 },
    ];
    const scope = resolveCurrentScope(scopeStack, workflow);
    const updated = updateNodeInScope(workflow, scope, 10, (n) => ({
      ...n,
      mode: 4,
    }));
    // Root placeholder unchanged
    expect(updated.nodes[0]?.mode).toBe(0);
    // Inner node updated
    expect(updated.definitions?.subgraphs?.[0]?.nodes[0]?.mode).toBe(4);
  });
});

describe('isSubgraphPlaceholder', () => {
  it('returns true for a node whose type matches a subgraph UUID', () => {
    const inner = makeNode(10);
    const placeholder = makeNode(5, { type: 'sg-uuid-1234' });
    const workflow = makeWorkflow([placeholder], 'sg-uuid-1234', [inner]);
    expect(isSubgraphPlaceholder(placeholder, workflow)).toBe(true);
  });

  it('returns false for a regular node', () => {
    const regularNode = makeNode(1, { type: 'KSampler' });
    const workflow = makeWorkflow([regularNode], 'sg-uuid-1234', [makeNode(10)]);
    expect(isSubgraphPlaceholder(regularNode, workflow)).toBe(false);
  });

  it('returns false when workflow has no subgraph definitions', () => {
    const node = makeNode(1, { type: 'some-type' });
    const workflow = makeWorkflow([node]);
    expect(isSubgraphPlaceholder(node, workflow)).toBe(false);
  });
});

describe('enterSubgraph / exitSubgraph / exitToRoot', () => {
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
    });
  });

  function loadWorkflowWithSubgraph() {
    const inner = makeNode(10, {
      itemKey: makeLocationPointer({ type: 'node', nodeId: 10, subgraphId: 'sg-uuid' }),
    });
    const placeholder = makeNode(5, {
      type: 'sg-uuid',
      itemKey: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null }),
    });
    const workflow = makeWorkflow([placeholder], 'sg-uuid', [inner]);
    useWorkflowStore.setState({ workflow });
    return { placeholder, inner, workflow };
  }

  function loadWorkflowWithNestedSubgraphs() {
    const nestedInner = makeNode(20, {
      itemKey: makeLocationPointer({ type: 'node', nodeId: 20, subgraphId: 'sg-b' }),
    });
    const nestedPlaceholder = makeNode(11, {
      type: 'sg-b',
      itemKey: makeLocationPointer({ type: 'node', nodeId: 11, subgraphId: 'sg-a' }),
    });
    const outerPlaceholder = makeNode(5, {
      type: 'sg-a',
      itemKey: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: null }),
    });
    const workflow: Workflow = {
      last_node_id: 20,
      last_link_id: 0,
      nodes: [outerPlaceholder],
      links: [],
      groups: [],
      config: {},
      version: 0.4,
      definitions: {
        subgraphs: [
          { id: 'sg-a', nodes: [nestedPlaceholder], groups: [], links: [] },
          { id: 'sg-b', nodes: [nestedInner], groups: [], links: [] },
        ],
      },
    };
    useWorkflowStore.setState({ workflow });
    return { outerPlaceholder, nestedPlaceholder };
  }

  it('enterSubgraph pushes a subgraph frame onto scopeStack', () => {
    const { placeholder } = loadWorkflowWithSubgraph();
    useWorkflowStore.getState().enterSubgraph(placeholder.id);
    const stack = useWorkflowStore.getState().scopeStack;
    expect(stack).toHaveLength(2);
    expect(stack[1]).toMatchObject({ type: 'subgraph', id: 'sg-uuid', placeholderNodeId: placeholder.id });
  });

  it('exitSubgraph pops the last frame', () => {
    const { placeholder } = loadWorkflowWithSubgraph();
    useWorkflowStore.getState().enterSubgraph(placeholder.id);
    useWorkflowStore.getState().exitSubgraph();
    const stack = useWorkflowStore.getState().scopeStack;
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({ type: 'root' });
  });

  it('exitSubgraph is a no-op at root scope', () => {
    useWorkflowStore.getState().exitSubgraph();
    const stack = useWorkflowStore.getState().scopeStack;
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({ type: 'root' });
  });

  it('exitToRoot resets scopeStack to [root] regardless of depth', () => {
    const { placeholder } = loadWorkflowWithSubgraph();
    useWorkflowStore.getState().enterSubgraph(placeholder.id);
    useWorkflowStore.getState().exitToRoot();
    const stack = useWorkflowStore.getState().scopeStack;
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({ type: 'root' });
  });

  it('navigateToSubgraphTrail builds nested scope stack for cross-scope bookmark jumps', () => {
    const { outerPlaceholder, nestedPlaceholder } = loadWorkflowWithNestedSubgraphs();
    const didNavigate = useWorkflowStore.getState().navigateToSubgraphTrail(['sg-a', 'sg-b']);
    expect(didNavigate).toBe(true);
    expect(useWorkflowStore.getState().scopeStack).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: 'sg-a', placeholderNodeId: outerPlaceholder.id },
      { type: 'subgraph', id: 'sg-b', placeholderNodeId: nestedPlaceholder.id },
    ]);
  });

  it('navigateToSubgraphTrail returns false when the scope trail cannot be resolved', () => {
    loadWorkflowWithSubgraph();
    const didNavigate = useWorkflowStore.getState().navigateToSubgraphTrail(['missing-sg']);
    expect(didNavigate).toBe(false);
    expect(useWorkflowStore.getState().scopeStack).toEqual([{ type: 'root' }]);
  });

  it('enterSubgraph is a no-op for a node that is not a placeholder', () => {
    const { workflow } = loadWorkflowWithSubgraph();
    // Node 10 is an inner node, not a placeholder in the root
    useWorkflowStore.setState({
      workflow: {
        ...workflow,
        nodes: [
          ...workflow.nodes,
          makeNode(10, {
            type: 'KSampler',
            itemKey: makeLocationPointer({ type: 'node', nodeId: 10, subgraphId: null }),
          }),
        ],
      },
    });
    useWorkflowStore.getState().enterSubgraph(10);
    const stack = useWorkflowStore.getState().scopeStack;
    // Still at root because node 10 has type KSampler, not a subgraph UUID
    expect(stack).toHaveLength(1);
  });
});
