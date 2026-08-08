import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import {
  buildDefaultLayout,
  extractLayoutNodeMembership,
  extractLayoutSubgraphNodeMembership,
  makeLocationPointer,
} from '@/utils/mobileLayout';

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
