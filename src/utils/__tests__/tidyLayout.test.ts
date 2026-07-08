import { describe, expect, it } from 'vitest';
import { computeTidyWorkflowGeometry } from '@/utils/tidyLayout';
import { computeNodeGroupsFor } from '@/utils/nodeGroups';
import { createEmptyMobileLayout, type MobileLayout } from '@/utils/mobileLayout';
import type { Workflow, WorkflowGroup, WorkflowNode } from '@/api/types';

function node(id: number, size: [number, number] = [200, 100]): WorkflowNode {
  return {
    id,
    type: `Node${id}`,
    pos: [0, 0],
    size,
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
  };
}

function typedNode(id: number, type: string, size: [number, number] = [200, 100]): WorkflowNode {
  return { ...node(id, size), type };
}

function group(id: number, itemKey: string): WorkflowGroup {
  return { id, itemKey, title: `G${id}`, bounding: [0, 0, 10, 10], color: '#333' };
}

function wf(nodes: WorkflowNode[], groups: WorkflowGroup[] = []): Workflow {
  return { nodes, groups, links: [], definitions: { subgraphs: [] } } as unknown as Workflow;
}

// Node bounding box used for overlap/membership (LiteGraph: title sits above pos.y).
const TITLE = 30;
function nodeBox(n: WorkflowNode): [number, number, number, number] {
  return [n.pos[0], n.pos[1] - TITLE, n.size[0], n.size[1] + TITLE];
}
function overlaps(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

describe('computeTidyWorkflowGeometry', () => {
  it('lays root nodes left-to-right, top-aligned, in layout order, no overlap', () => {
    const nodes = [node(1, [150, 80]), node(2, [200, 120]), node(3, [180, 90])];
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [
        { type: 'node', id: 1 },
        { type: 'node', id: 2 },
        { type: 'node', id: 3 },
      ],
    };
    const out = computeTidyWorkflowGeometry(wf(nodes), layout);
    const [n1, n2, n3] = out.nodes;
    // Left-to-right in order.
    expect(n1.pos[0]).toBeLessThan(n2.pos[0]);
    expect(n2.pos[0]).toBeLessThan(n3.pos[0]);
    // Top edges (title tops) aligned.
    expect(n1.pos[1] - TITLE).toBe(n2.pos[1] - TITLE);
    expect(n2.pos[1] - TITLE).toBe(n3.pos[1] - TITLE);
    // No overlaps.
    expect(overlaps(nodeBox(n1), nodeBox(n2))).toBe(false);
    expect(overlaps(nodeBox(n2), nodeBox(n3))).toBe(false);
  });

  it('stacks group members vertically and the box encloses exactly them (membership round-trips)', () => {
    const nodes = [node(1), node(2), node(3)];
    const g = group(7, 'root/group:7');
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [{ type: 'group', id: 7, subgraphId: null, itemKey: 'root/group:7' }],
      groups: {
        'root/group:7': [
          { type: 'node', id: 1 },
          { type: 'node', id: 2 },
          { type: 'node', id: 3 },
        ],
      },
    };
    const out = computeTidyWorkflowGeometry(wf(nodes, [g]), layout);
    const [n1, n2, n3] = out.nodes;
    // Same column (x), increasing y.
    expect(n1.pos[0]).toBe(n2.pos[0]);
    expect(n1.pos[1]).toBeLessThan(n2.pos[1]);
    expect(n2.pos[1]).toBeLessThan(n3.pos[1]);
    expect(overlaps(nodeBox(n1), nodeBox(n2))).toBe(false);
    // The recomputed group box claims exactly its three members and nothing else.
    const membership = computeNodeGroupsFor(out.nodes, out.groups);
    expect(membership.get(1)).toBe(7);
    expect(membership.get(2)).toBe(7);
    expect(membership.get(3)).toBe(7);
  });

  it('breaks a nested group into its own column; siblings after it get a fresh column', () => {
    // Parent group children: [n1, n2, nestedGroup(8){n3}, n4]
    const nodes = [node(1), node(2), node(3), node(4)];
    const parent = group(7, 'root/group:7');
    const nested = group(8, 'root/group:7/group:8');
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [{ type: 'group', id: 7, subgraphId: null, itemKey: 'root/group:7' }],
      groups: {
        'root/group:7': [
          { type: 'node', id: 1 },
          { type: 'node', id: 2 },
          { type: 'group', id: 8, subgraphId: null, itemKey: 'root/group:7/group:8' },
          { type: 'node', id: 4 },
        ],
        'root/group:7/group:8': [{ type: 'node', id: 3 }],
      },
    };
    const out = computeTidyWorkflowGeometry(wf(nodes, [parent, nested]), layout);
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    const n1 = byId.get(1)!;
    const n2 = byId.get(2)!;
    const n3 = byId.get(3)!;
    const n4 = byId.get(4)!;
    // Column 1: n1, n2 (stacked, same x).
    expect(n1.pos[0]).toBe(n2.pos[0]);
    // Nested group's node (n3) is in a column to the RIGHT of column 1.
    expect(n3.pos[0]).toBeGreaterThan(n1.pos[0]);
    // n4 (after the nested group) is in a fresh column to the right of n3's column.
    expect(n4.pos[0]).toBeGreaterThan(n3.pos[0]);
    // Membership: n1/n2/n4 in parent (7), n3 in nested (8).
    const membership = computeNodeGroupsFor(out.nodes, out.groups);
    expect(membership.get(1)).toBe(7);
    expect(membership.get(2)).toBe(7);
    expect(membership.get(4)).toBe(7);
    expect(membership.get(3)).toBe(8);
  });

  it('does not capture an unrelated root node into a root group', () => {
    const nodes = [node(1), node(2), node(99)];
    const g = group(7, 'root/group:7');
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [
        { type: 'group', id: 7, subgraphId: null, itemKey: 'root/group:7' },
        { type: 'node', id: 99 },
      ],
      groups: {
        'root/group:7': [
          { type: 'node', id: 1 },
          { type: 'node', id: 2 },
        ],
      },
    };
    const out = computeTidyWorkflowGeometry(wf(nodes, [g]), layout);
    const membership = computeNodeGroupsFor(out.nodes, out.groups);
    expect(membership.get(1)).toBe(7);
    expect(membership.get(2)).toBe(7);
    expect(membership.get(99) ?? null).toBeNull();
  });

  it('breaks a preview/save/compare node into its own column inside a group', () => {
    // Group children: [regular A, preview P, regular B]. P must not stack under A.
    const nodes = [node(1), typedNode(2, 'PreviewImage'), node(3)];
    const g = group(7, 'root/group:7');
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [{ type: 'group', id: 7, subgraphId: null, itemKey: 'root/group:7' }],
      groups: {
        'root/group:7': [
          { type: 'node', id: 1 },
          { type: 'node', id: 2 },
          { type: 'node', id: 3 },
        ],
      },
    };
    const out = computeTidyWorkflowGeometry(wf(nodes, [g]), layout);
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    const a = byId.get(1)!;
    const p = byId.get(2)!;
    const b = byId.get(3)!;
    // Preview is in its own column to the right of A, and B is past the preview.
    expect(p.pos[0]).toBeGreaterThan(a.pos[0]);
    expect(b.pos[0]).toBeGreaterThan(p.pos[0]);
    // Never stacked under another node (no shared column with A or B).
    expect(p.pos[0]).not.toBe(a.pos[0]);
    expect(p.pos[0]).not.toBe(b.pos[0]);
  });

  it('normalizes every preview/save/compare node to the largest such size', () => {
    const nodes = [
      typedNode(1, 'PreviewImage', [150, 100]),
      typedNode(2, 'SaveImage', [300, 220]),
      typedNode(3, 'KSampler', [200, 400]),
    ];
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [
        { type: 'node', id: 1 },
        { type: 'node', id: 2 },
        { type: 'node', id: 3 },
      ],
    };
    const out = computeTidyWorkflowGeometry(wf(nodes), layout);
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    // Both preview/save nodes take the max preview size [300, 220].
    expect(byId.get(1)!.size).toEqual([300, 220]);
    expect(byId.get(2)!.size).toEqual([300, 220]);
    // Non-display node keeps its own size.
    expect(byId.get(3)!.size).toEqual([200, 400]);
  });

  it('uses no left/right padding inside groups (box hugs the node column)', () => {
    const nodes = [node(1, [200, 100])];
    const g = group(7, 'root/group:7');
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [{ type: 'group', id: 7, subgraphId: null, itemKey: 'root/group:7' }],
      groups: { 'root/group:7': [{ type: 'node', id: 1 }] },
    };
    const out = computeTidyWorkflowGeometry(wf(nodes, [g]), layout);
    const box = out.groups[0].bounding;
    const n1 = out.nodes[0];
    // Group left edge equals the node's left edge (zero horizontal padding), and
    // the box width equals the node width.
    expect(box[0]).toBe(n1.pos[0]);
    expect(box[2]).toBe(n1.size[0]);
  });

  it('does not inflate non-empty groups to the empty-group minimum size', () => {
    const nodes = [node(1, [80, 20])];
    const g = group(7, 'root/group:7');
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [{ type: 'group', id: 7, subgraphId: null, itemKey: 'root/group:7' }],
      groups: { 'root/group:7': [{ type: 'node', id: 1 }] },
    };
    const out = computeTidyWorkflowGeometry(wf(nodes, [g]), layout);
    const box = out.groups[0].bounding;

    expect(box[2]).toBe(80);
    expect(box[3]).toBe(40 + TITLE + 20 + 16);
  });

  it('folds widgetless nodes and collects them into one column at first occurrence', () => {
    const def = (input: Record<string, unknown>) => ({
      input: { required: input },
      output: [],
      name: '',
      display_name: '',
      description: '',
      python_module: '',
      category: '',
    });
    const nodeTypes = {
      Widgeted: def({ steps: ['INT', { default: 20 }] }),
      Plain: def({}),
    } as unknown as import('@/api/types').NodeTypes;

    // Group children order: [Widgeted A, Plain X, Widgeted B, Plain Y].
    const nodes = [
      typedNode(1, 'Widgeted'),
      typedNode(2, 'Plain'),
      typedNode(3, 'Widgeted'),
      typedNode(4, 'Plain'),
    ];
    const g = group(7, 'root/group:7');
    const layout: MobileLayout = {
      ...createEmptyMobileLayout(),
      root: [{ type: 'group', id: 7, subgraphId: null, itemKey: 'root/group:7' }],
      groups: {
        'root/group:7': [
          { type: 'node', id: 1 },
          { type: 'node', id: 2 },
          { type: 'node', id: 3 },
          { type: 'node', id: 4 },
        ],
      },
    };
    const out = computeTidyWorkflowGeometry(wf(nodes, [g]), layout, nodeTypes);
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    // Both plain (widgetless) nodes share one column (same x) and are folded.
    expect(byId.get(2)!.pos[0]).toBe(byId.get(4)!.pos[0]);
    expect(byId.get(2)!.flags.collapsed).toBe(true);
    expect(byId.get(4)!.flags.collapsed).toBe(true);
    // The widgeted nodes are not folded.
    expect(byId.get(1)!.flags.collapsed ?? false).toBe(false);
    expect(byId.get(3)!.flags.collapsed ?? false).toBe(false);
  });
});
