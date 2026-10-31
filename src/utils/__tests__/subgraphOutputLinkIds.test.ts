import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { buildPromptFromWorkflow } from '../buildPromptFromWorkflow';

const NODE_TYPES = {
  Source: { input: { required: {} }, output: ['IMAGE'], output_name: ['IMAGE'], name: 'Source' },
  Sink: { input: { required: { images: ['IMAGE'] } }, output: [], output_name: [], output_node: true, name: 'Sink' },
} as unknown as NodeTypes;

function node(id: number, type: string, extra: Partial<WorkflowNode>): WorkflowNode {
  return { id, type, pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: [], ...extra };
}

describe('subgraph outputs', () => {
  it('resolve through the slot\'s linkIds, as stock does, when the link\'s target_slot is -1', () => {
    const workflow = {
      last_node_id: 3, last_link_id: 1, groups: [], config: {}, version: 1,
      nodes: [
        node(1, 'sg', { outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }] }),
        node(2, 'Sink', { inputs: [{ name: 'images', type: 'IMAGE', link: 1 }] }),
      ],
      links: [[1, 1, 0, 2, 0, 'IMAGE']],
      definitions: { subgraphs: [{
        id: 'sg', name: 'sg', inputs: [], groups: [],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', linkIds: [5, 5] }],
        nodes: [node(3, 'Source', { outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [5] }] })],
        links: [{ id: 5, origin_id: 3, origin_slot: 0, target_id: -20, target_slot: -1, type: 'IMAGE' }],
      }] },
    } as unknown as Workflow;
    const prompt = buildPromptFromWorkflow(workflow, NODE_TYPES) as Record<string, { inputs: Record<string, unknown> }>;
    expect(prompt['2'].inputs.images).toEqual(['1:3', 0]);
  });
});
