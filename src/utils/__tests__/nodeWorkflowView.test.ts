import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { createNodeWorkflowSelector } from '../nodeWorkflowView';

function node(id: number, type = 'PrimitiveInt'): WorkflowNode {
  return { id, type, pos: [0, 0], size: [100, 100], flags: {}, order: id,
    mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: [id] };
}
function workflow(): Workflow {
  return { nodes: [node(1), node(2), node(3)], links: [], groups: [],
    last_node_id: 3, last_link_id: 0, version: 0.4, config: {} };
}
function edit(value: Workflow, id: number): Workflow {
  return { ...value, nodes: value.nodes.map((n) => n.id === id ? { ...n, widgets_values: [99] } : n) };
}

describe('node workflow render snapshots', () => {
  it('skips unrelated widget edits, then returns the complete latest graph for a relevant edit', () => {
    const select = createNodeWorkflowSelector(1);
    const original = workflow();
    const unrelated = edit(original, 2);
    expect(select({ workflow: original })).toBe(original);
    expect(select({ workflow: unrelated })).toBe(original);
    const own = edit(unrelated, 1);
    expect(select({ workflow: own })).toBe(own);
    expect(select({ workflow: own })?.nodes[1].widgets_values).toEqual([99]);
  });

  it('updates through an upstream reroute chain, including cycles', () => {
    const original = workflow();
    original.links = [[1, 1, 0, 2, 0, 'INT'], [2, 2, 0, 3, 0, 'INT'], [3, 3, 0, 2, 1, 'INT']];
    const select = createNodeWorkflowSelector(3);
    select({ workflow: original });
    const changed = edit(original, 1);
    expect(select({ workflow: changed })).toBe(changed);
  });

  it.each(['title', 'properties', 'inputs', 'mode'] as const)('refreshes other cards for a changed %s', (field) => {
    const original = workflow();
    const select = createNodeWorkflowSelector(1);
    select({ workflow: original });
    const changes = { title: 'Renamed', properties: { label: 'renamed' }, inputs: [{ name: 'x', type: 'INT', link: null }], mode: 4 };
    const changed = { ...original, nodes: original.nodes.map((n) => n.id === 2 ? { ...n, [field]: changes[field] } : n) };
    expect(select({ workflow: changed })).toBe(changed);
  });

  it('refreshes on connection changes, node removal, metadata changes and undo', () => {
    let current = workflow();
    const original = current;
    const select = createNodeWorkflowSelector(1);
    select({ workflow: current });
    for (const change of [
      { links: [[1, 2, 0, 1, 0, 'INT']] as Workflow['links'] },
      { nodes: current.nodes.slice(0, 2) },
      { widget_idx_map: { '1': { amount: 0 } } },
    ]) {
      current = { ...current, ...change };
      expect(select({ workflow: current })).toBe(current);
    }
    expect(select({ workflow: original })).toBe(original);
    expect(select({ workflow: null })).toBeNull();
    expect(select({ workflow: original })).toBe(original);
  });

  it.each(['SetNode', 'GetNode', 'Anything Everywhere'])('keeps wireless %s values globally reactive', (type) => {
    const original = workflow();
    original.nodes[1] = node(2, type);
    const select = createNodeWorkflowSelector(1);
    select({ workflow: original });
    const changed = edit(original, 2);
    expect(select({ workflow: changed })).toBe(changed);
  });

  it('keeps subgraph and promoted values globally reactive', () => {
    const original = workflow();
    original.definitions = { subgraphs: [{ id: 'subgraph', nodes: [], links: [] }] };
    const select = createNodeWorkflowSelector(1);
    select({ workflow: original });
    const changed = edit(original, 2);
    expect(select({ workflow: changed })).toBe(changed);
  });
});
