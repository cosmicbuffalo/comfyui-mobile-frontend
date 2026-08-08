import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import {
  cloneWithImage,
  isLoadImageType,
  sourceFromId,
  targetKey,
} from '../bulkProcess';

function makeNode(id: number, type: string, widgets: unknown[]): WorkflowNode {
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
    widgets_values: widgets,
  } as unknown as WorkflowNode;
}

const nodeTypes = {
  LoadImage: {
    input: {
      required: { image: [['a.png', 'b.png'], {}], upload: ['IMAGEUPLOAD', {}] },
      optional: {},
    },
    output: ['IMAGE', 'MASK'],
    output_name: ['IMAGE', 'MASK'],
    name: 'LoadImage',
    display_name: 'Load Image',
    description: '',
    python_module: '',
    category: 'image',
  },
} as unknown as NodeTypes;

function makeWorkflow(nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 1,
  } as unknown as Workflow;
}

describe('isLoadImageType', () => {
  it('matches the naming variants custom nodes use', () => {
    expect(isLoadImageType('LoadImage')).toBe(true);
    expect(isLoadImageType('LoadImageMask')).toBe(true);
    expect(isLoadImageType('Load Image (Advanced)')).toBe(true);
    expect(isLoadImageType('load_image_from_dir')).toBe(true);
  });

  it('does not match unrelated nodes', () => {
    expect(isLoadImageType('SaveImage')).toBe(false);
    expect(isLoadImageType('PreviewImage')).toBe(false);
    expect(isLoadImageType('KSampler')).toBe(false);
  });
});

describe('sourceFromId', () => {
  it('reads the source off the file id, defaulting to output', () => {
    expect(sourceFromId('input/staged.png')).toBe('input');
    expect(sourceFromId('temp/scratch.png')).toBe('temp');
    expect(sourceFromId('output/run/a.png')).toBe('output');
    expect(sourceFromId('loose.png')).toBe('output');
  });
});

describe('targetKey', () => {
  it('distinguishes same-id nodes in different scopes', () => {
    const node = makeNode(3, 'LoadImage', ['a.png']);
    expect(targetKey({ node, subgraphId: null })).toBe('root:3');
    expect(targetKey({ node, subgraphId: 'sg-1' })).toBe('sg-1:3');
    expect(targetKey({ node, subgraphId: null })).not.toBe(
      targetKey({ node, subgraphId: 'sg-1' }),
    );
  });
});

describe('cloneWithImage', () => {
  it('sets the image on the chosen node without touching the original', () => {
    const workflow = makeWorkflow([makeNode(1, 'LoadImage', ['a.png', 'image'])]);

    const clone = cloneWithImage(
      workflow,
      nodeTypes,
      { node: workflow.nodes[0], subgraphId: null },
      'chosen.png',
    );

    expect((clone!.nodes[0].widgets_values as unknown[])[0]).toBe('chosen.png');
    // Each queued run is built from a fresh clone; mutating the source would
    // make every later image inherit the previous one's value.
    expect((workflow.nodes[0].widgets_values as unknown[])[0]).toBe('a.png');
  });

  it('leaves the node\'s other widget values alone', () => {
    const workflow = makeWorkflow([makeNode(1, 'LoadImage', ['a.png', 'image'])]);

    const clone = cloneWithImage(
      workflow,
      nodeTypes,
      { node: workflow.nodes[0], subgraphId: null },
      'chosen.png',
    );

    expect(clone!.nodes[0].widgets_values).toEqual(['chosen.png', 'image']);
  });

  it('reaches a LoadImage node inside a subgraph definition', () => {
    const inner = makeNode(7, 'LoadImage', ['inner.png']);
    const workflow = {
      ...makeWorkflow([makeNode(1, 'KSampler', [])]),
      definitions: { subgraphs: [{ id: 'sg-1', name: 'Sub', nodes: [inner], links: [] }] },
    } as unknown as Workflow;

    const clone = cloneWithImage(
      workflow,
      nodeTypes,
      { node: inner, subgraphId: 'sg-1' },
      'chosen.png',
    );

    expect((clone!.definitions!.subgraphs![0].nodes[0].widgets_values as unknown[])[0]).toBe('chosen.png');
  });

  it('returns null when the node is gone from the workflow', () => {
    const workflow = makeWorkflow([makeNode(1, 'LoadImage', ['a.png'])]);
    const missing = makeNode(99, 'LoadImage', ['a.png']);

    expect(
      cloneWithImage(workflow, nodeTypes, { node: missing, subgraphId: null }, 'x.png'),
    ).toBeNull();
  });

  it('returns null when the node has no image widget to set', () => {
    // Caller turns this into a per-item failure rather than queueing a run that
    // would silently use whatever image the saved workflow had.
    const workflow = makeWorkflow([makeNode(1, 'KSampler', [1, 2])]);

    expect(
      cloneWithImage(workflow, nodeTypes, { node: workflow.nodes[0], subgraphId: null }, 'x.png'),
    ).toBeNull();
  });
});
