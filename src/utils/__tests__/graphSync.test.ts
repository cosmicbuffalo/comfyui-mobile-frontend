import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { syncWorkflowGeometryFromLayoutChange } from '@/utils/graphSync';
import { computeNodeGroupsFor } from '@/utils/nodeGroups';

function makeNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: makeLocationPointer({ type: 'node', nodeId: id, subgraphId: null }),
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

describe('graphSync', () => {
  it('moves nodes into group geometry based on layout deltas and is idempotent', () => {
    const groupHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const oldLayout: MobileLayout = {
      root: [{ type: 'node', id: 1 }, { type: 'group', id: 10, subgraphId: null, itemKey: groupHierarchicalKey }],
      groups: { [groupHierarchicalKey]: [] },
      groupParents: { [groupHierarchicalKey]: { scope: 'root' } },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const newLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupHierarchicalKey }],
      groups: { [groupHierarchicalKey]: [{ type: 'node', id: 1 }] },
      groupParents: { [groupHierarchicalKey]: { scope: 'root' } },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const workflow: Workflow = {
      ...makeWorkflow([makeNode(1, { pos: [1200, 1200] })]),
      groups: [{ id: 10, itemKey: groupHierarchicalKey, title: 'G', color: '#fff', bounding: [100, 100, 400, 240] }]
    };

    const first = syncWorkflowGeometryFromLayoutChange({
      oldLayout,
      newLayout,
      workflow
    });
    const grouped = computeNodeGroupsFor(first.workflow.nodes, first.workflow.groups);
    expect(grouped.get(1)).toBe(10);

    const second = syncWorkflowGeometryFromLayoutChange({
      oldLayout: newLayout,
      newLayout,
      workflow: first.workflow
    });
    expect(second.changedNodeIds).toEqual([]);
    expect(second.workflow).toBe(first.workflow);
  });

  it('handles legacy pointer-keyed layout groups during sync', () => {
    const groupPointer = 'root/group:10';
    const oldLayout: MobileLayout = {
      root: [{ type: 'node', id: 1 }, { type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }],
      groups: { [groupPointer]: [] },
      groupParents: { [groupPointer]: { scope: 'root' } },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const newLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupPointer }],
      groups: { [groupPointer]: [{ type: 'node', id: 1 }] },
      groupParents: { [groupPointer]: { scope: 'root' } },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const workflow: Workflow = {
      ...makeWorkflow([makeNode(1, { pos: [1200, 1200] })]),
      groups: [{ id: 10, itemKey: makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null }), title: 'G', color: '#fff', bounding: [100, 100, 400, 240] }]
    };
    const result = syncWorkflowGeometryFromLayoutChange({
      oldLayout,
      newLayout,
      workflow
    });
    const grouped = computeNodeGroupsFor(result.workflow.nodes, result.workflow.groups);
    expect(grouped.get(1)).toBe(10);
  });

  it('recomputes nested group bounds bottom-up', () => {
    const parentHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const childHierarchicalKey = makeLocationPointer({ type: 'group', groupId: 11, subgraphId: null });
    const oldLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: parentHierarchicalKey }, { type: 'node', id: 1 }],
      groups: {
        [parentHierarchicalKey]: [{ type: 'group', id: 11, subgraphId: null, itemKey: childHierarchicalKey }],
        [childHierarchicalKey]: []
      },
      groupParents: {
        [parentHierarchicalKey]: { scope: 'root' },
        [childHierarchicalKey]: { scope: 'group', groupKey: parentHierarchicalKey }
      },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const newLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: parentHierarchicalKey }],
      groups: {
        [parentHierarchicalKey]: [{ type: 'group', id: 11, subgraphId: null, itemKey: childHierarchicalKey }],
        [childHierarchicalKey]: [{ type: 'node', id: 1 }]
      },
      groupParents: {
        [parentHierarchicalKey]: { scope: 'root' },
        [childHierarchicalKey]: { scope: 'group', groupKey: parentHierarchicalKey }
      },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const workflow: Workflow = {
      ...makeWorkflow([makeNode(1, { pos: [1200, 1200] })]),
      groups: [
        { id: 10, itemKey: parentHierarchicalKey, title: 'Parent', color: '#fff', bounding: [100, 100, 300, 220] },
        { id: 11, itemKey: childHierarchicalKey, title: 'Child', color: '#fff', bounding: [120, 130, 180, 140] }
      ]
    };

    const result = syncWorkflowGeometryFromLayoutChange({
      oldLayout,
      newLayout,
      workflow
    });
    const nextParent = result.workflow.groups.find((group) => group.id === 10);
    const nextChild = result.workflow.groups.find((group) => group.id === 11);
    expect(nextParent).toBeDefined();
    expect(nextChild).toBeDefined();
    expect((nextChild?.bounding[2] ?? 0) >= 180).toBe(true);
    expect((nextParent?.bounding[2] ?? 0) >= 300).toBe(true);
  });

  it('expands parent group bounds when a child group grows to contain a new node', () => {
    const parentKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const childKey = makeLocationPointer({ type: 'group', groupId: 11, subgraphId: null });
    const workflow: Workflow = {
      ...makeWorkflow([makeNode(1, { pos: [9000, 9000], size: [300, 200] })]),
      groups: [
        { id: 10, itemKey: parentKey, title: 'Parent', color: '#fff', bounding: [100, 100, 210, 210] },
        { id: 11, itemKey: childKey, title: 'Child', color: '#fff', bounding: [110, 130, 180, 160] }
      ]
    };

    const oldLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: parentKey }, { type: 'node', id: 1 }],
      groups: {
        [parentKey]: [{ type: 'group', id: 11, subgraphId: null, itemKey: childKey }],
        [childKey]: []
      },
      groupParents: {
        [parentKey]: { scope: 'root' },
        [childKey]: { scope: 'group', groupKey: parentKey }
      },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const newLayout: MobileLayout = {
      ...oldLayout,
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: parentKey }],
      groups: {
        [parentKey]: [{ type: 'group', id: 11, subgraphId: null, itemKey: childKey }],
        [childKey]: [{ type: 'node', id: 1 }]
      }
    };

    const result = syncWorkflowGeometryFromLayoutChange({
      oldLayout,
      newLayout,
      workflow
    });
    const nextParent = result.workflow.groups.find((group) => group.id === 10);
    const nextChild = result.workflow.groups.find((group) => group.id === 11);
    expect(nextParent).toBeDefined();
    expect(nextChild).toBeDefined();
    const childRight = (nextChild?.bounding[0] ?? 0) + (nextChild?.bounding[2] ?? 0);
    const childBottom = (nextChild?.bounding[1] ?? 0) + (nextChild?.bounding[3] ?? 0);
    const parentRight = (nextParent?.bounding[0] ?? 0) + (nextParent?.bounding[2] ?? 0);
    const parentBottom = (nextParent?.bounding[1] ?? 0) + (nextParent?.bounding[3] ?? 0);
    expect(parentRight).toBeGreaterThanOrEqual(childRight);
    expect(parentBottom).toBeGreaterThanOrEqual(childBottom);
  });

  it('resets empty group bounding box to default size when all members leave', () => {
    const groupKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const oldLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupKey }],
      groups: { [groupKey]: [{ type: 'node', id: 1 }] },
      groupParents: { [groupKey]: { scope: 'root' } },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const newLayout: MobileLayout = {
      root: [{ type: 'node', id: 1 }, { type: 'group', id: 10, subgraphId: null, itemKey: groupKey }],
      groups: { [groupKey]: [] },
      groupParents: { [groupKey]: { scope: 'root' } },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const workflow: Workflow = {
      ...makeWorkflow([makeNode(1, { pos: [150, 150] })]),
      groups: [{ id: 10, itemKey: groupKey, title: 'G', color: '#fff', bounding: [100, 100, 600, 400] }]
    };

    const first = syncWorkflowGeometryFromLayoutChange({
      oldLayout,
      newLayout,
      workflow
    });
    const nextGroup = first.workflow.groups.find((group) => group.id === 10);
    expect(nextGroup?.bounding).toEqual([100, 100, 320, 160]);

    const second = syncWorkflowGeometryFromLayoutChange({
      oldLayout: newLayout,
      newLayout,
      workflow: first.workflow
    });
    expect(second.workflow).toBe(first.workflow);
  });

  it('does not reset group bounds when layout still has member refs but node lookup misses', () => {
    const groupKey = makeLocationPointer({ type: 'group', groupId: 10, subgraphId: null });
    const oldLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupKey }],
      groups: { [groupKey]: [{ type: 'node', id: 1 }] },
      groupParents: { [groupKey]: { scope: 'root' } },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const newLayout: MobileLayout = {
      root: [{ type: 'group', id: 10, subgraphId: null, itemKey: groupKey }],
      // Stale/missing node ref -> fitNodes is empty, but group still has member refs.
      groups: { [groupKey]: [{ type: 'node', id: 999 }] },
      groupParents: { [groupKey]: { scope: 'root' } },
      subgraphs: {},
      hiddenBlocks: {}
    };
    const workflow: Workflow = {
      ...makeWorkflow([makeNode(1, { pos: [150, 150] })]),
      groups: [{ id: 10, itemKey: groupKey, title: 'G', color: '#fff', bounding: [100, 100, 600, 400] }]
    };

    const result = syncWorkflowGeometryFromLayoutChange({
      oldLayout,
      newLayout,
      workflow
    });
    const nextGroup = result.workflow.groups.find((group) => group.id === 10);
    expect(nextGroup?.bounding).toEqual([100, 100, 600, 400]);
  });

  it('syncs inner subgraph node geometry when moving into a subgraph-local group', () => {
    const sgGroupKey = makeLocationPointer({ type: 'group', groupId: 11, subgraphId: 'sg-a' });
    const oldLayout: MobileLayout = {
      root: [{ type: 'subgraph', id: 'sg-a' }],
      groups: { [sgGroupKey]: [] },
      groupParents: { [sgGroupKey]: { scope: 'subgraph', subgraphId: 'sg-a' } },
      subgraphs: {
        'sg-a': [
          { type: 'node', id: 101 },
          { type: 'group', id: 11, subgraphId: 'sg-a', itemKey: sgGroupKey }
        ]
      },
      hiddenBlocks: {}
    };
    const newLayout: MobileLayout = {
      root: [{ type: 'subgraph', id: 'sg-a' }],
      groups: { [sgGroupKey]: [{ type: 'node', id: 101 }] },
      groupParents: { [sgGroupKey]: { scope: 'subgraph', subgraphId: 'sg-a' } },
      subgraphs: {
        'sg-a': [{ type: 'group', id: 11, subgraphId: 'sg-a', itemKey: sgGroupKey }]
      },
      hiddenBlocks: {}
    };
    const workflow: Workflow = {
      ...makeWorkflow([]),
      definitions: {
        subgraphs: [{
          id: 'sg-a',
          nodes: [makeNode(101, { pos: [1600, 1600] })],
          links: [],
          groups: [{ id: 11, itemKey: sgGroupKey, title: 'SG', color: '#fff', bounding: [100, 100, 400, 240] }]
        }]
      }
    };

    const result = syncWorkflowGeometryFromLayoutChange({
      oldLayout,
      newLayout,
      workflow
    });
    const nextSubgraph = result.workflow.definitions?.subgraphs?.find((entry) => entry.id === 'sg-a');
    const movedNode = nextSubgraph?.nodes.find((node) => node.id === 101);
    expect(movedNode).toBeDefined();
    expect(movedNode?.pos[0]).toBeGreaterThanOrEqual(124);
    expect(movedNode?.pos[1]).toBeGreaterThanOrEqual(148);
  });

  it('does not conflate root and subgraph nodes with the same id', () => {
    const sgGroupKey = makeLocationPointer({ type: 'group', groupId: 11, subgraphId: 'sg-a' });
    const oldLayout: MobileLayout = {
      root: [{ type: 'node', id: 7 }, { type: 'subgraph', id: 'sg-a' }],
      groups: { [sgGroupKey]: [] },
      groupParents: { [sgGroupKey]: { scope: 'subgraph', subgraphId: 'sg-a' } },
      subgraphs: {
        'sg-a': [
          { type: 'node', id: 7 },
          { type: 'group', id: 11, subgraphId: 'sg-a', itemKey: sgGroupKey }
        ]
      },
      hiddenBlocks: {}
    };
    const newLayout: MobileLayout = {
      root: [{ type: 'node', id: 7 }, { type: 'subgraph', id: 'sg-a' }],
      groups: { [sgGroupKey]: [{ type: 'node', id: 7 }] },
      groupParents: { [sgGroupKey]: { scope: 'subgraph', subgraphId: 'sg-a' } },
      subgraphs: {
        'sg-a': [{ type: 'group', id: 11, subgraphId: 'sg-a', itemKey: sgGroupKey }]
      },
      hiddenBlocks: {}
    };
    const workflow: Workflow = {
      ...makeWorkflow([makeNode(7, { pos: [50, 50] })]),
      definitions: {
        subgraphs: [{
          id: 'sg-a',
          nodes: [makeNode(7, { pos: [1600, 1600] })],
          links: [],
          groups: [{ id: 11, itemKey: sgGroupKey, title: 'SG', color: '#fff', bounding: [100, 100, 400, 240] }]
        }]
      }
    };

    const result = syncWorkflowGeometryFromLayoutChange({
      oldLayout,
      newLayout,
      workflow
    });
    const nextRoot = result.workflow.nodes.find((node) => node.id === 7);
    const nextInner = result.workflow.definitions?.subgraphs?.find((entry) => entry.id === 'sg-a')?.nodes.find((node) => node.id === 7);
    expect(nextRoot?.pos).toEqual([50, 50]);
    expect(nextInner?.pos[0]).toBeGreaterThanOrEqual(124);
    expect(nextInner?.pos[1]).toBeGreaterThanOrEqual(148);
  });

});
