import { describe, expect, it } from 'vitest';
import type {
  Workflow,
  WorkflowGroup,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { stripWorkflowClientMetadata } from '@/hooks/useWorkflow';
import { getWorkflowForPersistence } from '@/utils/workflowPersistence';

function makeNode(id: number, inputs = 0, outputs = 0): WorkflowNode {
  return {
    id,
    itemKey: `root/node:${id}`,
    type: 'TestNode',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: Array.from({ length: inputs }, (_, i) => ({
      name: `input_${i}`,
      type: 'INT',
      link: null,
    })),
    outputs: Array.from({ length: outputs }, (_, i) => ({
      name: `output_${i}`,
      type: 'INT',
      links: [],
    })),
    properties: {},
    widgets_values: [],
  };
}

function makeGroup(id: number, title: string, subgraphId: string | null): WorkflowGroup {
  return {
    id,
    itemKey:
      subgraphId == null ? `root/group:${id}` : `root/subgraph:${subgraphId}/group:${id}`,
    title,
    bounding: [0, 0, 100, 100],
    color: '#fff',
  };
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'test-workflow',
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 1,
    ...overrides,
  };
}

describe('workflowPersistence', () => {
  it('strips client metadata from root and subgraph items', () => {
    const rootNode = makeNode(1);
    const rootGroup = makeGroup(10, 'Root Group', null);
    const subgraphNode = { ...makeNode(2), itemKey: 'root/subgraph:sg-a/node:2' };
    const subgraphGroup = makeGroup(20, 'Subgraph Group', 'sg-a');
    const subgraph: WorkflowSubgraphDefinition = {
      id: 'sg-a',
      itemKey: 'root/subgraph:sg-a',
      nodes: [subgraphNode],
      groups: [subgraphGroup],
      links: [],
      config: {},
    };
    const workflow = makeWorkflow({
      nodes: [rootNode],
      groups: [rootGroup],
      definitions: { subgraphs: [subgraph] },
    });

    const stripped = stripWorkflowClientMetadata(workflow);

    expect(stripped.nodes[0]).not.toHaveProperty('itemKey');
    expect(stripped.groups[0]).not.toHaveProperty('itemKey');
    expect(stripped.definitions?.subgraphs?.[0]).not.toHaveProperty('itemKey');
    expect(stripped.definitions?.subgraphs?.[0]?.nodes[0]).not.toHaveProperty('itemKey');
    expect(stripped.definitions?.subgraphs?.[0]?.groups?.[0]).not.toHaveProperty('itemKey');
  });

  it('repairs stale root link slot references before persistence', () => {
    const src = makeNode(1, 0, 1);
    const dst = makeNode(2, 1, 0);
    const link: WorkflowLink = [10, 1, 0, 2, 0, 'INT'];
    dst.inputs[0]!.link = 999;
    src.outputs[0]!.links = [];
    const workflow = makeWorkflow({
      nodes: [src, dst],
      links: [link],
      last_link_id: 10,
    });

    const persisted = getWorkflowForPersistence(workflow);

    expect(persisted).not.toBeNull();
    expect(persisted!.nodes.find((node) => node.id === 1)?.outputs[0]?.links).toEqual([10]);
    expect(persisted!.nodes.find((node) => node.id === 2)?.inputs[0]?.link).toBe(10);
  });

  it('recomputes subgraph boundary linkIds before persistence', () => {
    const innerNode = { ...makeNode(10, 1, 1), itemKey: 'root/subgraph:sg-a/node:10' };
    const subgraph: WorkflowSubgraphDefinition = {
      id: 'sg-a',
      itemKey: 'root/subgraph:sg-a',
      nodes: [innerNode],
      links: [
        { id: 101, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
        { id: 103, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
        { id: 202, origin_id: 10, origin_slot: 0, target_id: -20, target_slot: 0, type: 'INT' },
      ],
      inputs: [{ id: 'input-0', name: 'x', type: 'INT', linkIds: [999] }],
      outputs: [{ id: 'output-0', name: 'y', type: 'INT', linkIds: [] }],
      groups: [],
      config: {},
    };
    const placeholder = { ...makeNode(50, 1, 1), type: 'sg-a' };
    const workflow = makeWorkflow({
      nodes: [placeholder],
      definitions: { subgraphs: [subgraph] },
    });

    const persisted = getWorkflowForPersistence(workflow);
    const persistedSubgraph = persisted?.definitions?.subgraphs?.[0];

    expect(persistedSubgraph?.inputs?.[0]?.linkIds).toEqual([101, 103]);
    expect(persistedSubgraph?.outputs?.[0]?.linkIds).toEqual([202]);
    expect(persistedSubgraph).not.toHaveProperty('itemKey');
    expect(persistedSubgraph?.nodes[0]).not.toHaveProperty('itemKey');
  });

  it('returns null when canonical workflow is null', () => {
    expect(getWorkflowForPersistence(null)).toBeNull();
  });
});
