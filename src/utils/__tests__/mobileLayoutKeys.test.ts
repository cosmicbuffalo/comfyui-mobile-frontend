import { describe, expect, it } from 'vitest';
import {
  makeLocationPointer,
  parseLocationPointer
} from '@/utils/mobileLayout';

describe('mobile layout key helpers', () => {
  it('builds layout keys for each workflow item type', () => {
    expect(makeLocationPointer({ type: 'node', nodeId: 7, subgraphId: null })).toBe('root/node:7');
    expect(makeLocationPointer({ type: 'group', groupId: 3, subgraphId: 'sg-a' })).toBe('root/subgraph:sg-a/group:3');
    expect(makeLocationPointer({ type: 'subgraph', subgraphId: 'sg-a' })).toBe('root/subgraph:sg-a');
  });

  it('parses canonical layout keys', () => {
    expect(parseLocationPointer('root/node:7')).toEqual({ type: 'node', nodeId: 7, subgraphId: null });
    expect(parseLocationPointer('root/subgraph:sg-a/group:3')).toEqual({ type: 'group', groupId: 3, subgraphId: 'sg-a' });
    expect(parseLocationPointer('root/subgraph:sg-a')).toEqual({ type: 'subgraph', subgraphId: 'sg-a' });
    expect(parseLocationPointer('root/subgraph:sg-a/subgraph:sg-b/group:3')).toEqual({
      type: 'group',
      groupId: 3,
      subgraphId: 'sg-b'
    });
  });

  it('round-trips root and subgraph group keys', () => {
    const rootKey = makeLocationPointer({ type: 'group', groupId: 42, subgraphId: null });
    const subgraphKey = makeLocationPointer({ type: 'group', groupId: 42, subgraphId: 'sg-a' });

    expect(parseLocationPointer(rootKey)).toEqual({ type: 'group', subgraphId: null, groupId: 42 });
    expect(parseLocationPointer(subgraphKey)).toEqual({ type: 'group', subgraphId: 'sg-a', groupId: 42 });
  });

  it('rejects malformed keys', () => {
    expect(parseLocationPointer('group:42')).toBeNull();
    expect(parseLocationPointer('subgraph:foo:group:nope')).toBeNull();
    expect(parseLocationPointer('node:77')).toBeNull();
    expect(parseLocationPointer('root:node:abc')).toBeNull();
    expect(parseLocationPointer('root/group:nope')).toBeNull();
  });
});
