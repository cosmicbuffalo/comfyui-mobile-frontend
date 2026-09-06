import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { reconcileInstanceWidgetValues } from '@/utils/instanceWidgetValues';

/**
 * A placeholder can describe one promoted widget two ways: a DIRECT entry
 * naming the inner node that owns it (`["850", "width"]`), which is what stock
 * writes, or a BOUNDARY entry (`["-1", "width"]`) naming the boundary input
 * that routes it. Both occupy exactly one slot in `widgets_values`.
 *
 * Reconciling used to keep the direct entries and then append a boundary entry
 * for every widget-backed boundary input — including the ones those direct
 * entries already covered. A nine-widget placeholder came back with nineteen
 * entries, and since values are positional, everything after the first
 * duplicate was read one slot early: a promoted prompt resolved to a frame
 * rate.
 */

const SUBGRAPH_ID = 'sub-1';

function definition(): WorkflowSubgraphDefinition {
  return {
    id: SUBGRAPH_ID,
    name: 'Section',
    inputs: [
      { id: 'a', name: 'width', type: 'INT', linkIds: [1] },
      { id: 'b', name: 'steps', type: 'INT', linkIds: [2] },
      { id: 'c', name: 'text', type: 'STRING', linkIds: [3] },
    ],
    outputs: [],
    nodes: [
      {
        id: 50,
        type: 'Sampler',
        pos: [0, 0],
        size: [10, 10],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [
          { name: 'width', type: 'INT', link: 1, widget: { name: 'width' } },
          { name: 'steps', type: 'INT', link: 2, widget: { name: 'steps' } },
        ],
        outputs: [],
        properties: {},
        widgets_values: [512, 20],
      },
      {
        id: 51,
        type: 'Encoder',
        pos: [0, 0],
        size: [10, 10],
        flags: {},
        order: 1,
        mode: 0,
        inputs: [{ name: 'text', type: 'STRING', link: 3, widget: { name: 'text' } }],
        outputs: [],
        properties: {},
        widgets_values: ['inner text'],
      },
    ],
    links: [
      { id: 1, origin_id: -10, origin_slot: 0, target_id: 50, target_slot: 0, type: 'INT' },
      { id: 2, origin_id: -10, origin_slot: 1, target_id: 50, target_slot: 1, type: 'INT' },
      { id: 3, origin_id: -10, origin_slot: 2, target_id: 51, target_slot: 0, type: 'STRING' },
    ],
  };
}

function placeholder(proxyWidgets: Array<[string, string]>, values: unknown[]): WorkflowNode {
  return {
    id: 1,
    type: SUBGRAPH_ID,
    pos: [0, 0],
    size: [10, 10],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [
      { name: 'width', type: 'INT', link: null },
      { name: 'steps', type: 'INT', link: null },
      { name: 'text', type: 'STRING', link: null },
    ],
    outputs: [],
    properties: { proxyWidgets },
    widgets_values: values,
  };
}

function workflowWith(node: WorkflowNode): Workflow {
  return {
    last_node_id: 1,
    last_link_id: 0,
    nodes: [node],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: { subgraphs: [definition()] },
  };
}

function proxiesOf(workflow: Workflow): Array<[string, string]> {
  return (workflow.nodes[0].properties.proxyWidgets ?? []) as Array<[string, string]>;
}

describe('reconcileInstanceWidgetValues', () => {
  it('does not re-add a widget a direct proxy entry already names', () => {
    const before = placeholder(
      [['50', 'width'], ['50', 'steps'], ['51', 'text']],
      [512, 20, 'held text'],
    );
    const after = reconcileInstanceWidgetValues(workflowWith(before), SUBGRAPH_ID, null);

    // One slot per widget: the boundary names them too, but the direct entries
    // are already standing in those positions.
    expect(proxiesOf(after)).toEqual([['50', 'width'], ['50', 'steps'], ['51', 'text']]);
    expect(after.nodes[0].widgets_values).toEqual([512, 20, 'held text']);
  });

  it('keeps every value on the widget it belongs to', () => {
    // The failure this guards is silent: with a duplicated list the array grows
    // and each value is read one or more slots early, so the assertion has to be
    // about the name→value mapping rather than the array's length.
    const before = placeholder(
      [['50', 'width'], ['50', 'steps'], ['51', 'text']],
      [768, 30, 'a promoted prompt'],
    );
    const after = reconcileInstanceWidgetValues(workflowWith(before), SUBGRAPH_ID, null);

    const values = after.nodes[0].widgets_values as unknown[];
    const byName = new Map(proxiesOf(after).map((entry, index) => [entry[1], values[index]]));
    expect(byName.get('width')).toBe(768);
    expect(byName.get('steps')).toBe(30);
    expect(byName.get('text')).toBe('a promoted prompt');
  });

  it('still appends a boundary entry for a widget no proxy names yet', () => {
    // The append is the mechanism promotion relies on; only the duplicate was
    // wrong. A list missing `text` must still gain it.
    const before = placeholder([['50', 'width'], ['50', 'steps']], [512, 20]);
    const after = reconcileInstanceWidgetValues(workflowWith(before), SUBGRAPH_ID, null);

    expect(proxiesOf(after)).toEqual([['50', 'width'], ['50', 'steps'], ['-1', 'text']]);
  });

  it('mixes direct and boundary entries without duplicating either', () => {
    const before = placeholder(
      [['50', 'width'], ['-1', 'text']],
      [512, 'held text'],
    );
    const after = reconcileInstanceWidgetValues(workflowWith(before), SUBGRAPH_ID, null);

    const names = proxiesOf(after).map((entry) => entry[1]);
    expect(new Set(names).size, `duplicated names in ${JSON.stringify(names)}`).toBe(names.length);
    expect(names).toContain('width');
    expect(names).toContain('steps');
    expect(names).toContain('text');
  });
});
