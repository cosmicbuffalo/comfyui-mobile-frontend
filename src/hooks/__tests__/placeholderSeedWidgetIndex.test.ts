import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { findSeedWidgetIndex } from '@/utils/seedUtils';
import { deriveSeedModes, resolveSeedWidgetIndex } from '@/hooks/useWorkflow/seedExpansion';

// A subgraph placeholder's `type` is the subgraph's UUID, so `nodeTypes` has no
// schema for it and a bare findSeedWidgetIndex returns null. Callers that did
// not build the promoted-widget descriptors were therefore correct for ordinary
// nodes and blind for placeholders -- which cost a promoted seed its randomize
// mode on every workflow switch (deriveSeedModes replaces the whole record, and
// a null index contributes nothing to the replacement), and made the
// executed-seed write-back read as a user edit in undo and the queue-card diff.

const nodeTypes: NodeTypes = {
  RandomNoiseLike: {
    input: { required: { noise_seed: ['INT', { min: 0, max: 999999999 }] } },
    output: ['NOISE'],
    output_name: ['NOISE'],
    name: 'RandomNoiseLike',
    display_name: 'RandomNoiseLike',
    description: '',
    python_module: '',
    category: '',
  },
};

function placeholderWorkflow(seedValue: unknown): Workflow {
  const innerNode = {
    id: 15,
    type: 'RandomNoiseLike',
    pos: [0, 0], size: [100, 100], flags: {}, order: 0, mode: 0,
    inputs: [{ name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: 207 }],
    outputs: [{ name: 'NOISE', type: 'NOISE', links: [] }],
    properties: {},
    widgets_values: [0],
  } as unknown as WorkflowNode;

  const placeholder = {
    id: 105,
    type: 'sg-video',
    pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
    inputs: [{ name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: null }],
    outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [] }],
    properties: {},
    widgets_values: [seedValue],
  } as unknown as WorkflowNode;

  return {
    last_node_id: 105, last_link_id: 207,
    nodes: [placeholder], links: [], groups: [], config: {}, version: 0.4,
    definitions: {
      subgraphs: [{
        id: 'sg-video',
        name: 'Video subgraph',
        nodes: [innerNode],
        links: [{ id: 207, origin_id: -10, origin_slot: 0, target_id: 15, target_slot: 0, type: 'INT' }],
        inputs: [{ name: 'noise_seed', type: 'INT', linkIds: [207] }],
        outputs: [],
      }],
    },
  } as unknown as Workflow;
}

describe('resolving a subgraph placeholder\'s seed widget', () => {
  it('BUG SHAPE: the bare lookup cannot see a promoted seed', () => {
    const workflow = placeholderWorkflow(12345);
    const placeholder = workflow.nodes[0];
    // Not a defect in findSeedWidgetIndex -- there is genuinely no schema for a
    // subgraph UUID. It is why callers must supply descriptors.
    expect(findSeedWidgetIndex(workflow, nodeTypes, placeholder)).toBeNull();
  });

  it('resolves the promoted seed through the placeholder descriptors', () => {
    const workflow = placeholderWorkflow(12345);
    const placeholder = workflow.nodes[0];
    expect(resolveSeedWidgetIndex(workflow, nodeTypes, placeholder)).toBe(0);
  });

  it('still resolves an ordinary node the same way', () => {
    const workflow = placeholderWorkflow(12345);
    const inner = workflow.definitions!.subgraphs![0].nodes[0];
    expect(resolveSeedWidgetIndex(workflow, nodeTypes, inner))
      .toBe(findSeedWidgetIndex(workflow, nodeTypes, inner));
  });

  it('leaves a placeholder whose subgraph promotes no seed alone', () => {
    // The descriptors come from the SUBGRAPH definition, not the placeholder's
    // own inputs, so a seedless answer needs a seedless definition.
    const workflow = placeholderWorkflow(12345);
    workflow.definitions!.subgraphs!.push({
      id: 'sg-plain',
      name: 'Plain subgraph',
      nodes: [{
        id: 20,
        type: 'RandomNoiseLike',
        pos: [0, 0], size: [100, 100], flags: {}, order: 0, mode: 0,
        inputs: [{ name: 'steps', type: 'INT', widget: { name: 'steps' }, link: 300 }],
        outputs: [],
        properties: {},
        widgets_values: [20],
      }],
      links: [{ id: 300, origin_id: -10, origin_slot: 0, target_id: 20, target_slot: 0, type: 'INT' }],
      inputs: [{ name: 'steps', type: 'INT', linkIds: [300] }],
      outputs: [],
    } as never);
    const plain = {
      ...workflow.nodes[0], id: 900, type: 'sg-plain',
      inputs: [{ name: 'steps', type: 'INT', widget: { name: 'steps' }, link: null }],
      widgets_values: [20],
    } as unknown as WorkflowNode;
    expect(resolveSeedWidgetIndex(workflow, nodeTypes, plain)).toBeNull();
  });
});

describe('deriveSeedModes across a workflow switch', () => {
  it('keeps a promoted seed\'s randomize mode instead of dropping it', () => {
    // The reported symptom: set randomize on a placeholder seed, open another
    // workflow, come back -- the mode was gone and every run produced the
    // identical image, because loadWorkflow REPLACES the mode record with this
    // derivation and a null index contributed nothing to the replacement.
    const workflow = placeholderWorkflow(-1);
    const modes = deriveSeedModes(workflow, nodeTypes);
    expect(modes[105]).toBe('randomize');
  });

  it('reads a concrete seed as fixed', () => {
    const workflow = placeholderWorkflow(12345);
    const modes = deriveSeedModes(workflow, nodeTypes);
    expect(modes[105] ?? 'fixed').toBe('fixed');
  });
});
