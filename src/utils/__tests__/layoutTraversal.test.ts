import { describe, expect, it } from 'vitest';
import type { MobileLayout } from '@/utils/mobileLayout';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { findLayoutPath } from '@/utils/layoutTraversal';

describe('findLayoutPath', () => {
  const groupKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
  const nestedGroupKey = makeLocationPointer({ type: 'group', groupId: 20, subgraphId: 'sg-1' });
  const layout: MobileLayout = {
    root: [
      { type: 'node', id: 1 },
      { type: 'group', id: 10, subgraphId: null, stableKey: groupKey },
      { type: 'subgraph', id: 'sg-1' }
    ],
    groups: {
      [groupKey]: [{ type: 'node', id: 2 }],
      [nestedGroupKey]: [{ type: 'node', id: 4 }]
    },
    subgraphs: {
      'sg-1': [{ type: 'group', id: 20, subgraphId: 'sg-1', stableKey: nestedGroupKey }]
    },
    hiddenBlocks: {}
  };

  it('returns path for nested group in subgraph scope', () => {
    const path = findLayoutPath(layout, ({ ref, currentSubgraphId }) => {
      return (
        ref.type === 'group' &&
        ref.id === 20 &&
        currentSubgraphId === 'sg-1'
      );
    });
    expect(path).toEqual({
      groupKeys: [],
      subgraphIds: ['sg-1'],
      currentSubgraphId: 'sg-1'
    });
  });

  it('returns null when no match is found', () => {
    const path = findLayoutPath(layout, ({ ref }) => ref.type === 'node' && ref.id === 999);
    expect(path).toBeNull();
  });
});
