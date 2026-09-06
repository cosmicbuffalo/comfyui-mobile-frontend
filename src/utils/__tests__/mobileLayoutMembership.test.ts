import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import {
  buildDefaultLayout,
  extractLayoutNodeMembership,
  extractLayoutSubgraphNodeMembership,
  collectScopedMembership,
  makeLocationPointer,
} from '@/utils/mobileLayout';

const scopedKey = (nodeId: number) => `root:${nodeId}`;

function node(id: number): WorkflowNode {
  return {
    id,
    type: 'TestNode',
    pos: [0, 0],
    size: [100, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
  };
}

describe('mobileLayout membership extraction', () => {
  it('extracts root-scope grouped membership including hidden blocks and nested groups', () => {
    const rootGroupKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const nestedGroupKey = makeLocationPointer({ type: 'group', groupId: 11, subgraphId: null });
    const layout: MobileLayout = {
      root: [
        { type: 'group', id: 10, subgraphId: null, itemKey: rootGroupKey },
        { type: 'node', id: 99 }
      ],
      groups: {
        [rootGroupKey]: [
          { type: 'node', id: 1 },
          { type: 'hiddenBlock', blockId: 'hb-root' },
          { type: 'group', id: 11, subgraphId: null, itemKey: nestedGroupKey }
        ],
        [nestedGroupKey]: [{ type: 'node', id: 3 }]
      },
      groupParents: {
        [rootGroupKey]: { scope: 'root' },
        [nestedGroupKey]: { scope: 'group', groupKey: rootGroupKey }
      },
      subgraphs: {},
      hiddenBlocks: {
        'hb-root': [2]
      }
    };

    const membership = extractLayoutNodeMembership(layout);
    expect(membership.get(1)).toBe(rootGroupKey);
    expect(membership.get(2)).toBe(rootGroupKey);
    expect(membership.get(3)).toBe(nestedGroupKey);
    expect(membership.has(99)).toBe(false);
  });

  it('extracts subgraph-scope grouped membership and excludes subgraph root nodes', () => {
    const subgraphGroupKey = makeLocationPointer({ type: 'group', groupId: 20, subgraphId: 'sg-a' });
    const layout: MobileLayout = {
      root: [{ type: 'subgraph', id: 'sg-a' }],
      groups: {
        [subgraphGroupKey]: [
          { type: 'node', id: 4 },
          { type: 'hiddenBlock', blockId: 'hb-sg-a' }
        ]
      },
      groupParents: {
        [subgraphGroupKey]: { scope: 'subgraph', subgraphId: 'sg-a' }
      },
      subgraphs: {
        'sg-a': [
          { type: 'group', id: 20, subgraphId: 'sg-a', itemKey: subgraphGroupKey },
          { type: 'node', id: 6 }
        ]
      },
      hiddenBlocks: {
        'hb-sg-a': [5]
      }
    };

    const membership = extractLayoutSubgraphNodeMembership(layout);
    expect(membership.get(4)).toBe(subgraphGroupKey);
    expect(membership.get(5)).toBe(subgraphGroupKey);
    expect(membership.has(6)).toBe(false);
  });

  it('orders same-position subgraph nodes deterministically by stable source order', () => {
    const workflow: Workflow = {
      last_node_id: 0,
      last_link_id: 0,
      nodes: [],
      links: [],
      groups: [],
      config: {},
      version: 0.4,
      definitions: {
        subgraphs: [
          {
            id: 'sg-a',
            nodes: [node(9), node(3), node(6)],
            groups: [],
            links: [],
          },
        ],
      },
    };

    const layout = buildDefaultLayout([], workflow, {});

    // v3.1.0 orders subgraph nodes by on-canvas position and, for nodes sharing
    // a position, a stable sort preserves their source order (so an in-subgraph
    // reposition survives a save/reload round-trip). Here all share [0,0], so the
    // result is the source order the nodes were declared in.
    expect(layout.subgraphs['sg-a']).toEqual([
      { type: 'node', id: 9 },
      { type: 'node', id: 3 },
      { type: 'node', id: 6 },
    ]);
  });
});

describe('placeholders nested inside a definition', () => {
  /** OUTER holds a placeholder for INNER, one of them inside a group. */
  function nestedWorkflow(): Workflow {
    const placeholder = (id: number, type: string, pos: [number, number] = [0, 0]) => ({
      ...node(id),
      type,
      pos,
    });
    return {
      last_node_id: 40,
      last_link_id: 0,
      nodes: [placeholder(1, 'OUTER')],
      links: [],
      groups: [],
      config: {},
      definitions: {
        subgraphs: [
          {
            id: 'OUTER',
            name: 'Outer',
            inputs: [],
            outputs: [],
            nodes: [
              placeholder(20, 'INNER', [10, 10]),
              placeholder(21, 'INNER', [500, 500]),
              node(22),
            ],
            links: [],
            groups: [{ id: 5, title: 'Inner group', bounding: [400, 400, 300, 300] }],
          },
          { id: 'INNER', name: 'Inner', inputs: [], outputs: [], nodes: [], links: [] },
        ],
      },
    } as unknown as Workflow;
  }

  it('emits them as subgraph items, the way the root scope does', () => {
    // A plain node item leaves the card with no way in: the enter action is
    // wired only where the layout says the item IS a subgraph.
    const workflow = nestedWorkflow();
    const layout = buildDefaultLayout(workflow.nodes, workflow, {});

    const items = layout.subgraphs['OUTER'];
    const nested = items.find(
      (item) => item.type === 'subgraph' && item.nodeId === 20,
    );
    expect(nested).toEqual({ type: 'subgraph', id: 'INNER', nodeId: 20 });
    // The plain node beside it is untouched.
    expect(items.some((item) => item.type === 'node' && item.id === 22)).toBe(true);
  });

  it('emits them inside a group too', () => {
    const workflow = nestedWorkflow();
    const layout = buildDefaultLayout(workflow.nodes, workflow, {});

    const grouped = Object.values(layout.groups)
      .flat()
      .find((item) => item.type === 'subgraph' && item.nodeId === 21);
    expect(grouped).toEqual({ type: 'subgraph', id: 'INNER', nodeId: 21 });
  });

  it('keeps the two instances apart, rather than collapsing them by definition', () => {
    const workflow = nestedWorkflow();
    const layout = buildDefaultLayout(workflow.nodes, workflow, {});

    const all = [...layout.subgraphs['OUTER'], ...Object.values(layout.groups).flat()]
      .filter((item) => item.type === 'subgraph' && item.id === 'INNER');
    expect(all.map((item) => (item as { nodeId?: number }).nodeId).sort()).toEqual([20, 21]);
  });
});

describe('where a subgraph placeholder itself lives', () => {
  const OUTER = 'sg-outer';
  const groupKey = makeLocationPointer({ type: 'group', groupId: 7, subgraphId: null });

  /** A group holding two instances of one type, each holding a plain node. */
  function layoutWithPlaceholders(): MobileLayout {
    return {
      root: [{ type: 'group', id: 7, subgraphId: null, itemKey: groupKey }],
      groups: {
        [groupKey]: [
          { type: 'subgraph', id: OUTER, nodeId: 10 },
          { type: 'subgraph', id: OUTER, nodeId: 11 },
        ],
      },
      groupParents: { [groupKey]: { scope: 'root' } },
      subgraphs: { [OUTER]: [{ type: 'node', id: 20 }] },
      hiddenBlocks: {},
    } as unknown as MobileLayout;
  }

  it('places the placeholder in the group holding it', () => {
    // Without this the placeholder belongs to nothing, so a jump asking which
    // group to unfold is told none — and a folded group never opens.
    const scoped = collectScopedMembership(layoutWithPlaceholders());
    expect(scoped.get(scopedKey(10))).toMatchObject({ scope: 'root', groupKey });
  });

  it('places every instance, not just the one whose contents were walked', () => {
    const scoped = collectScopedMembership(layoutWithPlaceholders());
    // The cycle guard stops the second descent; the second placeholder still
    // sits in the group.
    expect(scoped.get(scopedKey(11))).toMatchObject({ scope: 'root', groupKey });
  });

  it('still records what the placeholder contains, in its own scope', () => {
    const scoped = collectScopedMembership(layoutWithPlaceholders());
    expect(scoped.get(`${OUTER}:20`)).toMatchObject({ scope: 'subgraph', subgraphId: OUTER });
  });
});
