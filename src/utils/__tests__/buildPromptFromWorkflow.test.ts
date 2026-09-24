import { describe, it, expect } from 'vitest';
import { buildPromptFromWorkflow } from '../buildPromptFromWorkflow';
import { getWidgetDefinitions } from '../widgetDefinitions';
import { buildDefaultWidgetValues } from '../workflowInputs';
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

describe('widget values stock sends but a saved workflow does not hold', () => {
  const compareTypes: NodeTypes = {
    ...nodeTypes,
    ImageCompare: {
      input: {
        required: { compare_view: ['IMAGECOMPARE', { socketless: true }] },
        optional: { image_a: ['IMAGE', {}], image_b: ['IMAGE', {}] },
      },
      input_order: { required: ['compare_view'], optional: ['image_a', 'image_b'] },
      output: [],
      output_name: [],
      name: 'ImageCompare',
      display_name: 'Compare Images',
      description: '',
      python_module: '',
      category: '',
    },
    MultiPick: {
      input: {
        required: {
          parts: ['EASY_COMBO', { options: [{ label: 'A', value: 0 }, { label: 'B', value: 1 }], multi_select: {} }],
        },
      },
      input_order: { required: ['parts'], optional: [] },
      output: [],
      output_name: [],
      name: 'MultiPick',
      display_name: 'Multi Pick',
      description: '',
      python_module: '',
      category: '',
    },
  } as NodeTypes;

  // Shaped like the official templates: stock never saves compare_view, so the
  // node's widgets_values is empty.
  function compareWorkflow(): Workflow {
    const base = makeWorkflow('my.png');
    return {
      ...base,
      last_node_id: 3,
      last_link_id: 2,
      nodes: [
        { ...base.nodes[0], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1, 2] }] },
        base.nodes[1],
        makeNode(3, 'ImageCompare', {
          inputs: [
            { name: 'image_a', type: 'IMAGE', link: 2 },
            { name: 'image_b', type: 'IMAGE', link: null },
          ],
          widgets_values: [],
        }),
      ],
      links: [...base.links, [2, 1, 0, 3, 0, 'IMAGE']],
    };
  }

  it('sends ImageCompare\'s required compare_view with the value stock starts it at', () => {
    const prompt = buildPromptFromWorkflow(compareWorkflow(), compareTypes) as Record<string, { inputs: Record<string, unknown> }>;
    // Without it the backend rejects the whole output: "Required input is
    // missing: compare_view".
    expect(prompt['3'].inputs).toEqual({ image_a: ['1', 0], compare_view: { __value__: ['', ''] } });
  });

  it('wraps a list widget value so it is not read as a link', () => {
    const workflow: Workflow = {
      ...makeWorkflow('my.png'),
      nodes: [makeNode(5, 'MultiPick', { widgets_values: [[0, 1]] })],
      links: [],
    };
    const prompt = buildPromptFromWorkflow(workflow, compareTypes) as Record<string, { inputs: Record<string, unknown> }>;
    expect(prompt['5'].inputs.parts).toEqual({ __value__: [0, 1] });
  });

  it('leaves real links as bare [node, slot] pairs', () => {
    const prompt = buildPromptFromWorkflow(compareWorkflow(), compareTypes) as Record<string, { inputs: Record<string, unknown> }>;
    expect(prompt['2'].inputs.images).toEqual(['1', 0]);
  });

  it('gives the unsaved widget no widgets_values slot, so later widgets keep theirs', () => {
    // Stock sets `widget.serialize = false`, so a widget declared after
    // compare_view sits at index 0 of a stock-saved node.
    const types = {
      ...compareTypes,
      CompareWithStrength: {
        ...compareTypes.ImageCompare,
        input: {
          required: {
            compare_view: ['IMAGECOMPARE', { socketless: true }],
            strength: ['FLOAT', { default: 1 }],
          },
        },
        input_order: { required: ['compare_view', 'strength'], optional: [] },
        name: 'CompareWithStrength',
      },
    } as NodeTypes;
    const node = makeNode(7, 'CompareWithStrength', { widgets_values: [0.25] });

    const defs = getWidgetDefinitions(types, node);
    expect(defs.map((d) => [d.name, d.widgetIndex, d.value])).toEqual([['strength', 0, 0.25]]);
    expect(buildDefaultWidgetValues(types.CompareWithStrength)).toEqual([1]);

    const workflow: Workflow = { ...makeWorkflow('my.png'), nodes: [node], links: [] };
    const prompt = buildPromptFromWorkflow(workflow, types) as Record<string, { inputs: Record<string, unknown> }>;
    expect(prompt['7'].inputs).toEqual({ compare_view: { __value__: ['', ''] }, strength: 0.25 });
  });
});
