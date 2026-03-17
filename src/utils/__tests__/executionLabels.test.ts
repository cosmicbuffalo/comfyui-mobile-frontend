import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { resolveExecutingNodeLabel } from '@/utils/executionLabels';

function makeNode(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: makeLocationPointer({ type: 'node', nodeId: id, subgraphId: null }),
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  };
}

const nodeTypes: NodeTypes = {
  KSampler: {
    input: { required: {} },
    output: [],
    name: 'KSampler',
    display_name: 'KSampler',
    description: '',
    python_module: '',
    category: 'test',
  },
  InnerNode: {
    input: { required: {} },
    output: [],
    name: 'InnerNode',
    display_name: 'Inner Node',
    description: '',
    python_module: '',
    category: 'test',
  },
};

describe('resolveExecutingNodeLabel', () => {
  it('resolves a nested execution path through subgraphs', () => {
    const placeholder = makeNode(5, 'sg-a', { title: 'Outer Placeholder' });
    const innerNode = makeNode(10, 'InnerNode', {
      itemKey: makeLocationPointer({ type: 'node', nodeId: 10, subgraphId: 'sg-a' }),
    });
    const workflow: Workflow = {
      last_node_id: 10,
      last_link_id: 0,
      nodes: [placeholder],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          {
            id: 'sg-a',
            name: 'Inner Graph',
            nodes: [innerNode],
            groups: [],
            links: [],
            config: {},
          },
        ],
      },
    };

    expect(resolveExecutingNodeLabel('5:10', null, workflow, nodeTypes)).toBe('Inner Node');
  });

  it('falls back to root node labels for non-path execution ids', () => {
    const rootNode = makeNode(3, 'KSampler', { title: 'Sampler Root' });
    const workflow: Workflow = {
      last_node_id: 3,
      last_link_id: 0,
      nodes: [rootNode],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };

    expect(resolveExecutingNodeLabel(null, '3', workflow, nodeTypes)).toBe('Sampler Root');
  });
});
