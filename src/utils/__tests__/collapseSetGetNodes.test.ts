import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import {
  collapseSetGetNodes,
  workflowHasSetGetNodes,
} from '../collapseSetGetNodes';

interface NodeOpts {
  type?: string;
  widgets_values?: unknown[];
  inputs?: WorkflowNode['inputs'];
  outputs?: WorkflowNode['outputs'];
}

function node(id: number, opts: NodeOpts = {}): WorkflowNode {
  return {
    id,
    type: opts.type ?? 'KSampler',
    pos: [0, 0],
    size: [100, 60],
    flags: {},
    order: id,
    mode: 0,
    inputs: opts.inputs ?? [],
    outputs: opts.outputs ?? [],
    properties: {},
    ...(opts.widgets_values ? { widgets_values: opts.widgets_values } : {}),
  } as unknown as WorkflowNode;
}

function wf(nodes: WorkflowNode[], links: WorkflowLink[], subgraphs: unknown[] = []): Workflow {
  return {
    nodes,
    links,
    groups: [],
    definitions: { subgraphs },
  } as unknown as Workflow;
}

// A (real) -> SetNode("x") ~ GetNode("x") -> D (real)
function chainWorkflow(): Workflow {
  const a = node(1, { type: 'Loader', outputs: [{ name: 'LATENT', type: 'LATENT', links: [10] }] });
  const set = node(2, {
    type: 'SetNode',
    widgets_values: ['x'],
    inputs: [{ name: '*', type: 'LATENT', link: 10 }],
    outputs: [{ name: '*', type: 'LATENT', links: null }],
  });
  const get = node(3, {
    type: 'GetNode',
    widgets_values: ['x'],
    inputs: [],
    outputs: [{ name: '*', type: 'LATENT', links: [11] }],
  });
  const d = node(4, { type: 'VAEDecode', inputs: [{ name: 'samples', type: 'LATENT', link: 11 }] });
  return wf(
    [a, set, get, d],
    [
      [10, 1, 0, 2, 0, 'LATENT'],
      [11, 3, 0, 4, 0, 'LATENT'],
    ],
  );
}

describe('workflowHasSetGetNodes', () => {
  it('is false for a workflow with no relays', () => {
    expect(workflowHasSetGetNodes(wf([node(1), node(2)], []))).toBe(false);
  });

  it('detects a root-level relay', () => {
    expect(workflowHasSetGetNodes(chainWorkflow())).toBe(true);
  });

  it('detects a relay inside a subgraph', () => {
    const w = wf([node(1)], [], [
      { id: 'sg', nodes: [node(5, { type: 'GetNode', widgets_values: ['y'] })], links: [], groups: [] },
    ]);
    expect(workflowHasSetGetNodes(w)).toBe(true);
  });

  it('is false for null', () => {
    expect(workflowHasSetGetNodes(null)).toBe(false);
  });
});

