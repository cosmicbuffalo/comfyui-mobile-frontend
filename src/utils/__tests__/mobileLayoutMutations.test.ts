import { describe, expect, it } from 'vitest';
import type { MobileLayout } from '@/utils/mobileLayout';
import { removeNodeFromLayout } from '@/utils/mobileLayout';

describe('mobileLayout removeNodeFromLayout', () => {
  it('removes only nodes in the requested scope, including nested group ancestry', () => {
    const layout: MobileLayout = {
      root: [{ type: 'node', id: 7 }, { type: 'subgraph', id: 'sg-a' }],
      groups: {
        'g-sg-a-parent': [{ type: 'group', id: 11, subgraphId: 'sg-a', itemKey: 'g-sg-a-child' }],
        'g-sg-a-child': [{ type: 'node', id: 7 }]
      },
      groupParents: {
        'g-sg-a-parent': { scope: 'subgraph', subgraphId: 'sg-a' },
        'g-sg-a-child': { scope: 'group', groupKey: 'g-sg-a-parent' }
      },
      subgraphs: {
        'sg-a': [{ type: 'group', id: 10, subgraphId: 'sg-a', itemKey: 'g-sg-a-parent' }]
      },
      hiddenBlocks: {}
    };

    const next = removeNodeFromLayout(layout, 7, 'sg-a');
    expect(next.root).toContainEqual({ type: 'node', id: 7 });
    expect(next.groups['g-sg-a-child']).toEqual([]);
  });

  it('updates hidden blocks in the matching scope', () => {
    const layout: MobileLayout = {
      root: [{ type: 'subgraph', id: 'sg-a' }],
      groups: {},
      groupParents: {},
      subgraphs: {
        'sg-a': [{ type: 'hiddenBlock', blockId: 'hb-sg-a' }]
      },
      hiddenBlocks: {
        'hb-sg-a': [7, 8]
      }
    };

    const next = removeNodeFromLayout(layout, 7, 'sg-a');
    expect(next.subgraphs['sg-a']).toEqual([{ type: 'hiddenBlock', blockId: 'hb-sg-a' }]);
    expect(next.hiddenBlocks['hb-sg-a']).toEqual([8]);
  });
});

