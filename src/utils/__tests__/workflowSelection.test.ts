import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowGroup, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import { collectGroupSelectionKeys } from '@/utils/workflowSelection';

const node = (id: number, type = 'Test'): WorkflowNode => ({
  id,
  itemKey: `stable-node-${id}`,
  type,
  pos: [0, 0],
  size: [100, 100],
  flags: {},
  order: 0,
  mode: 0,
  inputs: [],
  outputs: [],
  properties: {},
  widgets_values: [],
});

const group = (id: number): WorkflowGroup => ({
  id,
  itemKey: `stable-group-${id}`,
  title: `Group ${id}`,
  bounding: [0, 0, 100, 100],
  color: '#fff',
  font_size: 24,
  flags: {},
});

const workflow: Workflow = {
  last_node_id: 99,
  last_link_id: 0,
  nodes: [node(1), node(2), node(3), node(4, 'SG'), node(5)],
  links: [],
  groups: [group(1), group(2), group(3)],
  definitions: {
    subgraphs: [{
      id: 'SG',
      itemKey: 'stable-subgraph-SG',
      nodes: [{ ...node(99), itemKey: 'stable-inner-node-99' }],
      links: [],
      groups: [],
    }],
  },
  config: {},
  version: 0.4,
};

const layout: MobileLayout = {
  root: [{ type: 'group', id: 1, subgraphId: null, itemKey: 'root/group:1' }],
  groups: {
    'root/group:1': [
      { type: 'node', id: 1 },
      { type: 'group', id: 2, subgraphId: null, itemKey: 'root/group:2' },
      { type: 'subgraph', id: 'SG', nodeId: 4 },
      { type: 'hiddenBlock', blockId: 'hidden-direct' },
    ],
    'root/group:2': [
      { type: 'node', id: 2 },
      { type: 'group', id: 3, subgraphId: null, itemKey: 'root/group:3' },
    ],
    'root/group:3': [{ type: 'node', id: 3 }],
  },
  groupParents: {
    'root/group:1': { scope: 'root' },
    'root/group:2': { scope: 'group', groupKey: 'root/group:1' },
    'root/group:3': { scope: 'group', groupKey: 'root/group:2' },
  },
  subgraphs: {
    SG: [{ type: 'node', id: 99 }],
  },
  hiddenBlocks: {
    'hidden-direct': [5],
  },
};

describe('collectGroupSelectionKeys', () => {
  it('selects only immediate children, including hidden nodes and placeholders', () => {
    expect(collectGroupSelectionKeys(layout, workflow, 1, null, 'children')).toEqual([
      'stable-node-1',
      'stable-group-2',
      'stable-node-4',
      'stable-node-5',
    ]);
  });

  it('recurses through nested groups without crossing a subgraph boundary', () => {
    const selected = collectGroupSelectionKeys(layout, workflow, 1, null, 'descendants');
    expect(selected).toEqual([
      'stable-node-1',
      'stable-group-2',
      'stable-node-2',
      'stable-group-3',
      'stable-node-3',
      'stable-node-4',
      'stable-node-5',
    ]);
    expect(selected).not.toContain('stable-inner-node-99');
  });
});
