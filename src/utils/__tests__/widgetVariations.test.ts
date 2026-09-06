import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { DYNAMIC_COMBO_V3 } from '@/utils/workflowInputs';
import {
  applyWidgetVariation,
  formatVariationValue,
  variationOptionsFor,
} from '@/utils/widgetVariations';

function node(id: number, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: 'KSampler',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [0, 'fixed', 20, 8, 'euler', 'normal', 1],
    ...overrides,
  } as WorkflowNode;
}

function workflow(nodes: WorkflowNode[], subgraphs?: unknown[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 1,
    ...(subgraphs ? { definitions: { subgraphs } } : {}),
  } as unknown as Workflow;
}

describe('variationOptionsFor', () => {
  it('returns the options of a legacy array-typed combo', () => {
    expect(variationOptionsFor('COMBO', ['euler', 'dpmpp_2m', 'ddim'])).toEqual([
      'euler',
      'dpmpp_2m',
      'ddim',
    ]);
  });

  it('returns the options of a V3 string-typed combo', () => {
    expect(
      variationOptionsFor('COMBO', { options: ['normal', 'karras', 'beta'] }),
    ).toEqual(['normal', 'karras', 'beta']);
  });

  it('drops duplicates so the same run is not queued twice', () => {
    // Two model folders can hold the same filename, and ComfyUI does not
    // de-duplicate the list it serves.
    expect(variationOptionsFor('COMBO', ['a.safetensors', 'b.safetensors', 'a.safetensors']))
      .toEqual(['a.safetensors', 'b.safetensors']);
  });

  it('refuses a DynamicCombo', () => {
    // Changing one restructures the node's input slots, so writing a bare
    // widgets_values entry would desynchronise the widgets from the inputs.
    expect(variationOptionsFor(DYNAMIC_COMBO_V3, { options: ['a', 'b'] })).toEqual([]);
  });

  it('refuses a multi-select combo, whose value is a list rather than one option', () => {
    expect(variationOptionsFor('COMBO', { options: ['a', 'b'], multiselect: true })).toEqual([]);
    expect(variationOptionsFor('COMBO', { options: ['a', 'b'], multi_select: true })).toEqual([]);
  });

  it('refuses a non-combo widget', () => {
    expect(variationOptionsFor('INT', { default: 20, min: 1, max: 100 })).toEqual([]);
    expect(variationOptionsFor('STRING', { multiline: true })).toEqual([]);
  });
});

describe('formatVariationValue', () => {
  it('passes strings through and stringifies primitives', () => {
    expect(formatVariationValue('dpmpp_2m')).toBe('dpmpp_2m');
    expect(formatVariationValue(3)).toBe('3');
    expect(formatVariationValue(true)).toBe('true');
  });

  it('renders an absent value as empty rather than "undefined"', () => {
    expect(formatVariationValue(undefined)).toBe('');
    expect(formatVariationValue(null)).toBe('');
  });
});

describe('applyWidgetVariation', () => {
  it('sets the target widget and leaves every other value alone', () => {
    const wf = workflow([node(1)]);
    const varied = applyWidgetVariation(
      wf,
      { nodeId: 1, subgraphId: null, widgetIndex: 4 },
      'dpmpp_2m',
    );
    expect(varied?.nodes[0].widgets_values).toEqual([0, 'fixed', 20, 8, 'dpmpp_2m', 'normal', 1]);
  });

  it('does not mutate the source workflow', () => {
    // The variation must never reach the store: the user's widget still reads
    // what it read before they pressed Run variations.
    const wf = workflow([node(1)]);
    applyWidgetVariation(wf, { nodeId: 1, subgraphId: null, widgetIndex: 4 }, 'dpmpp_2m');
    expect(wf.nodes[0].widgets_values).toEqual([0, 'fixed', 20, 8, 'euler', 'normal', 1]);
  });

  it('targets a node inside the named subgraph definition, not the root node sharing its id', () => {
    const wf = workflow(
      [node(1, { widgets_values: ['root-value'] })],
      [{ id: 'sg-1', nodes: [node(1, { widgets_values: ['inner-value'] })] }],
    );
    const varied = applyWidgetVariation(
      wf,
      { nodeId: 1, subgraphId: 'sg-1', widgetIndex: 0 },
      'changed',
    );
    expect(varied?.definitions?.subgraphs?.[0].nodes[0].widgets_values).toEqual(['changed']);
    expect(varied?.nodes[0].widgets_values).toEqual(['root-value']);
  });

  it('returns null when the node is gone', () => {
    expect(
      applyWidgetVariation(workflow([node(1)]), { nodeId: 99, subgraphId: null, widgetIndex: 0 }, 'x'),
    ).toBeNull();
  });

  it('returns null when the widget index is out of range', () => {
    // Better to skip the run than to queue one that silently kept the old value.
    expect(
      applyWidgetVariation(workflow([node(1)]), { nodeId: 1, subgraphId: null, widgetIndex: 99 }, 'x'),
    ).toBeNull();
  });
});
