import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import {
  findRootWorkflowNodeById,
  findWorkflowNodeInScope,
  resolveSubgraphPlaceholderConnectionLabel,
  resolveWorkflowNodeDisplayName
} from '../subgraphPlaceholderLabels';

function makeNode(
  id: number,
  type: string,
  overrides?: Partial<WorkflowNode>
): WorkflowNode {
  return {
    id,
    type,
    pos: [0, 0],
    size: [200, 120],
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

function makeWorkflow(
  nodes: WorkflowNode[],
  subgraphs: WorkflowSubgraphDefinition[] = []
): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    definitions: subgraphs.length > 0 ? { subgraphs } : undefined,
    version: 1,
  };
}

describe('resolveSubgraphPlaceholderConnectionLabel', () => {
  it('uses node slot label field when present (real-world case matching ComfyUI frontend)', () => {
    // Mirrors the real base_dasiwa.json structure: node slots have name + label,
    // where label is the user-authored display name shown in ComfyUI frontend.
    const placeholder = makeNode(911, 'sg-backend', {
      inputs: [
        { name: 'model_1', label: 'model_1_in', type: 'MODEL', link: null },
        { name: 'model_2', label: 'model_2_in', type: 'MODEL', link: null },
        { name: 'clip', label: 'clip_in', type: 'CLIP', link: null },
      ],
      outputs: [
        { name: 'model_1', label: 'model_1_out', type: 'MODEL', links: null },
        { name: 'model_2', label: 'model_2_out', type: 'MODEL', links: null },
      ],
    });
    const wf = makeWorkflow(
      [placeholder],
      [
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [
            { name: 'model_1', label: 'model_1_in' },
            { name: 'model_2', label: 'model_2_in' },
            { name: 'clip', label: 'clip_in' },
          ],
          outputs: [
            { name: 'model_1', label: 'model_1_out' },
            { name: 'model_2', label: 'model_2_out' },
          ],
        },
      ]
    );

    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'input', 0, 'model_1')).toBe('model_1_in');
    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'input', 1, 'model_2')).toBe('model_2_in');
    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'input', 2, 'clip')).toBe('clip_in');
    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'output', 0, 'model_1')).toBe('model_1_out');
    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'output', 1, 'model_2')).toBe('model_2_out');
  });

  it('falls back to subgraph boundary label when node has no slots in canonical workflow', () => {
    // Placeholder node has no inputs stored in the top-level nodes array,
    // but the subgraph definition has boundary slots with labels.
    const placeholder = makeNode(911, 'sg-backend');
    const wf = makeWorkflow(
      [placeholder],
      [
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [{ name: 'model_1', label: 'model_1_in' }, { name: 'model_2', label: 'model_2_in' }],
          outputs: [{ name: 'model_1', label: 'model_1_out' }],
        },
      ]
    );

    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'input', 0, 'fallback')).toBe('model_1_in');
    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'input', 1, 'fallback')).toBe('model_2_in');
    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'output', 0, 'fallback')).toBe('model_1_out');
  });

  it('resolves labels for placeholder nodes nested inside another subgraph', () => {
    const nestedPlaceholder = makeNode(42, 'sg-backend', {
      inputs: [{ name: 'model_1', label: 'model_1_in', type: 'MODEL', link: null }],
      outputs: [{ name: 'model_1', label: 'model_1_out', type: 'MODEL', links: null }],
    });
    const wf = makeWorkflow(
      [makeNode(1, 'OuterRoot')],
      [
        {
          id: 'sg-outer',
          name: 'Outer',
          nodes: [nestedPlaceholder],
          links: [],
          inputs: [],
          outputs: [],
        },
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [{ name: 'model_1', label: 'model_1_in' }],
          outputs: [{ name: 'model_1', label: 'model_1_out' }],
        },
      ]
    );

    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 42, 'input', 0, 'fallback', 'sg-outer')).toBe('model_1_in');
    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 42, 'output', 0, 'fallback', 'sg-outer')).toBe('model_1_out');
  });

  it('prefers localized_name when label is absent', () => {
    const placeholder = makeNode(911, 'sg-backend', {
      inputs: [{ name: 'model_1', localized_name: 'Model Display', type: 'MODEL', link: null }],
    });
    const wf = makeWorkflow(
      [placeholder],
      [
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [{ name: 'model_1', localized_name: 'Model Display' }],
          outputs: [],
        },
      ]
    );

    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'input', 0, 'fallback')).toBe('Model Display');
  });

  it('uses slot name when no label or localized_name is present', () => {
    const placeholder = makeNode(911, 'sg-backend', {
      inputs: [{ name: 'model_1', type: 'MODEL', link: null }],
      outputs: [{ name: 'model_2', type: 'MODEL', links: null }],
    });
    const wf = makeWorkflow(
      [placeholder],
      [
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [{ name: 'model_1' }],
          outputs: [{ name: 'model_2' }],
        },
      ]
    );

    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'input', 0, 'fallback')).toBe('model_1');
    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'output', 0, 'fallback')).toBe('model_2');
  });

  it('falls back for non-placeholder nodes (no matching subgraph)', () => {
    const regular = makeNode(5, 'KSampler');
    const wf = makeWorkflow([regular]);

    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 5, 'input', 0, 'model_1_in')).toBe('model_1_in');
  });

  it('falls back when slot index is out of range', () => {
    const placeholder = makeNode(911, 'sg-backend', {
      inputs: [{ name: 'model_1', type: 'MODEL', link: null }],
    });
    const wf = makeWorkflow(
      [placeholder],
      [
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [{ name: 'model_1' }],
          outputs: [],
        },
      ]
    );

    expect(resolveSubgraphPlaceholderConnectionLabel(wf, 911, 'input', 4, 'fallback')).toBe('fallback');
  });

  it('returns fallback when canonicalWorkflow is null', () => {
    expect(resolveSubgraphPlaceholderConnectionLabel(null, 911, 'input', 0, 'fallback')).toBe('fallback');
  });
});

