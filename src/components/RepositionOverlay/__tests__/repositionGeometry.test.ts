import { describe, expect, it } from 'vitest';
import {
  computeInsertPositionByThreshold,
  containerIdEquals,
  containerIdToKey,
  itemRefToDataKey,
  parseSubgraphDataKey,
  subgraphDataKey,
  targetToDataKey,
} from '@/components/RepositionOverlay/repositionGeometry';
import type { ContainerId, ItemRef } from '@/utils/mobileLayout';

// idx/top/bottom/height rows for 3 stacked siblings, 100px tall, no gaps.
const siblings = [
  { idx: 0, top: 0, bottom: 100, height: 100 },
  { idx: 1, top: 100, bottom: 200, height: 100 },
  { idx: 2, top: 200, bottom: 300, height: 100 },
];

describe('computeInsertPositionByThreshold', () => {
  it('returns 0 when there are no siblings', () => {
    expect(computeInsertPositionByThreshold([], true, 0, 50, 0.5)).toBe(0);
  });

  it('moving down: inserts after each sibling whose mid-threshold the dragged bottom passes', () => {
    // draggedBottom=160 passes sibling0's threshold (50) but not sibling1's (150)... 160>150 -> after 1
    expect(computeInsertPositionByThreshold(siblings, true, 110, 160, 0.5)).toBe(2);
  });

  it('moving down: stays at 0 when the dragged bottom clears nothing', () => {
    expect(computeInsertPositionByThreshold(siblings, true, 0, 40, 0.5)).toBe(0);
  });

  it('moving up: inserts before each sibling whose threshold the dragged top passes', () => {
    // movingDown=false, draggedTop=140 < sibling2 threshold(250) and < sibling1 threshold(150) -> idx 1
    expect(computeInsertPositionByThreshold(siblings, false, 140, 240, 0.5)).toBe(1);
  });
});

describe('containerIdEquals', () => {
  it('matches roots regardless of other fields', () => {
    expect(containerIdEquals({ scope: 'root' }, { scope: 'root' })).toBe(true);
  });

  it('compares group keys', () => {
    const a: ContainerId = { scope: 'group', groupKey: 'g1' };
    expect(containerIdEquals(a, { scope: 'group', groupKey: 'g1' })).toBe(true);
    expect(containerIdEquals(a, { scope: 'group', groupKey: 'g2' })).toBe(false);
  });

  it('rejects mismatched scopes', () => {
    expect(containerIdEquals({ scope: 'root' }, { scope: 'group', groupKey: 'g1' })).toBe(false);
  });
});

describe('containerIdToKey', () => {
  it('serializes each scope distinctly', () => {
    expect(containerIdToKey({ scope: 'root' })).toBe('root');
    expect(containerIdToKey({ scope: 'group', groupKey: 'g1' })).toBe('group-g1');
    expect(containerIdToKey({ scope: 'subgraph', subgraphId: 's1' })).toBe('subgraph-s1');
  });
});

describe('itemRefToDataKey', () => {
  it('keys nodes / groups / subgraphs distinctly', () => {
    expect(itemRefToDataKey({ type: 'node', id: 5 } as ItemRef)).toBe('node-5');
    expect(itemRefToDataKey({ type: 'subgraph', id: 'abc' } as ItemRef)).toBe('subgraph-abc');
  });
});

describe('subgraph reposition keys', () => {
  it('tells two instances of one type apart', () => {
    // They shared a key, so `querySelector` found whichever came first — a drag
    // on the eleventh Section resolved to the first one's layout ref.
    const first = itemRefToDataKey({ type: 'subgraph', id: 'sg', nodeId: 815 } as ItemRef);
    const second = itemRefToDataKey({ type: 'subgraph', id: 'sg', nodeId: 1046 } as ItemRef);

    expect(first).not.toBe(second);
    expect(parseSubgraphDataKey(first)).toEqual({ id: 'sg', nodeId: 815 });
  });

  it('agrees with the key built from a reposition target', () => {
    expect(targetToDataKey({ type: 'subgraph', id: 'sg', nodeId: 815 })).toBe(
      itemRefToDataKey({ type: 'subgraph', id: 'sg', nodeId: 815 } as ItemRef),
    );
  });

  it('keeps the bare form for a subgraph used as a container', () => {
    // Contents are shared by every instance, so a container is the definition.
    expect(subgraphDataKey('sg')).toBe('subgraph-sg');
    expect(parseSubgraphDataKey('subgraph-sg')).toEqual({ id: 'sg' });
  });

  it('survives a definition id that contains the separator', () => {
    const key = subgraphDataKey('a::b', 7);
    expect(parseSubgraphDataKey(key)).toEqual({ id: 'a::b', nodeId: 7 });
  });
});
