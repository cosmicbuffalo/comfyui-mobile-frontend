import { describe, expect, it } from 'vitest';
import type {
  Workflow,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { duplicateWorkflowNode, uniquifySubgraphName } from '@/utils/duplicateNode';
import { getInstanceNumber, getMobileDefMeta } from '@/utils/canonicalWorkflowOps';

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

  it('makes another instance of the definition rather than forking it', () => {
    // The copy is a copy: the type is shared, so the two stay the same shape
    // and an edit inside reaches both. Forking is a separate, deliberate act.
    const result = duplicateWorkflowNode(workflow, 'root/node:7');
    expect(result).not.toBeNull();
    const { workflow: next, newNodeId } = result!;

    expect(next.definitions!.subgraphs!).toHaveLength(1);
    const copy = next.nodes.find((n) => n.id === newNodeId)!;
    expect(copy.type).toBe('SG');
    // The original inner nodes are untouched — nothing was cloned.
    expect(sgDef.nodes.map((n) => n.id)).toEqual([100, 101]);

    // Per-instance widget values are copied, not aliased.
    expect(copy.widgets_values).toEqual(['promoted']);
    expect(copy.widgets_values).not.toBe(workflow.nodes[1].widgets_values);
    // Incoming connection recreated; external output dropped.
    expect(copy.inputs[0].link).not.toBeNull();
    expect(copy.outputs[0].links).toBeNull();
    const newInputLink = next.links.find((l) => l[0] === copy.inputs[0].link)!;
    expect(newInputLink[1]).toBe(1); // from source node
    expect(newInputLink[3]).toBe(newNodeId);
  });

  it('numbers both instances when the definition had never been numbered', () => {
    // A subgraph that arrived from desktop has no instance numbers at all.
    // They are handed out here, at the first moment a number means anything.
    const { workflow: next, newNodeId } = duplicateWorkflowNode(workflow, 'root/node:7')!;

    expect(getInstanceNumber(next.nodes.find((n) => n.id === 7)!)).toBe(1);
    expect(getInstanceNumber(next.nodes.find((n) => n.id === newNodeId)!)).toBe(2);
    expect(getMobileDefMeta(next.definitions!.subgraphs![0]).nextInstanceNumber).toBe(3);
  });

  it('takes the next instance number from the definition counter', () => {
    const promoted = {
      ...workflow,
      definitions: {
        subgraphs: [
          {
            ...sgDef,
            name: 'Upscale',
            extra: { 'comfyui-mobile': { promoted: true, nextInstanceNumber: 2 } },
          },
        ],
      },
    };
    const result = duplicateWorkflowNode(promoted, 'root/node:7');
    expect(result).not.toBeNull();
    const { workflow: next, newNodeId } = result!;

    const copy = next.nodes.find((n) => n.id === newNodeId)!;
    // The counter is what hands out the number, not the instance count — a
    // deleted instance must not have its number reused by the next one.
    expect(getInstanceNumber(copy)).toBe(2);
    expect(getMobileDefMeta(next.definitions!.subgraphs![0]).nextInstanceNumber).toBe(3);
  });
});

describe('uniquifySubgraphName', () => {
  const defs = (...names: Array<string | undefined>) =>
    names.map((name, i) => ({ id: `d${i}`, name, nodes: [], links: [] }));

  it('returns the base unchanged when free', () => {
    expect(uniquifySubgraphName('Foo', defs('Bar'))).toBe('Foo');
  });

  it('appends the lowest free suffix when taken', () => {
    expect(uniquifySubgraphName('Foo', defs('Foo'))).toBe('Foo 2');
    expect(uniquifySubgraphName('Foo', defs('Foo', 'Foo 2'))).toBe('Foo 3');
  });

  it('strips an existing numeric suffix before counting up', () => {
    expect(uniquifySubgraphName('Foo 2', defs('Foo', 'Foo 2'))).toBe('Foo 3');
  });

  it('falls back to "Subgraph" for unnamed definitions', () => {
    expect(uniquifySubgraphName(undefined, defs('Bar'))).toBe('Subgraph');
    expect(uniquifySubgraphName(undefined, defs('Subgraph'))).toBe('Subgraph 2');
  });
});
