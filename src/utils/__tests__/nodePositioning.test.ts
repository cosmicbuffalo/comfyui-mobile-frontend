import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import {
  assignPositionsInGroup,
  clampPositionToGroup,
  expandGroupToFitNodes,
  getBottomPlacement,
  getPositionNearNode,
  positionBelowAll
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

  it('assigns positions inside group bounds', () => {
    const group = { id: 10, title: 'G', color: '#fff', bounding: [100, 100, 420, 280] as [number, number, number, number] };
    const assigned = assignPositionsInGroup(group, [
      { id: 1, size: [200, 100] },
      { id: 2, size: [220, 120] }
    ]);
    const p1 = assigned.get(1);
    const p2 = assigned.get(2);
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1?.[0]).toBeGreaterThanOrEqual(124);
    expect(p1?.[1]).toBeGreaterThanOrEqual(148);
    expect(p2?.[0]).toBeGreaterThanOrEqual(124);
    expect(p2?.[1]).toBeGreaterThanOrEqual(148);
  });

  it('expands group bounds to fit nodes', () => {
    const group = { id: 10, title: 'G', color: '#fff', bounding: [100, 100, 300, 220] as [number, number, number, number] };
    const expanded = expandGroupToFitNodes(group, [
      { id: 1, pos: [150, 150], size: [200, 100] },
      { id: 2, pos: [520, 420], size: [240, 140] }
    ]);
    expect(expanded.bounding[2]).toBeGreaterThan(group.bounding[2]);
    expect(expanded.bounding[3]).toBeGreaterThan(group.bounding[3]);
  });

  it('positions node below all nodes in a scope with deterministic offset', () => {
    const wf = makeWorkflow([makeNode(1, { pos: [0, 50], size: [100, 120] })]);
    wf.definitions = {
      subgraphs: [{
        id: 'sg-a',
        nodes: [makeNode(2, { pos: [0, 250], size: [100, 120] })],
        links: [],
        groups: [],
      }]
    };
    expect(positionBelowAll(wf, { subgraphId: null }, 1)).toEqual([24, 274]);
    expect(positionBelowAll(wf, { subgraphId: 'sg-a' })).toEqual([0, 450]);
  });

  it('positions moved-out node to the right of existing scope groups', () => {
    const wf = makeWorkflow([
      makeNode(1, { pos: [150, 150], size: [120, 80] })
    ]);
    wf.groups = [{ id: 10, title: 'G', color: '#fff', bounding: [100, 100, 500, 300] }];
    expect(positionBelowAll(wf, { subgraphId: null })).toEqual([680, 310]);
  });
});
