import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import { resolveRerouteConnectionLabel } from '../rerouteLabels';

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
    ...overrides
  };
}

function makeWorkflow(nodes: WorkflowNode[], links: WorkflowLink[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: Math.max(0, ...links.map((l) => l[0])),
    nodes,
    links,
    groups: [],
    config: {},
    version: 1
  };
}

describe('resolveRerouteConnectionLabel', () => {
  it('uses immediate endpoint labels per side when both sides are connected', () => {
    const upstream = makeNode(1, 'ImageSource', {
      outputs: [{ name: 'image', type: 'IMAGE', links: [1] }]
    });
    const reroute = makeNode(2, 'Reroute', {
      inputs: [{ name: '*', type: 'IMAGE', link: 1 }],
      outputs: [{ name: '*', type: 'IMAGE', links: [2] }]
    });
    const downstream = makeNode(3, 'PreviewImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: 2 }]
    });
    const wf = makeWorkflow(
      [upstream, reroute, downstream],
      [
        [1, 1, 0, 2, 0, 'IMAGE'],
        [2, 2, 0, 3, 0, 'IMAGE']
      ]
    );

    expect(resolveRerouteConnectionLabel(wf, 2, 'input', 'fallback')).toBe('image');
    expect(resolveRerouteConnectionLabel(wf, 2, 'output', 'fallback')).toBe('images');
  });

  it('uses immediate upstream output label (no bypass traversal)', () => {
    const upstream = makeNode(1, 'KSampler', {
      mode: 4,
      outputs: [{ name: 'latent', type: 'LATENT', links: [1] }]
    });
    const reroute = makeNode(2, 'Reroute', {
      inputs: [{ name: '*', type: 'LATENT', link: 1 }],
      outputs: [{ name: '*', type: 'LATENT', links: null }]
    });
    const wf = makeWorkflow([upstream, reroute], [[1, 1, 0, 2, 0, 'LATENT']]);

    const label = resolveRerouteConnectionLabel(wf, 2, 'output', 'fallback');
    expect(label).toBe('latent');
  });

  it('uses downstream label and falls back across sides when only one side exists', () => {
    const reroute = makeNode(2, 'Reroute', {
      inputs: [{ name: '*', type: 'IMAGE', link: null }],
      outputs: [{ name: '*', type: 'IMAGE', links: [2] }]
    });
    const preview = makeNode(3, 'PreviewImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: 2 }]
    });
    const wf = makeWorkflow([reroute, preview], [[2, 2, 0, 3, 0, 'IMAGE']]);

    expect(resolveRerouteConnectionLabel(wf, 2, 'input', 'fallback')).toBe('images');
    expect(resolveRerouteConnectionLabel(wf, 2, 'output', 'fallback')).toBe('images');
  });

  it('joins unique downstream labels when reroute fans out to multiple destinations', () => {
    const upstream = makeNode(1, 'ImageSource', {
      outputs: [{ name: 'image', type: 'IMAGE', links: [1] }]
    });
    const reroute = makeNode(2, 'Reroute', {
      inputs: [{ name: '*', type: 'IMAGE', link: 1 }],
      outputs: [{ name: '*', type: 'IMAGE', links: [2, 3, 4] }]
    });
    const preview = makeNode(3, 'PreviewImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: 2 }]
    });
    const save = makeNode(4, 'SaveImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: 3 }]
    });
    const custom = makeNode(5, 'CustomNode', {
      inputs: [{ name: 'mask', type: 'IMAGE', link: 4 }]
    });
    const wf = makeWorkflow(
      [upstream, reroute, preview, save, custom],
      [
        [1, 1, 0, 2, 0, 'IMAGE'],
        [2, 2, 0, 3, 0, 'IMAGE'],
        [3, 2, 0, 4, 0, 'IMAGE'],
        [4, 2, 0, 5, 0, 'IMAGE']
      ]
    );

    expect(resolveRerouteConnectionLabel(wf, 2, 'input', 'fallback')).toBe('images/\nmask');
    expect(resolveRerouteConnectionLabel(wf, 2, 'output', 'fallback')).toBe('images/\nmask');
  });
});
