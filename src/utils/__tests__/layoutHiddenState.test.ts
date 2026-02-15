import { describe, expect, it } from 'vitest';
import type { MobileLayout } from '@/utils/mobileLayout';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { collectLayoutHiddenState } from '@/utils/layoutHiddenState';

describe('collectLayoutHiddenState', () => {
  it('counts hidden nodes from direct and hidden-block entries', () => {
    const groupKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const layout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, stableKey: groupKey }],
      groups: {
        [groupKey]: [
          { type: 'node', id: 1 },
          { type: 'hiddenBlock', blockId: 'hb-1' }
        ]
      },
      subgraphs: {},
      hiddenBlocks: {
        'hb-1': [2, 3]
      }
    };

    const hiddenState = collectLayoutHiddenState(layout.root, {
      layout,
      hiddenItems: {
        [makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null })]: true,
        [makeLocationPointer({ type: 'node', nodeId: 2, subgraphId: null })]: true,
        [makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null })]: false
      },
      stableKeyByPointer: {}
    });

    expect(hiddenState.hiddenNodeCount).toBe(2);
    expect(hiddenState.hiddenNodeKeys.has(
      makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null })
    )).toBe(true);
    expect(hiddenState.hiddenNodeKeys.has(
      makeLocationPointer({ type: 'node', nodeId: 2, subgraphId: null })
    )).toBe(true);
  });

  it('marks all descendants hidden when parent container is hidden', () => {
    const groupKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const layout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, stableKey: groupKey }],
      groups: {
        [groupKey]: [{ type: 'node', id: 1 }]
      },
      subgraphs: {},
      hiddenBlocks: {}
    };

    const hiddenState = collectLayoutHiddenState(layout.root, {
      layout,
      hiddenItems: {
        [makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null })]: true
      },
      stableKeyByPointer: {}
    });

    expect(hiddenState.hiddenNodeCount).toBe(1);
    expect(hiddenState.hiddenGroupKeys.has(
      makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null })
    )).toBe(true);
  });
});
