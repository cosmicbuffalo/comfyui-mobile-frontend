import { describe, expect, it } from 'vitest';
import type { MobileLayout } from '@/utils/mobileLayout';
import {
  extractLayoutNodeMembership,
  extractLayoutSubgraphNodeMembership,
  makeLocationPointer,
} from '@/utils/mobileLayout';

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
});
