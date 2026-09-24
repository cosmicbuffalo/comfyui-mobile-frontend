import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { resolveSubgraphPlaceholderWidgetDefs } from '@/utils/widgetDefinitions';

/**
 * A placeholder that holds no value for a promoted widget -- official templates
 * ship `widgets_values: []` -- runs the inner widget's own value. Stock seeds
 * the host widget from its interior widget in exactly that case, so that value
 * is what the card has to show, not an empty field.
 */

const NODE_TYPES = {
  KSampler: {
    input: {
      required: {
        seed: ['INT', { default: 0, min: 0, max: 4294967295 }],
        steps: ['INT', { default: 20, min: 1, max: 10000 }],
        cfg: ['FLOAT', { default: 8, min: 0, max: 100 }],
      },
      optional: {},
    },
    input_order: { required: ['seed', 'steps', 'cfg'], optional: [] },
    output: ['LATENT'],
    output_name: ['LATENT'],
    name: 'KSampler',
    display_name: 'KSampler',
    description: '',
    python_module: '',
    category: 'test',
  },
} as unknown as NodeTypes;

function sampler(id: number, links: { steps?: number; cfg?: number }) {
  return {
    id,
    type: 'KSampler',
    pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
    inputs: [
      { name: 'steps', type: 'INT', widget: { name: 'steps' }, link: links.steps ?? null },
      { name: 'cfg', type: 'FLOAT', widget: { name: 'cfg' }, link: links.cfg ?? null },
    ],
    outputs: [],
    properties: {},
    widgets_values: [1234, 'fixed', 27, 6.5],
  } as unknown as WorkflowNode;
}

function placeholder(id: number, type: string, values: unknown[], links: [number | null, number | null] = [null, null]) {
  return {
    id,
    type,
    pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
    inputs: [
      { name: 'steps', type: 'INT', widget: { name: 'steps' }, link: links[0] },
      { name: 'cfg', type: 'FLOAT', widget: { name: 'cfg' }, link: links[1] },
    ],
    outputs: [],
    properties: {},
    widgets_values: values,
  } as unknown as WorkflowNode;
}

const boundary = (a: number, b: number) => [
  { name: 'steps', type: 'INT', linkIds: [a] },
  { name: 'cfg', type: 'FLOAT', linkIds: [b] },
];

function flat(values: unknown[], hostLinks: [number | null, number | null] = [null, null]): Workflow {
  return {
    last_node_id: 100, last_link_id: 900,
    nodes: [placeholder(100, 'sg-inner', values, hostLinks)],
    links: [], groups: [], config: {}, version: 0.4,
    definitions: {
      subgraphs: [{
        id: 'sg-inner',
        name: 'Inner',
        nodes: [sampler(10, { steps: 501, cfg: 502 })],
        links: [
          { id: 501, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
          { id: 502, origin_id: -10, origin_slot: 1, target_id: 10, target_slot: 1, type: 'FLOAT' },
        ],
        inputs: boundary(501, 502),
        outputs: [],
      }],
    },
  } as unknown as Workflow;
}

/** sg-outer holds a placeholder of sg-inner whose own values are `middle`. */
function nested(outerValues: unknown[], middle: unknown[]): Workflow {
  const inner = flat([]).definitions!.subgraphs![0];
  return {
    last_node_id: 200, last_link_id: 900,
    nodes: [placeholder(200, 'sg-outer', outerValues)],
    links: [], groups: [], config: {}, version: 0.4,
    definitions: {
      subgraphs: [
        {
          id: 'sg-outer',
          name: 'Outer',
          nodes: [placeholder(50, 'sg-inner', middle, [601, 602])],
          links: [
            { id: 601, origin_id: -10, origin_slot: 0, target_id: 50, target_slot: 0, type: 'INT' },
            { id: 602, origin_id: -10, origin_slot: 1, target_id: 50, target_slot: 1, type: 'FLOAT' },
          ],
          inputs: boundary(601, 602),
          outputs: [],
        },
        inner,
      ],
    },
  } as unknown as Workflow;
}

const valuesOf = (workflow: Workflow) => Object.fromEntries(
  resolveSubgraphPlaceholderWidgetDefs(workflow.nodes[0], workflow, NODE_TYPES)
    .map((widget) => [widget.name, widget.value]),
);

describe('the value a promoted widget shows when its placeholder holds none', () => {
  it('shows the inner widget\'s own values for an empty placeholder', () => {
    expect(valuesOf(flat([]))).toMatchObject({ steps: 27, cfg: 6.5 });
  });

  it('fills only the slots the placeholder does not hold', () => {
    // A short array holds steps and not cfg.
    expect(valuesOf(flat([40]))).toMatchObject({ steps: 40, cfg: 6.5 });
  });

  it('keeps the placeholder\'s own value when it has one', () => {
    expect(valuesOf(flat([40, 3.5]))).toMatchObject({ steps: 40, cfg: 3.5 });
  });

  it('reads a null entry as no value, as the prompt does', () => {
    // Mobile's own writes pad slots with null, and building the prompt skips
    // null, so the inner value is the one that runs.
    expect(valuesOf(flat([null, 3.5]))).toMatchObject({ steps: 27, cfg: 3.5 });
  });

  it('takes a nested placeholder\'s own value before the innermost widget\'s', () => {
    expect(valuesOf(nested([], [33, 1.5]))).toMatchObject({ steps: 33, cfg: 1.5 });
  });

  it('falls through a nested placeholder that holds none to the innermost widget', () => {
    expect(valuesOf(nested([], []))).toMatchObject({ steps: 27, cfg: 6.5 });
  });
});
