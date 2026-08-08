import { describe, expect, it } from 'vitest';
import { diffWorkflowChange } from '@/utils/workflowUndoDiff';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';

function node(id: number, over: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: 'KSampler',
    pos: [0, 0],
    size: [100, 60],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    ...over,
  };
}

function wf(nodes: WorkflowNode[], groups: Workflow['groups'] = []): Workflow {
  return { nodes, groups, links: [], definitions: { subgraphs: [] } } as unknown as Workflow;
}

// KSampler-like type whose first widget input is the seed.
const nodeTypes = {
  KSampler: {
    input: { required: { seed: ['INT', { default: 0 }], steps: ['INT', { default: 20 }] } },
    output: [],
    name: 'KSampler',
    display_name: 'KSampler',
    description: '',
    python_module: '',
    category: '',
  },
} as unknown as NodeTypes;

describe('diffWorkflowChange', () => {
  it('reports no change when workflows are identical references', () => {
    const a = wf([node(1)]);
    expect(diffWorkflowChange(a, a, null)).toEqual({ meaningful: false, structural: false, changedNodeIds: [] });
  });

  it('flags an added node as a structural, meaningful change', () => {
    const before = wf([node(1)]);
    const after = wf([node(1), node(2)]);
    const d = diffWorkflowChange(before, after, null);
    expect(d.meaningful).toBe(true);
    expect(d.structural).toBe(true);
    expect(d.changedNodeIds).toContain(2);
  });

  it('flags a position change as structural', () => {
    const d = diffWorkflowChange(wf([node(1)]), wf([node(1, { pos: [50, 80] })]), null);
    expect(d.meaningful).toBe(true);
    expect(d.structural).toBe(true);
    expect(d.changedNodeIds).toEqual([1]);
  });

  it('flags a non-seed widget change as meaningful but not structural', () => {
    const before = wf([node(1, { widgets_values: [100, 20] })]);
    const after = wf([node(1, { widgets_values: [100, 25] })]); // steps changed
    const d = diffWorkflowChange(before, after, nodeTypes);
    expect(d.meaningful).toBe(true);
    expect(d.structural).toBe(false);
    expect(d.changedNodeIds).toEqual([1]);
  });

  it('excludes a seed-only change (the seed widget value)', () => {
    const before = wf([node(1, { widgets_values: [100, 20] })]);
    const after = wf([node(1, { widgets_values: [999, 20] })]); // only seed changed
    const d = diffWorkflowChange(before, after, nodeTypes);
    expect(d.meaningful).toBe(false);
    expect(d.changedNodeIds).toEqual([]);
  });

  it('flags a group change as structural', () => {
    const g: Workflow['groups'][number] = {
      id: 1,
      title: 'G',
      bounding: [0, 0, 10, 10],
      color: '#333',
    };
    const before = wf([node(1)], [g]);
    const after = wf([node(1)], [{ ...g, bounding: [0, 0, 20, 20] }]);
    const d = diffWorkflowChange(before, after, null);
    expect(d.meaningful).toBe(true);
    expect(d.structural).toBe(true);
  });

  it('sees an edit to a node whose id is reused in another subgraph', () => {
    // Desktop-saved workflows number each subgraph's inner nodes independently,
    // so two definitions both holding node 1 is normal. Keying the diff by id
    // alone let one shadow the other: the edit compared equal, no snapshot was
    // recorded, and a later Undo reverted two edits at once.
    const inSubgraph = (id: string, widgets: unknown[]) => ({
      id,
      name: id,
      nodes: [{ ...node(1), widgets_values: widgets }],
      links: [],
    });
    const prev = {
      ...wf([]),
      definitions: { subgraphs: [inSubgraph('sg-a', ['before']), inSubgraph('sg-b', ['other'])] },
    } as unknown as Workflow;
    const next = {
      ...wf([]),
      definitions: { subgraphs: [inSubgraph('sg-a', ['after']), inSubgraph('sg-b', ['other'])] },
    } as unknown as Workflow;

    const diff = diffWorkflowChange(prev, next, null);

    expect(diff.meaningful).toBe(true);
    expect(diff.changedNodeIds).toContain(1);
  });

  it('treats a node.properties edit as meaningful', () => {
    // The Fast Groups Bypasser's configuration lives only in properties. Missing
    // it skipped the undo snapshot and left the redo stack standing, so a later
    // Redo silently discarded the configuration.
    const prev = wf([node(1, { properties: { matchColors: 'blue' } })]);
    const next = wf([node(1, { properties: { matchColors: 'red' } })]);

    const diff = diffWorkflowChange(prev, next, null);

    expect(diff.meaningful).toBe(true);
    expect(diff.changedNodeIds).toContain(1);
  });
});
