import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import {
  collectReachableSubgraphIds,
  replaceSubgraphInstance,
} from '@/utils/replaceSubgraphInstance';

function node(partial: Partial<WorkflowNode> & { id: number; type: string }): WorkflowNode {
  return {
    pos: [10, 20],
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

const promotedMeta = { 'comfyui-mobile': { promoted: true, nextInstanceNumber: 2 } };

// Old def: inputs image/IMAGE + strength/FLOAT (widget); output image/IMAGE.
const oldDef: WorkflowSubgraphDefinition = {
  id: 'OLD',
  name: 'Old',
  inputs: [
    { id: 'a', name: 'image', type: 'IMAGE', linkIds: [] },
    { id: 'b', name: 'strength', type: 'FLOAT', linkIds: [] },
    { id: 'c', name: 'mask', type: 'MASK', linkIds: [] },
  ],
  outputs: [{ id: 'o', name: 'image', type: 'IMAGE', linkIds: [] }],
  nodes: [node({ id: 100, type: 'InnerOld' })],
  links: [],
};

// New (promoted) def: image slot matches by name, strength widget matches,
// no mask input; output renamed but same type.
const newDef: WorkflowSubgraphDefinition = {
  id: 'NEW',
  name: 'New Type',
  inputs: [
    { id: 'a', name: 'image', type: 'IMAGE', linkIds: [] },
    { id: 'b', name: 'strength', type: 'FLOAT', linkIds: [] },
  ],
  outputs: [{ id: 'o', name: 'result', type: 'IMAGE', linkIds: [] }],
  nodes: [node({ id: 200, type: 'InnerNew' })],
  links: [],
  extra: promotedMeta,
};

function makeWorkflow(): Workflow {
  return baseWorkflow({
    last_node_id: 200,
    last_link_id: 60,
    nodes: [
      node({
        id: 1,
        type: 'LoadImage',
        itemKey: 'root/node:1',
        outputs: [
          { name: 'IMAGE', type: 'IMAGE', links: [50] },
          { name: 'MASK', type: 'MASK', links: [51] },
        ],
      }),
      node({
        id: 5,
        type: 'OLD',
        title: 'my old subgraph',
        itemKey: 'root/node:5',
        inputs: [
          { name: 'image', type: 'IMAGE', link: 50 },
          { name: 'strength', type: 'FLOAT', widget: { name: 'strength' }, link: null },
          { name: 'mask', type: 'MASK', link: 51 },
        ],
        outputs: [{ name: 'image', type: 'IMAGE', links: [52] }],
        widgets_values: [0.7],
      }),
      node({
        id: 8,
        type: 'SaveImage',
        itemKey: 'root/node:8',
        inputs: [{ name: 'images', type: 'IMAGE', link: 52 }],
      }),
      // Existing instance of NEW, used as the shape template.
      node({
        id: 9,
        type: 'NEW',
        itemKey: 'root/node:9',
        properties: { mobileInstanceNumber: 1 },
        inputs: [
          { name: 'image', type: 'IMAGE', link: null },
          { name: 'strength', type: 'FLOAT', widget: { name: 'strength' }, link: null },
        ],
        outputs: [{ name: 'result', type: 'IMAGE', links: null }],
        widgets_values: [0.25],
      }),
    ],
    links: [
      [50, 1, 0, 5, 0, 'IMAGE'],
      [51, 1, 1, 5, 2, 'MASK'],
      [52, 5, 0, 8, 0, 'IMAGE'],
    ],
    definitions: { subgraphs: [oldDef, newDef] },
  });
}

describe('replaceSubgraphInstance', () => {
  it('keeps the node id, rewires matching slots, and drops the rest with a summary', () => {
    const result = replaceSubgraphInstance(makeWorkflow(), 'root/node:5', 'NEW')!;
    expect(result).not.toBeNull();
    const { workflow: next, dropped } = result;

    const replaced = next.nodes.find((n) => n.id === 5)!;
    expect(replaced.type).toBe('NEW');
    expect(replaced.pos).toEqual([10, 20]); // same node object position preserved
    expect(replaced.title).toBeUndefined();

    // image input carried over onto the matching slot.
    expect(replaced.inputs[0]).toMatchObject({ name: 'image', link: 50 });
    const link50 = next.links.find((l) => l[0] === 50)!;
    expect(link50[3]).toBe(5);
    expect(link50[4]).toBe(0);

    // mask had no match → link 51 removed, source output pruned, drop reported.
    expect(next.links.some((l) => l[0] === 51)).toBe(false);
    const source = next.nodes.find((n) => n.id === 1)!;
    expect(source.outputs[1].links).toBeNull();
    expect(dropped).toEqual([
      { direction: 'input', slotName: 'mask', slotType: 'MASK', peerNodeTitle: 'LoadImage' },
    ]);

    // Output matched by type (renamed slot) → downstream link survives, reslotted.
    const link52 = next.links.find((l) => l[0] === 52)!;
    expect(link52[1]).toBe(5);
    expect(link52[2]).toBe(0);
    expect(replaced.outputs[0]).toMatchObject({ name: 'result', links: [52] });
    expect(next.nodes.find((n) => n.id === 8)!.inputs[0].link).toBe(52);
  });

  it('carries widget values by slot name and assigns the next instance number', () => {
    const result = replaceSubgraphInstance(makeWorkflow(), 'root/node:5', 'NEW')!;
    const replaced = result.workflow.nodes.find((n) => n.id === 5)!;
    // strength (0.7) carried from the old instance, not the template's 0.25.
    expect(replaced.widgets_values).toEqual([0.7]);
    expect(replaced.properties?.mobileInstanceNumber).toBe(2);
    const meta = result.workflow.definitions!.subgraphs!.find((d) => d.id === 'NEW')!
      .extra?.['comfyui-mobile'] as { nextInstanceNumber?: number };
    expect(meta.nextInstanceNumber).toBe(3);
  });

  it('takes the template\'s structural properties but not its private labels', () => {
    const workflow = makeWorkflow();
    const template = workflow.nodes.find((n) => n.id === 9)!;
    template.properties = {
      ...template.properties,
      proxyWidgets: [['100', 'steps']],
      // Instance 9's own naming of its slots, not part of the type.
      mobileSlotLabels: { 'input:image': 'Reference' },
    };

    const replaced = replaceSubgraphInstance(workflow, 'root/node:5', 'NEW')!
      .workflow.nodes.find((n) => n.id === 5)!;

    // proxyWidgets describes the new definition, so it has to come along.
    expect(replaced.properties?.proxyWidgets).toEqual([['100', 'steps']]);
    // The labels are instance 9's private naming; a brand-new instance must
    // not silently inherit someone else's overrides.
    expect(replaced.properties?.mobileSlotLabels).toBeUndefined();
  });

  it('drops the replaced instance\'s own labels, which named the old type', () => {
    const workflow = makeWorkflow();
    const old = workflow.nodes.find((n) => n.id === 5)!;
    old.properties = { ...old.properties, mobileSlotLabels: { 'input:image': 'Old name' } };

    const replaced = replaceSubgraphInstance(workflow, 'root/node:5', 'NEW')!
      .workflow.nodes.find((n) => n.id === 5)!;

    expect(replaced.properties?.mobileSlotLabels).toBeUndefined();
  });

  it('keeps the old definition even with zero instances left', () => {
    // Every definition is a reusable type, and a type with no live instance is
    // still a type — swapping the last one away is not a request to delete it.
    const result = replaceSubgraphInstance(makeWorkflow(), 'root/node:5', 'NEW')!;
    const ids = result.workflow.definitions!.subgraphs!.map((d) => d.id).sort();
    expect(ids).toEqual(['NEW', 'OLD']);
  });

  it('keeps the old definition while another instance still references it', () => {
    const wf = makeWorkflow();
    wf.nodes.push(node({ id: 12, type: 'OLD', itemKey: 'root/node:12' }));
    const result = replaceSubgraphInstance(wf, 'root/node:5', 'NEW')!;
    const ids = result.workflow.definitions!.subgraphs!.map((d) => d.id).sort();
    expect(ids).toEqual(['NEW', 'OLD']);
  });

  it('keeps definitions nested inside the one swapped away', () => {
    const nested: WorkflowSubgraphDefinition = {
      id: 'NESTED',
      nodes: [node({ id: 300, type: 'InnerNested' })],
      links: [],
    };
    const wf = makeWorkflow();
    wf.definitions!.subgraphs = [
      { ...oldDef, nodes: [node({ id: 100, type: 'NESTED' })] },
      newDef,
      nested,
    ];
    const result = replaceSubgraphInstance(wf, 'root/node:5', 'NEW')!;
    const ids = result.workflow.definitions!.subgraphs!.map((d) => d.id).sort();
    expect(ids).toEqual(['NESTED', 'NEW', 'OLD']);
  });

  it('returns null for same-def replacement or unknown target', () => {
    expect(replaceSubgraphInstance(makeWorkflow(), 'root/node:5', 'OLD')).toBeNull();
    expect(replaceSubgraphInstance(makeWorkflow(), 'root/node:5', 'MISSING')).toBeNull();
    expect(replaceSubgraphInstance(makeWorkflow(), 'root/node:99', 'NEW')).toBeNull();
  });

  it('derives the placeholder shape from the definition when no template instance exists', () => {
    const wf = makeWorkflow();
    wf.nodes = wf.nodes.filter((n) => n.id !== 9); // remove the template instance
    const result = replaceSubgraphInstance(wf, 'root/node:5', 'NEW')!;
    const replaced = result.workflow.nodes.find((n) => n.id === 5)!;
    expect(replaced.inputs.map((i) => i.name)).toEqual(['image', 'strength']);
    expect(replaced.inputs[1].widget).toEqual({ name: 'strength' });
    expect(replaced.outputs.map((o) => o.name)).toEqual(['result']);
    expect(replaced.widgets_values).toEqual([0.7]); // still carried by name
  });
});

describe('collectReachableSubgraphIds', () => {
  it('walks root placeholders through nested definitions', () => {
    const wf = makeWorkflow();
    expect([...collectReachableSubgraphIds(wf)].sort()).toEqual(['NEW', 'OLD']);
  });
});