describe('resolveWorkflowNodeDisplayName', () => {
  it('uses the subgraph definition name for placeholder nodes without a title', () => {
    const placeholder = makeNode(911, 'sg-backend');
    const wf = makeWorkflow(
      [placeholder],
      [
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [],
          outputs: [],
        },
      ]
    );

    expect(resolveWorkflowNodeDisplayName(wf, placeholder, null)).toBe('Backend');
  });

  it('prefers the authored node title over the subgraph definition name', () => {
    const placeholder = makeNode(911, 'sg-backend', { title: 'User Label' });
    const wf = makeWorkflow(
      [placeholder],
      [
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [],
          outputs: [],
        },
      ]
    );

    expect(resolveWorkflowNodeDisplayName(wf, placeholder, null)).toBe('User Label');
  });
});

describe('findWorkflowNodeInScope', () => {
  it('finds placeholder nodes nested inside subgraphs when scope is provided', () => {
    const nestedPlaceholder = makeNode(42, 'sg-backend', { title: 'Nested Placeholder' });
    const wf = makeWorkflow(
      [makeNode(1, 'OuterRoot')],
      [
        {
          id: 'sg-outer',
          name: 'Outer',
          nodes: [nestedPlaceholder],
          links: [],
          inputs: [],
          outputs: [],
        },
        {
          id: 'sg-backend',
          name: 'Backend',
          nodes: [],
          links: [],
          inputs: [],
          outputs: [],
        },
      ]
    );

    expect(findWorkflowNodeInScope(wf, 42, 'sg-outer')).toEqual(nestedPlaceholder);
  });

  it('keeps root and subgraph node id collisions distinct', () => {
    const rootNode = makeNode(42, 'RootNode', { title: 'Root 42' });
    const nestedNode = makeNode(42, 'InnerNode', { title: 'Inner 42' });
    const wf = makeWorkflow(
      [rootNode],
      [
        {
          id: 'sg-outer',
          name: 'Outer',
          nodes: [nestedNode],
          links: [],
          inputs: [],
          outputs: [],
        },
      ]
    );

    expect(findRootWorkflowNodeById(wf, 42)).toEqual(rootNode);
    expect(findWorkflowNodeInScope(wf, 42, 'sg-outer')).toEqual(nestedNode);
  });
});
