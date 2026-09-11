import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { restoreExecutedSeedWidgets } from '@/utils/seedRestore';

function node(id: number, type: string, widgetsValues: unknown[]): WorkflowNode {
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
    widgets_values: widgetsValues,
  };
}

function workflow(nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: 100,
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 0.4,
  };
}

const nodeTypes: NodeTypes = {
  KSampler: {
    name: 'KSampler',
    display_name: 'KSampler',
    description: '',
    python_module: '',
    category: '',
    input: {
      required: {
        seed: ['INT', {}],
        steps: ['INT', {}],
      },
    },
    input_order: { required: ['seed', 'steps'] },
    output: [],
  },
  CustomMultiSeed: {
    name: 'CustomMultiSeed',
    display_name: 'Custom Multi Seed',
    description: '',
    python_module: '',
    category: '',
    input: {
      required: {
        strength: ['FLOAT', {}],
        variation_seed: ['INT', {}],
        noise_seed: ['INT', {}],
      },
    },
    input_order: { required: ['strength', 'variation_seed', 'noise_seed'] },
    output: [],
  },
  'Seed (rgthree)': {
    name: 'Seed (rgthree)',
    display_name: 'Seed (rgthree)',
    description: '',
    python_module: '',
    category: '',
    input: { required: { seed: ['INT', {}] } },
    output: ['INT'],
  },
};

function promptNode(classType: string, inputs: Record<string, unknown>) {
  return { class_type: classType, inputs };
}

describe('restoreExecutedSeedWidgets', () => {
  it('replaces a KSampler -1 with its concrete executed seed', () => {
    const original = workflow([node(7, 'KSampler', [-1, 'randomize', 20])]);
    const restored = restoreExecutedSeedWidgets(original, {
      '7': promptNode('KSampler', { seed: 123456, steps: 20 }),
    }, nodeTypes);

    expect(restored.nodes[0].widgets_values).toEqual([123456, 'randomize', 20]);
    expect(original.nodes[0].widgets_values).toEqual([-1, 'randomize', 20]);
  });

  it('restores every -1 seed-named INT widget on a custom node', () => {
    const original = workflow([
      node(8, 'Custom Multi Seed', [0.5, -1, -1, 'randomize']),
    ]);
    const restored = restoreExecutedSeedWidgets(original, {
      '8': promptNode('CustomMultiSeed', {
        strength: 0.5,
        variation_seed: 111,
        noise_seed: 222,
      }),
    }, nodeTypes);

    expect(restored.nodes[0].widgets_values).toEqual([0.5, 111, 222, 'randomize']);
  });

  it('keeps fixed values and connected prompt seeds unchanged', () => {
    const fixed = workflow([node(7, 'KSampler', [42, 'fixed', 20])]);
    expect(restoreExecutedSeedWidgets(fixed, {
      '7': promptNode('KSampler', { seed: 123 }),
    }, nodeTypes)).toBe(fixed);

    const connected = workflow([node(7, 'KSampler', [-1, 'randomize', 20])]);
    expect(restoreExecutedSeedWidgets(connected, {
      '7': promptNode('KSampler', { seed: ['2', 0] }),
    }, nodeTypes)).toBe(connected);
  });

  it('continues to restore rgthree seed nodes', () => {
    const original = workflow([node(7, 'Seed (rgthree)', [-1])]);
    const restored = restoreExecutedSeedWidgets(original, {
      prompt: { '7': promptNode('Seed (rgthree)', { seed: 8080 }) },
      client_id: 'client',
    }, nodeTypes);
    expect(restored.nodes[0].widgets_values).toEqual([8080]);
  });

  it('restores a seed inside a subgraph definition', () => {
    const original: Workflow = {
      ...workflow([]),
      definitions: {
        subgraphs: [{
          id: 'subgraph-a',
          nodes: [node(7, 'KSampler', [-1, 'randomize', 20])],
          links: [],
        }],
      },
    };
    const restored = restoreExecutedSeedWidgets(original, {
      '50:7': promptNode('KSampler', { seed: 9001, steps: 20 }),
    }, nodeTypes);
    expect(restored.definitions?.subgraphs?.[0].nodes[0].widgets_values)
      .toEqual([9001, 'randomize', 20]);
  });

  it('restores a seed promoted onto a subgraph placeholder from the run inside it', () => {
    // The placeholder is not a node in the executed prompt — it expands away —
    // and the value the card shows lives in the PLACEHOLDER's widgets_values,
    // not in the definition's. So neither of the lookups a real node uses can
    // reach it; the boundary input's name is what ties the two together.
    const original: Workflow = {
      ...workflow([
        node(50, 'subgraph-a', [-1, 20]),
      ]),
      definitions: {
        subgraphs: [{
          id: 'subgraph-a',
          inputs: [
            { name: 'seed', type: 'INT', linkIds: [207] },
            { name: 'steps', type: 'INT' },
          ],
          nodes: [{ ...node(7, 'KSampler', [-1, 'randomize', 20]), inputs: [{ name: 'seed', type: 'INT', link: 207, widget: { name: 'seed' } }] }],
          links: [{ id: 207, origin_id: -10, origin_slot: 0, target_id: 7, target_slot: 0, type: 'INT' }],
        }],
      },
    } as Workflow;

    const restored = restoreExecutedSeedWidgets(original, {
      '50:7': promptNode('KSampler', { seed: 4242, steps: 20 }),
    }, nodeTypes);

    expect(restored.nodes[0].widgets_values).toEqual([4242, 20]);
    // Untouched: writing the shared definition would restore nothing anyone can
    // see on this card, and would write through every other instance too.
    expect(original.nodes[0].widgets_values).toEqual([-1, 20]);
  });

  it('leaves a placeholder seed alone when the nodes inside it disagreed', () => {
    const original: Workflow = {
      ...workflow([node(50, 'subgraph-a', [-1])]),
      definitions: {
        subgraphs: [{
          id: 'subgraph-a',
          inputs: [{ name: 'seed', type: 'INT', linkIds: [207, 208] }],
          nodes: [7, 8].map((id) => ({ ...node(id, 'KSampler', [-1, 'randomize', 20]), inputs: [{ name: 'seed', type: 'INT', link: 200 + id, widget: { name: 'seed' } }] })),
          links: [7, 8].map((id) => ({ id: 200 + id, origin_id: -10, origin_slot: 0, target_id: id, target_slot: 0, type: 'INT' })),
        }],
      },
    } as Workflow;

    const restored = restoreExecutedSeedWidgets(original, {
      '50:7': promptNode('KSampler', { seed: 1 }),
      '50:8': promptNode('KSampler', { seed: 2 }),
    }, nodeTypes);

    expect(restored.nodes[0].widgets_values).toEqual([-1]);
  });

  it('leaves a subgraph sentinel intact when instances used different seeds', () => {
    const original: Workflow = {
      ...workflow([]),
      definitions: {
        subgraphs: [{
          id: 'subgraph-a',
          nodes: [node(7, 'KSampler', [-1, 'randomize', 20])],
          links: [],
        }],
      },
    };
    const restored = restoreExecutedSeedWidgets(original, {
      '50:7': promptNode('KSampler', { seed: 1 }),
      '60:7': promptNode('KSampler', { seed: 2 }),
    }, nodeTypes);
    expect(restored).toBe(original);
  });
});
it('follows boundary link when its public name differs from the target', () => {
  const target = node(7, 'CustomMultiSeed', [0.5, 0, 0]);
  target.inputs = [{ name: 'noise_seed', type: 'INT', link: 207, widget: {name: 'noise_seed'} }];
  const original = {
    ...workflow([node(50, 'subgraph-a', [-1])]),
    definitions: { subgraphs: [{
      id: 'subgraph-a',
      inputs: [{ name: 'seed', type: 'INT', linkIds: [207] }],
      nodes: [target, node(8, 'KSampler', [999, 'fixed', 20])],
      links: [{id: 207, origin_id: -10, origin_slot: 0, target_id: 7, target_slot: 0, type: 'INT'}],
    }] },
  } as Workflow;
  const restored = restoreExecutedSeedWidgets(original, {
    '50:7': promptNode('CustomMultiSeed', { noise_seed: 123 }),
    '50:8': promptNode('KSampler', { seed: 999 }),
  }, nodeTypes);
  expect(restored.nodes[0].widgets_values).toEqual([123]);
});

