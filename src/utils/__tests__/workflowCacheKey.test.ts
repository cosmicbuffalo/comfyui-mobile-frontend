import { describe, it, expect } from 'vitest';
import { buildWorkflowCacheKey } from '../workflowCacheKey';
import type { Workflow, WorkflowNode, NodeTypes } from '@/api/types';

function makeNode(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
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

function makeWorkflow(nodes: WorkflowNode[], overrides?: Partial<Workflow>): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 1,
    ...overrides,
  };
}

describe('buildWorkflowCacheKey', () => {
  it('returns a string starting with wf_', () => {
    const wf = makeWorkflow([makeNode(1, 'KSampler')]);
    const key = buildWorkflowCacheKey(wf);
    expect(key).toMatch(/^wf_[0-9a-f]{8}$/);
  });

  it('produces the same key for the same node types regardless of order', () => {
    const wfA = makeWorkflow([makeNode(1, 'KSampler'), makeNode(2, 'CheckpointLoader')]);
    const wfB = makeWorkflow([makeNode(1, 'CheckpointLoader'), makeNode(2, 'KSampler')]);

    expect(buildWorkflowCacheKey(wfA)).toBe(buildWorkflowCacheKey(wfB));
  });

  it('produces different keys for different node types', () => {
    const wfA = makeWorkflow([makeNode(1, 'KSampler')]);
    const wfB = makeWorkflow([makeNode(1, 'CLIPTextEncode')]);

    expect(buildWorkflowCacheKey(wfA)).not.toBe(buildWorkflowCacheKey(wfB));
  });

  it('handles empty workflow', () => {
    const wf = makeWorkflow([]);
    const key = buildWorkflowCacheKey(wf);
    expect(key).toMatch(/^wf_[0-9a-f]{8}$/);
  });

  it('includes subgraph nodes', () => {
    const wf = makeWorkflow([makeNode(1, 'KSampler')], {
      definitions: {
        subgraphs: [
          {
            id: 'sub1',
            nodes: [makeNode(100, 'CLIPTextEncode')],
            links: [],
          },
        ],
      },
    });

    const wfWithoutSub = makeWorkflow([makeNode(1, 'KSampler')]);

    // With subgraph should differ from without (assuming CLIPTextEncode is non-static)
    expect(buildWorkflowCacheKey(wf)).not.toBe(buildWorkflowCacheKey(wfWithoutSub));
  });

  it('excludes static nodes when nodeTypes are provided', () => {
    // A static node has no widget definitions — no required/optional inputs that are widgets
    const nodeTypes: NodeTypes = {
      StaticNode: {
        input: { required: {} },
        output: ['IMAGE'],
        output_is_list: [false],
        output_name: ['IMAGE'],
        name: 'StaticNode',
        display_name: 'Static Node',
        description: '',
        python_module: '',
        category: '',
        output_node: false,
        output_tooltips: [],
      },
      KSampler: {
        input: {
          required: {
            seed: ['INT', { default: 0 }],
            steps: ['INT', { default: 20 }],
          },
        },
        output: ['LATENT'],
        output_is_list: [false],
        output_name: ['LATENT'],
        name: 'KSampler',
        display_name: 'KSampler',
        description: '',
        python_module: '',
        category: '',
        output_node: false,
        output_tooltips: [],
      },
    };

    const wfBoth = makeWorkflow([
      makeNode(1, 'KSampler', { widgets_values: [42, 20] }),
      makeNode(2, 'StaticNode'),
    ]);

    const wfOnlyKSampler = makeWorkflow([
      makeNode(1, 'KSampler', { widgets_values: [42, 20] }),
    ]);

    // Static node should be excluded, so both should produce the same key
    expect(buildWorkflowCacheKey(wfBoth, nodeTypes)).toBe(
      buildWorkflowCacheKey(wfOnlyKSampler, nodeTypes)
    );
  });

  it('is deterministic across calls', () => {
    const wf = makeWorkflow([makeNode(1, 'KSampler'), makeNode(2, 'VAEDecode')]);
    const key1 = buildWorkflowCacheKey(wf);
    const key2 = buildWorkflowCacheKey(wf);
    expect(key1).toBe(key2);
  });
});
