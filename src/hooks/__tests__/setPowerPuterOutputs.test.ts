import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';

const PUTER = 'Power Puter (rgthree)';

function pointer(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function makeNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: pointer(id),
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

function makeWorkflow(nodes: WorkflowNode[], links: WorkflowLink[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: Math.max(0, ...links.map((l) => l[0])),
    nodes,
    links,
    groups: [],
    config: {},
    version: 1,
  } as unknown as Workflow;
}

function registry(nodeIds: number[]) {
  const itemKeyByPointer: Record<string, string> = {};
  const pointerByHierarchicalKey: Record<string, string> = {};
  for (const id of nodeIds) {
    itemKeyByPointer[pointer(id)] = pointer(id);
    pointerByHierarchicalKey[pointer(id)] = pointer(id);
  }
  return { itemKeyByPointer, pointerByHierarchicalKey };
}

const nodeTypes = {
  [PUTER]: { input: { required: {}, optional: {} }, output: ['*'] },
  Any: { input: { required: {} }, output: ['*'] },
} as unknown as NodeTypes;

/**
 * A Power Puter with two outputs, the second of which feeds node 2's `b` input
 * over link 5. Shrinking the node to one output must take that link with it.
 */
function twoOutputSetup() {
  const puter = makeNode(1, {
    type: PUTER,
    widgets_values: [{ outputs: ['STRING', 'INT'] }, 'a + b'],
    outputs: [
      { name: 'STRING', type: 'STRING', links: null },
      { name: 'INT', type: 'INT', links: [5] },
    ],
  });
  const consumer = makeNode(2, {
    inputs: [{ name: 'b', type: 'INT', link: 5 }] as never,
  });
  return { puter, consumer };
}

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null,
    nodeTypes: null,
    mobileLayout: createEmptyMobileLayout(),
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    scopeStack: [{ type: 'root' }],
  });
});

describe('setPowerPuterOutputs', () => {
  it('writes the widget value in the envelope the backend reads', () => {
    const { puter, consumer } = twoOutputSetup();
    useWorkflowStore.setState({
      workflow: makeWorkflow([puter, consumer], [[5, 1, 1, 2, 0, 'INT']]),
      nodeTypes,
      ...registry([1, 2]),
    });

    useWorkflowStore.getState().setPowerPuterOutputs(pointer(1), 0, ['STRING', 'FLOAT']);

    const next = useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === 1)!;
    expect((next.widgets_values as unknown[])[0]).toEqual({ outputs: ['STRING', 'FLOAT'] });
    // The code widget must not move or be clobbered.
    expect((next.widgets_values as unknown[])[1]).toBe('a + b');
  });

  it('rebuilds the output slots to match', () => {
    const { puter, consumer } = twoOutputSetup();
    useWorkflowStore.setState({
      workflow: makeWorkflow([puter, consumer], [[5, 1, 1, 2, 0, 'INT']]),
      nodeTypes,
      ...registry([1, 2]),
    });

    useWorkflowStore.getState().setPowerPuterOutputs(pointer(1), 0, ['FLOAT', 'INT', 'BOOLEAN']);

    const next = useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === 1)!;
    expect(next.outputs.map((o) => o.type)).toEqual(['FLOAT', 'INT', 'BOOLEAN']);
    expect(next.outputs.map((o) => o.slot_index)).toEqual([0, 1, 2]);
  });

  it('drops the link a removed output was carrying, on both ends', () => {
    // Leaving it behind points a link at a slot index that no longer exists —
    // exactly the graph corruption upstream avoids by calling disconnectOutput
    // before removeOutput.
    const { puter, consumer } = twoOutputSetup();
    useWorkflowStore.setState({
      workflow: makeWorkflow([puter, consumer], [[5, 1, 1, 2, 0, 'INT']]),
      nodeTypes,
      ...registry([1, 2]),
    });

    useWorkflowStore.getState().setPowerPuterOutputs(pointer(1), 0, ['STRING']);

    const wf = useWorkflowStore.getState().workflow!;
    expect(wf.links.find((l) => l[0] === 5)).toBeUndefined();
    expect(wf.nodes.find((n) => n.id === 2)!.inputs[0].link).toBeNull();
    expect(wf.nodes.find((n) => n.id === 1)!.outputs).toHaveLength(1);
  });

  it('keeps links when a slot is only retyped', () => {
    // Upstream warns about compatibility but does not disconnect — `*` to a
    // concrete type and back are both legitimate edits.
    const { puter, consumer } = twoOutputSetup();
    useWorkflowStore.setState({
      workflow: makeWorkflow([puter, consumer], [[5, 1, 1, 2, 0, 'INT']]),
      nodeTypes,
      ...registry([1, 2]),
    });

    useWorkflowStore.getState().setPowerPuterOutputs(pointer(1), 0, ['STRING', '*']);

    const wf = useWorkflowStore.getState().workflow!;
    expect(wf.links.find((l) => l[0] === 5)).toBeDefined();
    expect(wf.nodes.find((n) => n.id === 1)!.outputs[1].links).toEqual([5]);
  });

  it('refuses to empty the outputs list', () => {
    // The node must always declare at least one output; upstream's chip menu
    // hides Delete at one entry for the same reason.
    const { puter, consumer } = twoOutputSetup();
    useWorkflowStore.setState({
      workflow: makeWorkflow([puter, consumer], [[5, 1, 1, 2, 0, 'INT']]),
      nodeTypes,
      ...registry([1, 2]),
    });

    useWorkflowStore.getState().setPowerPuterOutputs(pointer(1), 0, []);

    expect(useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === 1)!.outputs).toHaveLength(2);
  });
});