it('restores nested boundaries without mixing same-numbered root and nested instances', () => {
  const inner = { ...node(7, 'KSampler', [0, 'fixed', 20]), inputs: [{ name: 'seed', type: 'INT', link: 207, widget: { name: 'seed' } }] };
  const nested = { ...node(50, 'inner', [-1]), inputs: [{ name: 'seed', type: 'INT', link: 208, widget: { name: 'seed' } }] };
  const original: Workflow = {
    ...workflow([node(50, 'inner', [-1]), node(80, 'outer', [-1])]),
    definitions: { subgraphs: [
      { id: 'inner', inputs: [{ name: 'seed', type: 'INT', linkIds: [207] }], nodes: [inner],
        links: [{ id: 207, origin_id: -10, origin_slot: 0, target_id: 7, target_slot: 0, type: 'INT' }] },
      { id: 'outer', inputs: [{ name: 'seed', type: 'INT', linkIds: [208] }], nodes: [nested],
        links: [{ id: 208, origin_id: -10, origin_slot: 0, target_id: 50, target_slot: 0, type: 'INT' }] },
    ] },
  };
  const restored = restoreExecutedSeedWidgets(original, {
    '50:7': promptNode('KSampler', { seed: 123 }),
    '80:50:7': promptNode('KSampler', { seed: 456 }),
  }, nodeTypes);
  expect(restored.nodes.map((entry) => entry.widgets_values)).toEqual([[123], [456]]);
  expect(restored.definitions?.subgraphs?.[1].nodes[0].widgets_values).toEqual([456]);
});
