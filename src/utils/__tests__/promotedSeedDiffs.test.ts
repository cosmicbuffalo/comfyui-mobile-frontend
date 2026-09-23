import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { nonSeedWidgetsDiffer } from '@/utils/workflowDiff';
import { diffWorkflowChange } from '@/utils/workflowUndoDiff';

/**
 * Queue time writes back EVERY promoted value whose interior widget carries a
 * control_after_generate, not just the first seed a placeholder exposes. The
 * diffs that decide "did the user change something" must therefore ignore all
 * of them: otherwise a run that re-rolls the second seed reads as a user edit
 * in undo, and as a non-seed change that advances the queue diff's base.
 */

function samplerType(seedInput: string): NodeTypes[string] {
  return {
    input: {
      required: {
        [seedInput]: ['INT', { default: 0, min: 0, max: 4294967295 }],
        steps: ['INT', { default: 20, min: 1, max: 10000 }],
      },
      optional: {},
    },
    input_order: { required: [seedInput, 'steps'], optional: [] },
    output: ['LATENT'],
    output_name: ['LATENT'],
    name: seedInput,
    display_name: seedInput,
    description: '',
    python_module: '',
    category: 'test',
  } as unknown as NodeTypes[string];
}

const NODE_TYPES: NodeTypes = {
  KSampler: samplerType('seed'),
  KSamplerAdvanced: samplerType('noise_seed'),
};

function inner(id: number, type: string, seedInput: string, link: number) {
  return {
    id, type,
    pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
    inputs: [{ name: seedInput, type: 'INT', widget: { name: seedInput }, link }],
    outputs: [],
    properties: {},
    widgets_values: [0, 'randomize', 20],
  };
}

/** A placeholder promoting [seed, noise_seed, steps]; both seeds randomize. */
function workflow(values: unknown[]): Workflow {
  const placeholder = {
    id: 100,
    type: 'sg-two',
    pos: [0, 0], size: [320, 200], flags: {}, order: 0, mode: 0,
    inputs: [
      { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: null },
      { name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: null },
      { name: 'steps', type: 'INT', widget: { name: 'steps' }, link: null },
    ],
    outputs: [],
    properties: {},
    widgets_values: values,
  } as unknown as WorkflowNode;
  return {
    last_node_id: 100, last_link_id: 503,
    nodes: [placeholder],
    links: [], groups: [], config: {}, version: 0.4,
    definitions: {
      subgraphs: [{
        id: 'sg-two',
        name: 'Two samplers',
        nodes: [inner(10, 'KSampler', 'seed', 501), inner(11, 'KSamplerAdvanced', 'noise_seed', 502)],
        links: [
          { id: 501, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
          { id: 502, origin_id: -10, origin_slot: 1, target_id: 11, target_slot: 0, type: 'INT' },
          { id: 503, origin_id: -10, origin_slot: 2, target_id: 10, target_slot: 2, type: 'INT' },
        ],
        inputs: [
          { name: 'seed', type: 'INT', linkIds: [501] },
          { name: 'noise_seed', type: 'INT', linkIds: [502] },
          { name: 'steps', type: 'INT', linkIds: [503] },
        ],
        outputs: [],
      }],
    },
  } as unknown as Workflow;
}

describe('diffs over a placeholder with two promoted seeds', () => {
  const before = workflow([1111, 2222, 20]);

  it('does not count a re-rolled second seed as a user edit in undo', () => {
    const diff = diffWorkflowChange(before, workflow([1111, 9999, 20]), NODE_TYPES);
    expect(diff.changedNodeIds).toEqual([]);
  });

  it('does not count both seeds re-rolling as a user edit in undo', () => {
    const diff = diffWorkflowChange(before, workflow([5555, 9999, 20]), NODE_TYPES);
    expect(diff.changedNodeIds).toEqual([]);
  });

  it('still reports a real edit beside the seeds', () => {
    const diff = diffWorkflowChange(before, workflow([1111, 9999, 30]), NODE_TYPES);
    expect(diff.changedNodeIds).toEqual([100]);
  });

  it('does not treat a re-rolled second seed as a non-seed change for the queue diff', () => {
    expect(nonSeedWidgetsDiffer(before, workflow([1111, 9999, 20]), NODE_TYPES)).toBe(false);
  });

  it('still sees a non-seed change for the queue diff', () => {
    expect(nonSeedWidgetsDiffer(before, workflow([1111, 2222, 30]), NODE_TYPES)).toBe(true);
  });
});
