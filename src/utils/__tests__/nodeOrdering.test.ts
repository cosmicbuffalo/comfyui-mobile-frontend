import { describe, it, expect } from 'vitest';
import { orderNodesForMobile, findConnectedNode, findConnectedOutputNodes } from '../nodeOrdering';
import { computeTidyWorkflowGeometry } from '../tidyLayout';
import type { MobileLayout } from '../mobileLayout';
import type { Workflow, WorkflowNode, WorkflowLink } from '@/api/types';

function makeNode(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type,
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
  };
}

describe('orderNodesForMobile', () => {
  it('returns empty array for empty workflow', () => {
    const wf = makeWorkflow([], []);
    expect(orderNodesForMobile(wf)).toEqual([]);
  });

  it('returns single node', () => {
    const node = makeNode(1, 'KSampler');
    const wf = makeWorkflow([node], []);
    const result = orderNodesForMobile(wf);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('orders dependencies before dependents in a linear chain', () => {
    // A -> B -> C (SaveImage)
    const a = makeNode(1, 'CheckpointLoaderSimple', {
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
    });
    const b = makeNode(2, 'KSampler', {
      inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [2] }],
    });
    const c = makeNode(3, 'SaveImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: 2 }],
      outputs: [],
    });

    const links: WorkflowLink[] = [
      [1, 1, 0, 2, 0, 'MODEL'],
      [2, 2, 0, 3, 0, 'LATENT'],
    ];

    const wf = makeWorkflow([c, a, b], links); // shuffled input order
    const result = orderNodesForMobile(wf);

    const ids = result.map((n) => n.id);
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(2));
    expect(ids.indexOf(2)).toBeLessThan(ids.indexOf(3));
  });

  it('includes disconnected nodes', () => {
    const a = makeNode(1, 'SaveImage', { outputs: [] });
    const disconnected = makeNode(2, 'Note', { outputs: [] });
    const wf = makeWorkflow([a, disconnected], []);

    const result = orderNodesForMobile(wf);
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toContain(2);
  });

  it('identifies output nodes by type name', () => {
    const loader = makeNode(1, 'CheckpointLoaderSimple', {
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
    });
    const save = makeNode(2, 'PreviewImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
      outputs: [],
    });

    const links: WorkflowLink[] = [[1, 1, 0, 2, 0, 'MODEL']];
    const wf = makeWorkflow([save, loader], links);
    const result = orderNodesForMobile(wf);

    expect(result[0].id).toBe(1); // loader first
    expect(result[1].id).toBe(2); // save last
  });

  it('handles diamond dependency graphs', () => {
    //   A
    //  / \
    // B   C
    //  \ /
    //   D (SaveImage)
    const a = makeNode(1, 'Loader', {
      outputs: [
        { name: 'out1', type: 'X', links: [1] },
        { name: 'out2', type: 'Y', links: [2] },
      ],
    });
    const b = makeNode(2, 'ProcessB', {
      inputs: [{ name: 'in', type: 'X', link: 1 }],
      outputs: [{ name: 'out', type: 'Z', links: [3] }],
    });
    const c = makeNode(3, 'ProcessC', {
      inputs: [{ name: 'in', type: 'Y', link: 2 }],
      outputs: [{ name: 'out', type: 'Z', links: [4] }],
    });
    const d = makeNode(4, 'SaveImage', {
      inputs: [
        { name: 'in1', type: 'Z', link: 3 },
        { name: 'in2', type: 'Z', link: 4 },
      ],
      outputs: [],
    });

    const links: WorkflowLink[] = [
      [1, 1, 0, 2, 0, 'X'],
      [2, 1, 1, 3, 0, 'Y'],
      [3, 2, 0, 4, 0, 'Z'],
      [4, 3, 0, 4, 1, 'Z'],
    ];

    const wf = makeWorkflow([d, c, b, a], links);
    const result = orderNodesForMobile(wf);
    const ids = result.map((n) => n.id);

    // A must come before B, C, and D
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(2));
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(3));
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(4));
    // B and C must come before D
    expect(ids.indexOf(2)).toBeLessThan(ids.indexOf(4));
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(4));
  });

  it('falls back to nodes with no dependents when no output types found', () => {
    const a = makeNode(1, 'CustomNodeA', {
      outputs: [{ name: 'out', type: 'X', links: [1] }],
    });
    const b = makeNode(2, 'CustomNodeB', {
      inputs: [{ name: 'in', type: 'X', link: 1 }],
      outputs: [{ name: 'out', type: 'Y', links: null }],
    });

    const links: WorkflowLink[] = [[1, 1, 0, 2, 0, 'X']];
    const wf = makeWorkflow([b, a], links);
    const result = orderNodesForMobile(wf);

    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
  });

  it('orders by canvas position (left -> right) over dependency order', () => {
    // C feeds B feeds A (so topological order is C, B, A), but they are placed
    // left -> right as A, B, C. The list must follow geometry: A, B, C.
    const a = makeNode(1, 'Sink', { pos: [0, 0], inputs: [{ name: 'in', type: 'X', link: 1 }] });
    const b = makeNode(2, 'Mid', { pos: [300, 0], inputs: [{ name: 'in', type: 'X', link: 2 }], outputs: [{ name: 'o', type: 'X', links: [1] }] });
    const c = makeNode(3, 'Src', { pos: [600, 0], outputs: [{ name: 'o', type: 'X', links: [2] }] });
    const wf = makeWorkflow([a, b, c], [[1, 2, 0, 1, 0, 'X'], [2, 3, 0, 2, 0, 'X']]);
    expect(orderNodesForMobile(wf).map((n) => n.id)).toEqual([1, 2, 3]);
  });

  it('breaks an x tie by y (top -> bottom)', () => {
    const top = makeNode(1, 'A', { pos: [100, 0] });
    const mid = makeNode(2, 'B', { pos: [100, 200] });
    const bot = makeNode(3, 'C', { pos: [100, 400] });
    const wf = makeWorkflow([bot, top, mid], []);
    expect(orderNodesForMobile(wf).map((n) => n.id)).toEqual([1, 2, 3]);
  });

  it('falls back to topological order when positions coincide', () => {
    // All at the origin (a brand-new workflow) -> dependency reading order.
    const loader = makeNode(1, 'CheckpointLoaderSimple', { pos: [0, 0], outputs: [{ name: 'M', type: 'M', links: [1] }] });
    const save = makeNode(2, 'SaveImage', { pos: [0, 0], inputs: [{ name: 'm', type: 'M', link: 1 }] });
    const wf = makeWorkflow([save, loader], [[1, 1, 0, 2, 0, 'M']]);
    expect(orderNodesForMobile(wf).map((n) => n.id)).toEqual([1, 2]);
  });

  it('round-trips a reposition: tidy writes geometry, ordering reads it back', () => {
    // Three nodes; the user has arranged the mobile list as [3, 1, 2]. The tidy
    // engine writes that order into node positions; reloading must reconstruct
    // the same [3, 1, 2] order from those positions (the bug being fixed).
    const n1 = makeNode(1, 'A', { pos: [10, 10] });
    const n2 = makeNode(2, 'B', { pos: [20, 20] });
    const n3 = makeNode(3, 'C', { pos: [30, 30] });
    const wf = makeWorkflow([n1, n2, n3], []);
    const layout: MobileLayout = {
      root: [
        { type: 'node', id: 3 },
        { type: 'node', id: 1 },
        { type: 'node', id: 2 },
      ],
      groups: {},
      subgraphs: {},
      hiddenBlocks: {},
    };
    const tidied = computeTidyWorkflowGeometry(wf, layout, null);
    expect(orderNodesForMobile(tidied).map((n) => n.id)).toEqual([3, 1, 2]);
  });
});

