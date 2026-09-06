import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '../mobileLayout';
import { makeLocationPointer } from '../mobileLayout';
import { buildNestedListFromLayout } from '../grouping';
import { computeNodeGroupsFor } from '../nodeGroups';

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

describe('grouping', () => {
  it('assigns nodes to the innermost nested group', () => {
    const node = makeNode(1, 60);
    const groups = computeNodeGroupsFor(
      [node],
      [
        { id: 1, bounding: [0, 0, 300, 300] },
        { id: 2, bounding: [40, -20, 120, 120] }
      ],
    );
    expect(groups.get(1)).toBe(2);
  });

  it('buildNestedListFromLayout honors explicit container placement over geometry', () => {
    const node = makeNode(1, 500); // Geometrically in group 2.
    const wf = makeWorkflow([node]);
    const layout: MobileLayout = {
      root: [{ type: 'group', id: 1, subgraphId: null, itemKey: makeLocationPointer({ type: 'group', groupId: 1, subgraphId: null }) }],
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

  it('counts bypassed nodes over the visible set only', () => {
    // Group 1 holds one engaged visible node and one bypassed node the user has
    // hidden (e.g. via "Hide bypassed nodes"). The hidden one must not push the
    // group to a fully-bypassed count, which is what tints its card purple.
    const visible = makeNode(1, 60);
    const hiddenBypassed = { ...makeNode(2, 120), mode: 4 };
    const wf = makeWorkflow([visible, hiddenBypassed]);
    const groupKey = makeLocationPointer({ type: 'group', groupId: 1, subgraphId: null });
    const layout: MobileLayout = {
      root: [{ type: 'group', id: 1, subgraphId: null, itemKey: groupKey }],
      groups: { [groupKey]: [{ type: 'node', id: 1 }, { type: 'node', id: 2 }] },
      subgraphs: {},
      hiddenBlocks: {}
    };

    const nested = buildNestedListFromLayout(
      layout,
      wf,
      { [groupKey]: false },
      { [makeLocationPointer({ type: 'node', nodeId: 2, subgraphId: null })]: true }
    );
    const group = nested.find((item) => item.type === 'group');
    expect(group?.type).toBe('group');
    if (group?.type === 'group') {
      expect(group.nodeCount).toBe(1);
      expect(group.bypassedNodeCount).toBe(0);
    }
  });

  it('reads a group\'s subgraph bypass state from the placeholder, per instance', () => {
    // Two groups hold placeholders of one shared definition. Bypassing one
    // instance must not tint the other group, and the definition's inner nodes
    // stay engaged (queue-time expansion applies the placeholder's mode).
    const sgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const bypassedPlaceholder = { ...makeNode(5, 60), type: sgId, mode: 4 };
    const engagedPlaceholder = { ...makeNode(6, 360), type: sgId, mode: 0 };
    const wf: Workflow = {
      ...makeWorkflow([bypassedPlaceholder, engagedPlaceholder]),
      definitions: {
        subgraphs: [
          { id: sgId, name: 'Shared', nodes: [makeNode(10, 0)], links: [], groups: [] }
        ]
      }
    };
    const groupOneKey = makeLocationPointer({ type: 'group', groupId: 1, subgraphId: null });
    const groupTwoKey = makeLocationPointer({ type: 'group', groupId: 2, subgraphId: null });
    const layout: MobileLayout = {
      root: [
        { type: 'group', id: 1, subgraphId: null, itemKey: groupOneKey },
        { type: 'group', id: 2, subgraphId: null, itemKey: groupTwoKey }
      ],
      groups: {
        [groupOneKey]: [{ type: 'subgraph', id: sgId, nodeId: 5 }],
        [groupTwoKey]: [{ type: 'subgraph', id: sgId, nodeId: 6 }]
      },
      subgraphs: { [sgId]: [{ type: 'node', id: 10 }] },
      hiddenBlocks: {}
    };

    const nested = buildNestedListFromLayout(
      layout,
      wf,
      { [groupOneKey]: false, [groupTwoKey]: false },
      {}
    );
    const groups = nested.filter((item) => item.type === 'group');
    expect(groups).toHaveLength(2);
    if (groups[0]?.type === 'group' && groups[1]?.type === 'group') {
      expect(groups[0].nodeCount).toBe(1);
      expect(groups[0].bypassedNodeCount).toBe(1);
      expect(groups[1].nodeCount).toBe(1);
      expect(groups[1].bypassedNodeCount).toBe(0);
    }
  });

  it('renders each placeholder instance of a shared subgraph definition', () => {
    const sgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const wf: Workflow = {
      last_node_id: 6,
      last_link_id: 0,
      nodes: [
        { ...makeNode(5, 0), type: sgId },
        { ...makeNode(6, 0), type: sgId }
      ],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          { id: sgId, name: 'Shared', nodes: [makeNode(10, 0)], links: [], groups: [] }
        ]
      }
    };
    const layout: MobileLayout = {
      root: [
        { type: 'subgraph', id: sgId, nodeId: 5 },
        { type: 'subgraph', id: sgId, nodeId: 6 }
      ],
      groups: {},
      subgraphs: { [sgId]: [{ type: 'node', id: 10 }] },
      hiddenBlocks: {}
    };

    const nested = buildNestedListFromLayout(layout, wf, {}, {});
    const subgraphItems = nested.filter((item) => item.type === 'subgraph');
    expect(subgraphItems).toHaveLength(2);
    expect(
      subgraphItems.map((item) =>
        item.type === 'subgraph' ? item.placeholderNodeId : null,
      ),
    ).toEqual([5, 6]);
  });
});
