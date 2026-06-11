import { describe, expect, it } from 'vitest';
import type {
  Workflow,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { duplicateWorkflowNode } from '@/utils/duplicateNode';

function node(partial: Partial<WorkflowNode> & { id: number; type: string }): WorkflowNode {
  return {
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    ...partial,
  };
}

function baseWorkflow(partial: Partial<Workflow>): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 0.4,
    ...partial,
  };
}

describe('duplicateWorkflowNode — regular node', () => {
  // node 1 (source) → node 5 (target, duplicated) → node 9 (downstream)
  const workflow = baseWorkflow({
    last_node_id: 9,
    last_link_id: 20,
    nodes: [
      node({
        id: 1,
        type: 'Source',
        itemKey: 'root/node:1',
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [10], slot_index: 0 }],
      }),
      node({
        id: 5,
        type: 'Target',
        itemKey: 'root/node:5',
        widgets_values: ['hello', 5],
        inputs: [{ name: 'image', type: 'IMAGE', link: 10 }],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [20], slot_index: 0 }],
      }),
      node({
        id: 9,
        type: 'Downstream',
        itemKey: 'root/node:9',
        inputs: [{ name: 'image', type: 'IMAGE', link: 20 }],
      }),
    ],
    links: [
      [10, 1, 0, 5, 0, 'IMAGE'],
      [20, 5, 0, 9, 0, 'IMAGE'],
    ],
  });

  it('copies values + input connections and clears outputs', () => {
    const result = duplicateWorkflowNode(workflow, 'root/node:5');
    expect(result).not.toBeNull();
    const { workflow: next, newNodeId } = result!;
    expect(newNodeId).toBe(10);

    const copy = next.nodes.find((n) => n.id === newNodeId)!;
    expect(copy.type).toBe('Target');
    // Values copied but not the same array reference.
    expect(copy.widgets_values).toEqual(['hello', 5]);
    expect(copy.widgets_values).not.toBe(workflow.nodes[1].widgets_values);
    // External outgoing connection is dropped on the copy.
    expect(copy.outputs[0].links).toBeNull();

    // Incoming connection recreated with a fresh link id.
    const newLinkId = copy.inputs[0].link;
    expect(newLinkId).toBe(21);
    const newLink = next.links.find((l) => l[0] === newLinkId)!;
    expect(newLink).toEqual([21, 1, 0, 10, 0, 'IMAGE']);

    // The source output now lists both the original and the new link.
    const source = next.nodes.find((n) => n.id === 1)!;
    expect(source.outputs[0].links).toEqual([10, 21]);

    // The original node 5 is untouched.
    const original = next.nodes.find((n) => n.id === 5)!;
    expect(original.outputs[0].links).toEqual([20]);
    expect(original.inputs[0].link).toBe(10);
  });
});

describe('duplicateWorkflowNode — subgraph placeholder', () => {
  const sgDef: WorkflowSubgraphDefinition = {
    id: 'SG',
    nodes: [
      node({ id: 100, type: 'Inner1', outputs: [{ name: 'o', type: 'IMAGE', links: [201], slot_index: 0 }] }),
      node({ id: 101, type: 'Inner2', inputs: [{ name: 'i', type: 'IMAGE', link: 201 }] }),
    ],
    links: [
      { id: 200, origin_id: -10, origin_slot: 0, target_id: 100, target_slot: 0, type: 'IMAGE' },
      { id: 201, origin_id: 100, origin_slot: 0, target_id: 101, target_slot: 0, type: 'IMAGE' },
      { id: 202, origin_id: 101, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
    ],
    inputs: [{ id: 'in0', name: 'image', type: 'IMAGE', linkIds: [200] }],
    outputs: [{ id: 'out0', name: 'image', type: 'IMAGE', linkIds: [202] }],
  };

  const workflow = baseWorkflow({
    last_node_id: 101,
    last_link_id: 40,
    nodes: [
      node({
        id: 1,
        type: 'Source',
        itemKey: 'root/node:1',
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [30], slot_index: 0 }],
      }),
      node({
        id: 7,
        type: 'SG',
        itemKey: 'root/node:7',
        widgets_values: ['promoted'],
        inputs: [{ name: 'image', type: 'IMAGE', link: 30 }],
        outputs: [{ name: 'image', type: 'IMAGE', links: [40], slot_index: 0 }],
      }),
      node({
        id: 8,
        type: 'Downstream',
        itemKey: 'root/node:8',
        inputs: [{ name: 'image', type: 'IMAGE', link: 40 }],
      }),
    ],
    links: [
      [30, 1, 0, 7, 0, 'IMAGE'],
      [40, 7, 0, 8, 0, 'IMAGE'],
    ],
    definitions: { subgraphs: [sgDef] },
  });

  it('deep-copies the definition with fresh inner ids and a new placeholder', () => {
    const result = duplicateWorkflowNode(workflow, 'root/node:7');
    expect(result).not.toBeNull();
    const { workflow: next, newNodeId } = result!;

    // A second definition exists, with a distinct id.
    const subgraphs = next.definitions!.subgraphs!;
    expect(subgraphs).toHaveLength(2);
    const newDef = subgraphs.find((sg) => sg.id !== 'SG')!;
    expect(newDef.id).not.toBe('SG');

    // Inner nodes were re-id'd above the workflow max (101); originals untouched.
    const innerIds = newDef.nodes.map((n) => n.id).sort((a, b) => a - b);
    expect(innerIds).toEqual([102, 103]);
    expect(sgDef.nodes.map((n) => n.id)).toEqual([100, 101]);

    // Inner links remap endpoints but keep boundary sentinels.
    const boundaryIn = newDef.links.find((l) => l.origin_id === -10)!;
    expect(boundaryIn.target_id).toBe(102);
    const boundaryOut = newDef.links.find((l) => l.target_id === -20)!;
    expect(boundaryOut.origin_id).toBe(103);
    const innerLink = newDef.links.find((l) => l.origin_id > 0 && l.target_id > 0)!;
    expect(innerLink.origin_id).toBe(102);
    expect(innerLink.target_id).toBe(103);

    // The new placeholder points at the new definition, keeps values, copies the
    // input connection, and drops the external output.
    const copy = next.nodes.find((n) => n.id === newNodeId)!;
    expect(copy.type).toBe(newDef.id);
    expect(copy.widgets_values).toEqual(['promoted']);
    expect(copy.outputs[0].links).toBeNull();
    expect(copy.inputs[0].link).not.toBeNull();
    const newInputLink = next.links.find((l) => l[0] === copy.inputs[0].link)!;
    expect(newInputLink[1]).toBe(1); // from source node
    expect(newInputLink[3]).toBe(newNodeId);
  });
});
