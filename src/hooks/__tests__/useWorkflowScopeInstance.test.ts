import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';

const INNER = 'sg-inner';
const OUTER = 'sg-outer';

function node(id: number, type: string, subgraphId: string | null, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type,
    itemKey: makeLocationPointer({ type: 'node', nodeId: id, subgraphId }),
    pos: [0, 0],
    size: [10, 10],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  } as WorkflowNode;
}

/** Instance 10 of INNER at root; instance 30 nested inside OUTER. */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 40,
    last_link_id: 40,
    nodes: [node(10, INNER, null), node(20, OUTER, null)],
    links: [],
    groups: [],
    config: {},
    definitions: {
      subgraphs: [
        { id: INNER, name: 'Inner', inputs: [], outputs: [], nodes: [], links: [] },
        {
          id: OUTER,
          name: 'Outer',
          inputs: [],
          outputs: [],
          nodes: [node(30, INNER, OUTER)],
          links: [],
        },
      ],
    },
  } as unknown as Workflow;
}

const scopeStack = () => useWorkflowStore.getState().scopeStack;

describe('subgraph scope instance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      scopeStack: [{ type: 'root' }],
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches which instance the boundary is read through, in place', () => {
    useWorkflowStore.getState().enterSubgraph(10);
    expect(scopeStack()).toHaveLength(2);

    useWorkflowStore.getState().setScopeInstance(30);

    // The nodes on screen belong to the type either way, so the depth is the
    // same — but the trail now runs through the other instance's parent.
    expect(scopeStack()).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: OUTER, placeholderNodeId: 20 },
      {
        type: 'subgraph',
        id: INNER,
        placeholderNodeId: 30,
        enteredPlaceholderNodeId: 10,
      },
    ]);
  });

  it('remembers the instance originally entered through across two switches', () => {
    useWorkflowStore.getState().enterSubgraph(10);
    useWorkflowStore.getState().setScopeInstance(30);
    useWorkflowStore.getState().setScopeInstance(10);

    const top = scopeStack()[scopeStack().length - 1];
    expect(top).toMatchObject({ placeholderNodeId: 10, enteredPlaceholderNodeId: 10 });
  });

  it('refuses an instance of a different type', () => {
    useWorkflowStore.getState().enterSubgraph(10);
    const before = scopeStack();

    // Node 20 is a placeholder, but of OUTER — adopting it would leave this
    // scope showing INNER's nodes under OUTER's boundary.
    useWorkflowStore.getState().setScopeInstance(20);

    expect(scopeStack()).toEqual(before);
  });

  it('lands on the instance switched to when leaving', () => {
    const scrollToNode = vi.fn();
    useWorkflowStore.setState({ scrollToNode });
    useWorkflowStore.getState().enterSubgraph(10);
    useWorkflowStore.getState().setScopeInstance(30);

    useWorkflowStore.getState().exitSubgraph();
    vi.runAllTimers();

    // Back in OUTER, on instance 30 — where the user's attention ended up,
    // not instance 10 where the scroll memory would have put them.
    expect(scopeStack()).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: OUTER, placeholderNodeId: 20 },
    ]);
    expect(scrollToNode).toHaveBeenCalledWith(
      makeLocationPointer({ type: 'node', nodeId: 30, subgraphId: OUTER }),
    );
  });

  it('leaves scrolling to the scroll memory when no switch happened', () => {
    const scrollToNode = vi.fn();
    useWorkflowStore.setState({ scrollToNode });
    useWorkflowStore.getState().enterSubgraph(10);

    useWorkflowStore.getState().exitSubgraph();
    vi.runAllTimers();

    expect(scrollToNode).not.toHaveBeenCalled();
  });

  it('does not scroll after switching back to the instance entered through', () => {
    const scrollToNode = vi.fn();
    useWorkflowStore.setState({ scrollToNode });
    useWorkflowStore.getState().enterSubgraph(10);
    useWorkflowStore.getState().setScopeInstance(30);
    useWorkflowStore.getState().setScopeInstance(10);

    useWorkflowStore.getState().exitSubgraph();
    vi.runAllTimers();

    expect(scrollToNode).not.toHaveBeenCalled();
  });
});

describe('setScopeTrail', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      scopeStack: [{ type: 'root' }],
    });
  });

  it('moves to a resolved trail', () => {
    useWorkflowStore.getState().setScopeTrail([
      { type: 'root' },
      { type: 'subgraph', id: OUTER, placeholderNodeId: 20 },
    ]);

    expect(scopeStack()).toHaveLength(2);
  });

  it('refuses a trail naming a placeholder that is gone', () => {
    useWorkflowStore.getState().setScopeTrail([
      { type: 'root' },
      { type: 'subgraph', id: OUTER, placeholderNodeId: 999 },
    ]);

    expect(scopeStack()).toEqual([{ type: 'root' }]);
  });

  it('refuses a trail whose frame names the wrong type for its placeholder', () => {
    useWorkflowStore.getState().setScopeTrail([
      { type: 'root' },
      { type: 'subgraph', id: INNER, placeholderNodeId: 20 },
    ]);

    expect(scopeStack()).toEqual([{ type: 'root' }]);
  });
});