describe('findConnectedNode', () => {
  it('returns the source node and output index for a connected input', () => {
    const source = makeNode(1, 'Loader', {
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [10] }],
    });
    const target = makeNode(2, 'KSampler', {
      inputs: [{ name: 'model', type: 'MODEL', link: 10 }],
    });

    const links: WorkflowLink[] = [[10, 1, 0, 2, 0, 'MODEL']];
    const wf = makeWorkflow([source, target], links);

    const result = findConnectedNode(wf, 2, 0);
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe(1);
    expect(result!.outputIndex).toBe(0);
  });

  it('returns null for unconnected input', () => {
    const node = makeNode(1, 'KSampler', {
      inputs: [{ name: 'model', type: 'MODEL', link: null }],
    });
    const wf = makeWorkflow([node], []);

    expect(findConnectedNode(wf, 1, 0)).toBeNull();
  });

  it('returns null for non-existent node', () => {
    const wf = makeWorkflow([], []);
    expect(findConnectedNode(wf, 999, 0)).toBeNull();
  });

  it('returns null for out-of-bounds input index', () => {
    const node = makeNode(1, 'KSampler', { inputs: [] });
    const wf = makeWorkflow([node], []);
    expect(findConnectedNode(wf, 1, 5)).toBeNull();
  });
});

describe('findConnectedOutputNodes', () => {
  it('returns all target nodes connected to an output slot', () => {
    const source = makeNode(1, 'Loader', {
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [10, 11] }],
    });
    const targetA = makeNode(2, 'KSampler', {
      inputs: [{ name: 'model', type: 'MODEL', link: 10 }],
    });
    const targetB = makeNode(3, 'KSampler', {
      inputs: [{ name: 'model', type: 'MODEL', link: 11 }],
    });

    const links: WorkflowLink[] = [
      [10, 1, 0, 2, 0, 'MODEL'],
      [11, 1, 0, 3, 0, 'MODEL'],
    ];
    const wf = makeWorkflow([source, targetA, targetB], links);

    const result = findConnectedOutputNodes(wf, 1, 0);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.node.id).sort()).toEqual([2, 3]);
  });

  it('returns empty array for unconnected output', () => {
    const node = makeNode(1, 'Loader', {
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [] }],
    });
    const wf = makeWorkflow([node], []);
    expect(findConnectedOutputNodes(wf, 1, 0)).toEqual([]);
  });

  it('returns empty array for null links', () => {
    const node = makeNode(1, 'Loader', {
      outputs: [{ name: 'MODEL', type: 'MODEL', links: null }],
    });
    const wf = makeWorkflow([node], []);
    expect(findConnectedOutputNodes(wf, 1, 0)).toEqual([]);
  });

  it('returns empty array for non-existent node', () => {
    const wf = makeWorkflow([], []);
    expect(findConnectedOutputNodes(wf, 999, 0)).toEqual([]);
  });
});
