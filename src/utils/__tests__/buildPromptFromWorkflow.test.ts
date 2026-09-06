import { describe, it, expect } from 'vitest';
import { buildPromptFromWorkflow } from '../buildPromptFromWorkflow';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';

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

// A minimal but realistic graph: LoadImage -> SaveImage.
function makeWorkflow(imageValue: string): Workflow {
  return {
    last_node_id: 2,
    last_link_id: 1,
    nodes: [
      makeNode(1, 'LoadImage', {
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
        widgets_values: [imageValue],
      }),
      makeNode(2, 'SaveImage', {
        inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
        widgets_values: ['ComfyUI'],
      }),
    ],
    links: [[1, 1, 0, 2, 0, 'IMAGE']],
    groups: [],
    config: {},
    version: 1,
  };
}

const nodeTypes: NodeTypes = {
  LoadImage: {
    input: {
      required: {
        // Combo of available input files; both candidate values are valid members
        // so normalization keeps whichever is set.
        image: [['my.png', 'other.png'], {}],
      },
    },
    input_order: { required: ['image'], optional: [] },
    output: ['IMAGE', 'MASK'],
    output_name: ['IMAGE', 'MASK'],
    name: 'LoadImage',
    display_name: 'Load Image',
    description: '',
    python_module: '',
    category: '',
  },
  SaveImage: {
    input: {
      required: {
        images: ['IMAGE', {}],
        filename_prefix: ['STRING', { default: 'ComfyUI' }],
      },
    },
    input_order: { required: ['images', 'filename_prefix'], optional: [] },
    output: [],
    output_name: [],
    name: 'SaveImage',
    display_name: 'Save Image',
    description: '',
    python_module: '',
    category: '',
  },
};

describe('buildPromptFromWorkflow', () => {
  it('converts a workflow into the ComfyUI prompt map', () => {
    const prompt = buildPromptFromWorkflow(makeWorkflow('my.png'), nodeTypes) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;

    expect(prompt['1']).toEqual({
      class_type: 'LoadImage',
      inputs: { image: 'my.png' },
    });
    expect(prompt['2'].class_type).toBe('SaveImage');
    // Connected input becomes a [sourceKey, slot] tuple; widget stays inline.
    expect(prompt['2'].inputs.images).toEqual(['1', 0]);
    expect(prompt['2'].inputs.filename_prefix).toBe('ComfyUI');
  });

  it('swapping the LoadImage widget changes only that node input', () => {
    const before = buildPromptFromWorkflow(makeWorkflow('my.png'), nodeTypes) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    const after = buildPromptFromWorkflow(makeWorkflow('other.png'), nodeTypes) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;

    expect(before['1'].inputs.image).toBe('my.png');
    expect(after['1'].inputs.image).toBe('other.png');
    // The downstream SaveImage node is untouched by the image swap.
    expect(after['2']).toEqual(before['2']);
  });
});

describe('inert nodes (mute / bypass)', () => {
  // ComfyUI's graphToPrompt skips both LGraphEventMode.NEVER (2) and BYPASS (4)
  // before serializing, and a muted node produces no output for consumers.
  function makeGraph(loaderMode: number): Workflow {
    const wf = makeWorkflow('my.png');
    wf.nodes[0].mode = loaderMode;
    return wf;
  }

  it('drops a muted node and the input that consumed it', () => {
    const prompt = buildPromptFromWorkflow(makeGraph(2), nodeTypes) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;

    expect(prompt['1']).toBeUndefined();
    expect(prompt['2']).toBeDefined();
    expect(prompt['2'].inputs.images).toBeUndefined();
  });

  it('drops a bypassed node the same way', () => {
    const prompt = buildPromptFromWorkflow(makeGraph(4), nodeTypes) as Record<string, unknown>;

    expect(prompt['1']).toBeUndefined();
    expect(prompt['2']).toBeDefined();
  });

  it('keeps an active node', () => {
    const prompt = buildPromptFromWorkflow(makeGraph(0), nodeTypes) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;

    expect(prompt['1']).toBeDefined();
    expect(prompt['2'].inputs.images).toEqual(['1', 0]);
  });
});
