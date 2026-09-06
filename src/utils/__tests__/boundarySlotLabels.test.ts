import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import {
  collectDivergentInstanceLabels,
  collectSubgraphInstances,
  getInstanceSlotLabel,
  resolveBoundarySlotLabel,
} from '../boundarySlotLabels';

const SG = 'sg-a';

const def: WorkflowSubgraphDefinition = {
  id: SG,
  name: 'Styler',
  inputs: [
    { id: 'i1', name: 'text', type: 'STRING', label: 'Prompt {n}' },
    { id: 'i2', name: 'seed', type: 'INT', localized_name: 'Seed' },
    { id: 'i3', name: 'bare', type: 'INT' },
  ],
  outputs: [{ id: 'o1', name: 'result', type: 'IMAGE' }],
  nodes: [],
  links: [],
};

function instance(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type: SG,
    pos: [0, 0],
    size: [10, 10],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  } as WorkflowNode;
}

describe('resolveBoundarySlotLabel', () => {
  it('falls back through label, localized name, then raw name', () => {
    const node = instance(1);
    expect(resolveBoundarySlotLabel(def, node, 'input', 0)).toBe('Prompt');
    expect(resolveBoundarySlotLabel(def, node, 'input', 1)).toBe('Seed');
    expect(resolveBoundarySlotLabel(def, node, 'input', 2)).toBe('bare');
    expect(resolveBoundarySlotLabel(def, node, 'output', 0)).toBe('result');
  });

  it('interpolates {n} with the instance number', () => {
    const node = instance(1, { properties: { mobileInstanceNumber: 3 } });
    expect(resolveBoundarySlotLabel(def, node, 'input', 0)).toBe('Prompt 3');
  });

  it('lets an instance override beat the type label', () => {
    const node = instance(1, {
      properties: { mobileSlotLabels: { 'input:text': 'Negative' } },
    });
    expect(resolveBoundarySlotLabel(def, node, 'input', 0)).toBe('Negative');
    // Other slots on the same instance are untouched.
    expect(resolveBoundarySlotLabel(def, node, 'input', 1)).toBe('Seed');
  });

  it('interpolates {n} in an instance override too', () => {
    const node = instance(1, {
      properties: { mobileInstanceNumber: 2, mobileSlotLabels: { 'input:text': 'Style {n}' } },
    });
    expect(resolveBoundarySlotLabel(def, node, 'input', 0)).toBe('Style 2');
  });

  it('keys overrides by slot name, so they survive a slot being removed', () => {
    const node = instance(1, {
      properties: { mobileSlotLabels: { 'input:seed': 'Noise' } },
    });
    // 'seed' moved from index 1 to index 0 when the slot before it went.
    const shorter: WorkflowSubgraphDefinition = { ...def, inputs: def.inputs!.slice(1) };
    expect(resolveBoundarySlotLabel(shorter, node, 'input', 0)).toBe('Noise');
  });

  it('does not let an input override leak onto the output of the same name', () => {
    const node = instance(1, {
      properties: { mobileSlotLabels: { 'input:result': 'Wrong' } },
    });
    expect(resolveBoundarySlotLabel(def, node, 'output', 0)).toBe('result');
    expect(getInstanceSlotLabel(node, 'output', 'result')).toBeNull();
  });

  it('ignores a malformed properties payload rather than throwing', () => {
    expect(
      resolveBoundarySlotLabel(def, instance(1, { properties: { mobileSlotLabels: 7 } }), 'input', 0),
    ).toBe('Prompt');
    expect(
      resolveBoundarySlotLabel(
        def,
        instance(1, { properties: { mobileSlotLabels: { 'input:text': 12 } } }),
        'input',
        0,
      ),
    ).toBe('Prompt');
  });
});

describe('instance inventory', () => {
  const workflow = {
    nodes: [instance(1), instance(2), instance(3, { type: 'KSampler' })],
    definitions: {
      subgraphs: [def, { ...def, id: 'sg-b', nodes: [instance(4)] }],
    },
  } as unknown as Workflow;

  it('finds instances at root and nested inside other definitions', () => {
    expect(collectSubgraphInstances(workflow, SG).map(({ node }) => node.id)).toEqual([1, 2, 4]);
  });

  it('reports only the instances that disagree about a slot', () => {
    const current = instance(1, {
      properties: { mobileSlotLabels: { 'input:text': 'Positive' } },
    });
    const other = instance(2, {
      properties: { mobileSlotLabels: { 'input:text': 'Negative' } },
    });
    const agreeing = instance(4);
    const wf = {
      nodes: [current, other],
      definitions: { subgraphs: [{ ...def, nodes: [agreeing] }] },
    } as unknown as Workflow;

    const divergent = collectDivergentInstanceLabels(wf, def, current, 'input', 0);
    expect(divergent.map(({ node, label }) => [node.id, label])).toEqual([
      [2, 'Negative'],
      // Instance 4 falls back to the type's 'Prompt', which differs from
      // 'Positive', so it is named too.
      [4, 'Prompt'],
    ]);
  });

  it('reports nothing when every instance agrees', () => {
    const wf = {
      nodes: [instance(1), instance(2)],
      definitions: { subgraphs: [def] },
    } as unknown as Workflow;
    expect(collectDivergentInstanceLabels(wf, def, wf.nodes[0], 'input', 0)).toEqual([]);
  });
});
