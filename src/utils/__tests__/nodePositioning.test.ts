import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import {
  clampPositionToGroup,
  getBottomPlacement,
  getPositionNearNode
} from '../nodePositioning';

function makeNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type: 'Any',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides
  };
}

function makeWorkflow(nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 1
  };
}

describe('nodePositioning', () => {
  it('positions near target node with positive x offset', () => {
    const wf = makeWorkflow([makeNode(1, { pos: [100, 40] })]);
    expect(getPositionNearNode(wf, 1)).toEqual([350, 40]);
  });

  it('computes bottom placement below existing nodes', () => {
    const wf = makeWorkflow([
      makeNode(1, { pos: [0, 50], size: [200, 100] }),
      makeNode(2, { pos: [0, 300], size: [200, 140] })
    ]);
    expect(getBottomPlacement(wf)).toEqual([0, 520]);
  });

  it('clamps position to group bounds with padding', () => {
    const clamped = clampPositionToGroup(
      [0, 0],
      { id: 10, title: 'G', color: '#fff', bounding: [100, 100, 400, 300] },
      [200, 100]
    );
    expect(clamped[0]).toBeGreaterThanOrEqual(124);
    expect(clamped[1]).toBeGreaterThanOrEqual(148);
  });
});
