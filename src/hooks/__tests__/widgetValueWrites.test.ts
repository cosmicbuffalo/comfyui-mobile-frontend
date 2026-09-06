import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { updateNodeWidgetValues } from '@/hooks/useWorkflow/layoutOps';

function makeNode(widgetsValues: unknown): WorkflowNode {
  return {
    id: 30,
    type: 'sg-1',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: widgetsValues,
  } as unknown as WorkflowNode;
}

describe('updateNodeWidgetValues — array form', () => {
  // widgetIndex is a fixed slot in the node's widget order, so a write past the
  // end has to pad. Appending would land the value on whatever widget happens
  // to sit at the end of the (shorter) array — for a subgraph placeholder that
  // ships `widgets_values: []`, that means widget slot 0.
  it('pads to the index instead of appending when the array is empty', () => {
    const next = updateNodeWidgetValues(makeNode([]), 3, 12345);
    expect(next.widgets_values).toEqual([null, null, null, 12345]);
  });

  it('pads to the index instead of appending when the array is short', () => {
    const next = updateNodeWidgetValues(makeNode(['a prompt', 1024]), 5, 0.8);
    expect(next.widgets_values).toEqual(['a prompt', 1024, null, null, null, 0.8]);
  });

  it('overwrites in place when the index already exists', () => {
    const next = updateNodeWidgetValues(makeNode(['a prompt', 1024, 42]), 1, 512);
    expect(next.widgets_values).toEqual(['a prompt', 512, 42]);
  });

  it('does not disturb the other slots when padding', () => {
    const node = makeNode(['keep me']);
    const next = updateNodeWidgetValues(node, 2, 'new');
    expect((next.widgets_values as unknown[])[0]).toBe('keep me');
    // The original node is not mutated.
    expect(node.widgets_values).toEqual(['keep me']);
  });
});
