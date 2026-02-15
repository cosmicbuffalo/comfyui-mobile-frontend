import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '../mobileLayout';
import { makeLocationPointer } from '../mobileLayout';
import { buildNestedList, buildNestedListFromLayout, computeNodeGroups } from '../grouping';

function makeNode(id: number, x: number): WorkflowNode {
  return {
    id,
    type: 'Any',
    pos: [x, 0],
    size: [100, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: []
  };
}

function makeWorkflow(nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [
      { id: 1, title: 'Left', color: '#fff', bounding: [0, 0, 300, 200] },
      { id: 2, title: 'Right', color: '#fff', bounding: [300, 0, 300, 200] }
    ],
    config: {},
    version: 1
  };
}

describe('grouping overrides', () => {
  it('assigns nodes to the innermost nested group', () => {
    const node = makeNode(1, 60);
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [
        { id: 1, title: 'Outer', color: '#fff', bounding: [0, 0, 300, 300] },
        { id: 2, title: 'Inner', color: '#fff', bounding: [40, -20, 120, 120] }
      ],
      config: {},
      version: 1
    };

    const groups = computeNodeGroups(wf);
    expect(groups.get(1)).toBe(2);
  });

  it('applies overrides in computeNodeGroups', () => {
    const wf = makeWorkflow([makeNode(1, 20)]);
    const base = computeNodeGroups(wf);
    expect(base.get(1)).toBe(1);

    const overridden = computeNodeGroups(wf, { 1: 2 });
    expect(overridden.get(1)).toBe(2);
  });

  it('uses overrides when building nested groups', () => {
    const node = makeNode(1, 20);
    const wf = makeWorkflow([node]);
    const nested = buildNestedList(
      [node],
      wf,
      {
        [makeLocationPointer({ type: 'group', groupId: 1, subgraphId: null })]: false,
        [makeLocationPointer({ type: 'group', groupId: 2, subgraphId: null })]: false
      },
      {},
      undefined,
      { 1: 2 }
    );

    const groupItems = nested.filter((item) => item.type === 'group');
    expect(groupItems[0]?.type).toBe('group');
    if (groupItems[0]?.type === 'group') {
      expect(groupItems[0].group.id).toBe(2);
      expect(groupItems[0].children[0]?.type).toBe('node');
    }
  });

  it('buildNestedListFromLayout honors explicit container placement over geometry', () => {
    const node = makeNode(1, 500); // Geometrically in group 2.
    const wf = makeWorkflow([node]);
    const layout: MobileLayout = {
      root: [{ type: 'group', id: 1, subgraphId: null, stableKey: makeLocationPointer({ type: 'group', groupId: 1, subgraphId: null }) }],
      groups: {
        [makeLocationPointer({ type: 'group', groupId: 1, subgraphId: null })]: [{ type: 'node', id: 1 }],
        [makeLocationPointer({ type: 'group', groupId: 2, subgraphId: null })]: []
      },
      subgraphs: {},
      hiddenBlocks: {}
    };

    const nested = buildNestedListFromLayout(
      layout,
      wf,
      {
        [makeLocationPointer({ type: 'group', groupId: 1, subgraphId: null })]: false,
        [makeLocationPointer({ type: 'group', groupId: 2, subgraphId: null })]: false
      },
      {},
      {}
    );
    const groupItems = nested.filter((item) => item.type === 'group');
    expect(groupItems).toHaveLength(1);
    if (groupItems[0]?.type === 'group') {
      expect(groupItems[0].group.id).toBe(1);
      expect(groupItems[0].children[0]?.type).toBe('node');
      if (groupItems[0].children[0]?.type === 'node') {
        expect(groupItems[0].children[0].node.id).toBe(1);
      }
    }
  });
});
