import { describe, expect, it } from 'vitest';
import type { WorkflowLink, WorkflowSubgraphLink } from '@/api/types';
import { getNodeDeletionOptions } from '@/utils/nodeDeletionOptions';

const rootLink = (
  id: number,
  originId: number,
  targetId: number,
  type = 'IMAGE',
): WorkflowLink => [id, originId, 0, targetId, 0, type];

describe('getNodeDeletionOptions', () => {
  it('reports no connections for a node absent from the link table', () => {
    expect(getNodeDeletionOptions([rootLink(1, 5, 6)], 9)).toEqual({
      hasConnections: false,
      canReconnect: false,
    });
  });

  it('ignores stale slot caches by reading the link table alone', () => {
    // The node still carries outputs[].links pointing at link 4, but the scope
    // has no such link: nothing is attached, so nothing is offered.
    expect(getNodeDeletionOptions([], 9)).toEqual({
      hasConnections: false,
      canReconnect: false,
    });
  });

  it('offers no reconnect for a leaf node that only consumes', () => {
    expect(getNodeDeletionOptions([rootLink(1, 5, 9)], 9)).toEqual({
      hasConnections: true,
      canReconnect: false,
    });
  });

  it('offers no reconnect for a source node that only produces', () => {
    expect(getNodeDeletionOptions([rootLink(1, 9, 5)], 9)).toEqual({
      hasConnections: true,
      canReconnect: false,
    });
  });

  it('offers reconnect for a pass-through node with a type-compatible pair', () => {
    expect(
      getNodeDeletionOptions([rootLink(1, 5, 9), rootLink(2, 9, 6)], 9),
    ).toEqual({ hasConnections: true, canReconnect: true });
  });

  it('withholds reconnect when no incoming type matches the outgoing one', () => {
    expect(
      getNodeDeletionOptions(
        [rootLink(1, 5, 9, 'MODEL'), rootLink(2, 9, 6, 'IMAGE')],
        9,
      ),
    ).toEqual({ hasConnections: true, canReconnect: false });
  });

  it('reads subgraph object links the same way as root tuples', () => {
    const links: WorkflowSubgraphLink[] = [
      { id: 1, origin_id: 5, origin_slot: 0, target_id: 9, target_slot: 0, type: 'LATENT' },
      { id: 2, origin_id: 9, origin_slot: 0, target_id: 6, target_slot: 0, type: 'LATENT' },
    ];
    expect(getNodeDeletionOptions(links, 9)).toEqual({
      hasConnections: true,
      canReconnect: true,
    });
  });
});