describe('collapseSetGetNodes', () => {
  it('rewires A -> Set ~ Get -> D into a direct A -> D link', () => {
    const { workflow, removed } = collapseSetGetNodes(chainWorkflow());

    expect(removed).toEqual([
      { nodeId: 2, subgraphId: null },
      { nodeId: 3, subgraphId: null },
    ]);
    expect(workflow.nodes.map((n) => n.id).sort()).toEqual([1, 4]);

    // One direct link A(1).0 -> D(4).0, reusing the consumer link id.
    expect(workflow.links).toHaveLength(1);
    expect(workflow.links[0]).toEqual([11, 1, 0, 4, 0, 'LATENT']);

    const a = workflow.nodes.find((n) => n.id === 1)!;
    const d = workflow.nodes.find((n) => n.id === 4)!;
    expect(a.outputs[0].links).toEqual([11]);
    expect(d.inputs[0].link).toBe(11);
  });

  it('fans one Set out to multiple Gets', () => {
    const a = node(1, { type: 'Loader', outputs: [{ name: 'L', type: 'L', links: [10] }] });
    const set = node(2, {
      type: 'SetNode',
      widgets_values: ['x'],
      inputs: [{ name: '*', type: 'L', link: 10 }],
      outputs: [{ name: '*', type: 'L', links: null }],
    });
    const get1 = node(3, { type: 'GetNode', widgets_values: ['x'], outputs: [{ name: '*', type: 'L', links: [11] }] });
    const get2 = node(4, { type: 'GetNode', widgets_values: ['x'], outputs: [{ name: '*', type: 'L', links: [12] }] });
    const d1 = node(5, { type: 'Sink', inputs: [{ name: 'in', type: 'L', link: 11 }] });
    const d2 = node(6, { type: 'Sink', inputs: [{ name: 'in', type: 'L', link: 12 }] });
    const { workflow } = collapseSetGetNodes(
      wf([a, set, get1, get2, d1, d2], [
        [10, 1, 0, 2, 0, 'L'],
        [11, 3, 0, 5, 0, 'L'],
        [12, 4, 0, 6, 0, 'L'],
      ]),
    );

    expect(workflow.nodes.map((n) => n.id).sort()).toEqual([1, 5, 6]);
    expect(workflow.links).toHaveLength(2);
    // Both consumers now read directly from A.
    expect(workflow.links.every((l) => l[1] === 1 && l[2] === 0)).toBe(true);
    expect(workflow.nodes.find((n) => n.id === 1)!.outputs[0].links!.sort()).toEqual([11, 12]);
    expect(workflow.nodes.find((n) => n.id === 5)!.inputs[0].link).toBe(11);
    expect(workflow.nodes.find((n) => n.id === 6)!.inputs[0].link).toBe(12);
  });

  it('follows a chained relay (Get -> Set -> Get)', () => {
    const a = node(1, { type: 'Loader', outputs: [{ name: 'L', type: 'L', links: [10] }] });
    const setA = node(2, { type: 'SetNode', widgets_values: ['a'], inputs: [{ name: '*', type: 'L', link: 10 }], outputs: [{ name: '*', type: 'L', links: null }] });
    const getA = node(3, { type: 'GetNode', widgets_values: ['a'], outputs: [{ name: '*', type: 'L', links: [11] }] });
    const setB = node(4, { type: 'SetNode', widgets_values: ['b'], inputs: [{ name: '*', type: 'L', link: 11 }], outputs: [{ name: '*', type: 'L', links: null }] });
    const getB = node(5, { type: 'GetNode', widgets_values: ['b'], outputs: [{ name: '*', type: 'L', links: [12] }] });
    const d = node(6, { type: 'Sink', inputs: [{ name: 'in', type: 'L', link: 12 }] });
    const { workflow } = collapseSetGetNodes(
      wf([a, setA, getA, setB, getB, d], [
        [10, 1, 0, 2, 0, 'L'],
        [11, 3, 0, 4, 0, 'L'],
        [12, 5, 0, 6, 0, 'L'],
      ]),
    );
    expect(workflow.nodes.map((n) => n.id).sort()).toEqual([1, 6]);
    expect(workflow.links).toHaveLength(1);
    expect(workflow.links[0]).toEqual([12, 1, 0, 6, 0, 'L']);
  });

  it('drops the consumer link for an orphan Get (no matching Set)', () => {
    const get = node(1, { type: 'GetNode', widgets_values: ['missing'], outputs: [{ name: '*', type: 'L', links: [11] }] });
    const d = node(2, { type: 'Sink', inputs: [{ name: 'in', type: 'L', link: 11 }] });
    const { workflow } = collapseSetGetNodes(wf([get, d], [[11, 1, 0, 2, 0, 'L']]));
    expect(workflow.nodes.map((n) => n.id)).toEqual([2]);
    expect(workflow.links).toHaveLength(0);
    expect(workflow.nodes[0].inputs[0].link).toBeNull();
  });

  it('preserves links that do not touch a relay', () => {
    const a = node(1, { type: 'Loader', outputs: [{ name: 'L', type: 'L', links: [10] }] });
    const b = node(2, { type: 'Sink', inputs: [{ name: 'in', type: 'L', link: 10 }] });
    const input = wf([a, b], [[10, 1, 0, 2, 0, 'L']]);
    const { workflow, removed } = collapseSetGetNodes(input);
    expect(removed).toEqual([]);
    // No relays anywhere — the workflow is returned untouched.
    expect(workflow).toBe(input);
    expect(workflow.links).toEqual([[10, 1, 0, 2, 0, 'L']]);
  });

  it('collapses relays inside a subgraph (object link form)', () => {
    const inner = {
      id: 'sg',
      nodes: [
        node(1, { type: 'Loader', outputs: [{ name: 'L', type: 'L', links: [10] }] }),
        node(2, { type: 'SetNode', widgets_values: ['x'], inputs: [{ name: '*', type: 'L', link: 10 }], outputs: [{ name: '*', type: 'L', links: null }] }),
        node(3, { type: 'GetNode', widgets_values: ['x'], outputs: [{ name: '*', type: 'L', links: [11] }] }),
        node(4, { type: 'Sink', inputs: [{ name: 'in', type: 'L', link: 11 }] }),
      ],
      links: [
        { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'L' },
        { id: 11, origin_id: 3, origin_slot: 0, target_id: 4, target_slot: 0, type: 'L' },
      ],
      groups: [],
    };
    const { workflow, removed } = collapseSetGetNodes(wf([node(99)], [], [inner]));
    expect(removed).toEqual([
      { nodeId: 2, subgraphId: 'sg' },
      { nodeId: 3, subgraphId: 'sg' },
    ]);
    const sg = workflow.definitions!.subgraphs![0] as unknown as typeof inner;
    expect(sg.nodes.map((n) => n.id).sort()).toEqual([1, 4]);
    expect(sg.links).toHaveLength(1);
    expect(sg.links[0]).toEqual({ id: 11, origin_id: 1, origin_slot: 0, target_id: 4, target_slot: 0, type: 'L' });
  });

  it('wires a relay fed by a subgraph boundary sentinel to the boundary', () => {
    // Inside a subgraph, a Set is fed by the input boundary (id -10, not a real
    // node in scope). Collapsing must wire the consumer to the boundary, not drop
    // the connection.
    const inner = {
      id: 'sg',
      nodes: [
        node(2, { type: 'SetNode', widgets_values: ['x'], inputs: [{ name: '*', type: 'L', link: 10 }], outputs: [{ name: '*', type: 'L', links: null }] }),
        node(3, { type: 'GetNode', widgets_values: ['x'], outputs: [{ name: '*', type: 'L', links: [11] }] }),
        node(4, { type: 'Sink', inputs: [{ name: 'in', type: 'L', link: 11 }] }),
      ],
      links: [
        { id: 10, origin_id: -10, origin_slot: 0, target_id: 2, target_slot: 0, type: 'L' },
        { id: 11, origin_id: 3, origin_slot: 0, target_id: 4, target_slot: 0, type: 'L' },
      ],
      groups: [],
    };
    const { workflow } = collapseSetGetNodes(wf([node(99)], [], [inner]));
    const sg = workflow.definitions!.subgraphs![0] as unknown as typeof inner;
    expect(sg.nodes.map((n) => n.id)).toEqual([4]);
    expect(sg.links).toHaveLength(1);
    expect(sg.links[0]).toEqual({ id: 11, origin_id: -10, origin_slot: 0, target_id: 4, target_slot: 0, type: 'L' });
    expect(sg.nodes.find((n) => n.id === 4)!.inputs[0].link).toBe(11);
  });

  it('returns the same workflow reference when there is nothing to collapse', () => {
    const w = wf([node(1), node(2)], []);
    const { workflow, removed } = collapseSetGetNodes(w);
    expect(workflow).toBe(w);
    expect(removed).toEqual([]);
  });

  it('survives slotless nodes (Note) with no inputs/outputs arrays at all', () => {
    // Subgraph inner nodes never pass through load-time normalization, so a
    // Note/MarkdownNote there can genuinely lack inputs/outputs — the rebuild
    // pass used to crash on n.inputs.map.
    const bareNote = {
      id: 5,
      type: 'Note',
      pos: [0, 0],
      size: [100, 60],
      flags: {},
      order: 5,
      mode: 0,
      properties: {},
      widgets_values: ['a note'],
    } as unknown as WorkflowNode;
    const inner = {
      id: 'sg',
      nodes: [
        node(1, { type: 'Loader', outputs: [{ name: 'L', type: 'L', links: [10] }] }),
        node(2, { type: 'SetNode', widgets_values: ['x'], inputs: [{ name: '*', type: 'L', link: 10 }], outputs: [{ name: '*', type: 'L', links: null }] }),
        node(3, { type: 'GetNode', widgets_values: ['x'], outputs: [{ name: '*', type: 'L', links: [11] }] }),
        node(4, { type: 'Sink', inputs: [{ name: 'in', type: 'L', link: 11 }] }),
        bareNote,
      ],
      links: [
        { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'L' },
        { id: 11, origin_id: 3, origin_slot: 0, target_id: 4, target_slot: 0, type: 'L' },
      ],
      groups: [],
    };
    const { workflow, removed } = collapseSetGetNodes(wf([node(99)], [], [inner]));
    expect(removed).toHaveLength(2);
    const sg = workflow.definitions!.subgraphs![0] as unknown as typeof inner;
    expect(sg.nodes.map((n) => n.id).sort()).toEqual([1, 4, 5]);
  });
});
