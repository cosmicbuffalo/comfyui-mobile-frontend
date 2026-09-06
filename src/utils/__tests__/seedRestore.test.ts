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
