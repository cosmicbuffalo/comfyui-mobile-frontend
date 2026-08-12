import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import {
  applyImpactNodeFeedback,
  parseImpactNodeFeedback,
} from '@/utils/impactNodeFeedback';

const NODE_TYPES = {
  ImpactWildcardProcessor: {
    input: {
      required: {
        wildcard_text: ['STRING', { multiline: true }],
        populated_text: ['STRING', { multiline: true }],
        mode: [['populate', 'fixed', 'reproduce'], {}],
        seed: ['INT', {}],
        'Select to add Wildcard': [['Select the Wildcard to add to the text'], {}],
      },
    },
  },
} as unknown as NodeTypes;

function node(id: number, values: unknown[]): WorkflowNode {
  return {
    id,
    itemKey: `node:${id}`,
    type: 'ImpactWildcardProcessor',
    pos: [0, 0],
    size: [400, 300],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: values,
  } as unknown as WorkflowNode;
}

function workflowWith(nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: 99, last_link_id: 0, nodes,
    links: [], groups: [], config: {}, version: 1,
  } as unknown as Workflow;
}

/** widgets_values is a union with the record form; narrow it for indexing. */
function slots(node: WorkflowNode | undefined): unknown[] {
  const values = node?.widgets_values;
  if (!Array.isArray(values)) throw new Error('expected array widgets_values');
  return values;
}

const RESOLVED = 'a photo of a blue dahlia';
const START = ['__flower__', '', 'populate', 1, 'fixed', 'Select the Wildcard to add to the text'];

describe('parseImpactNodeFeedback', () => {
  it('accepts the payload Impact Pack actually sends', () => {
    // node_id arrives as a string over the wire.
    expect(parseImpactNodeFeedback({
      node_id: '2', widget_name: 'populated_text', type: 'STRING', value: RESOLVED,
    })).toEqual({ nodeId: 2, widgetName: 'populated_text', value: RESOLVED });
  });

  it('accepts a numeric node id too', () => {
    expect(parseImpactNodeFeedback({ node_id: 2, widget_name: 'mode', value: 'populate' }))
      .toEqual({ nodeId: 2, widgetName: 'mode', value: 'populate' });
  });

  it('rejects payloads it cannot act on', () => {
    expect(parseImpactNodeFeedback(null)).toBeNull();
    expect(parseImpactNodeFeedback({ widget_name: 'x', value: 1 })).toBeNull();
    expect(parseImpactNodeFeedback({ node_id: 'abc', widget_name: 'x', value: 1 })).toBeNull();
    expect(parseImpactNodeFeedback({ node_id: '2', widget_name: '', value: 1 })).toBeNull();
    // An absent `value` is not the same as a null one, so it must not apply.
    expect(parseImpactNodeFeedback({ node_id: '2', widget_name: 'populated_text' })).toBeNull();
  });
});

describe('applyImpactNodeFeedback', () => {
  const feedback = { nodeId: 2, widgetName: 'populated_text', value: RESOLVED };

  it('writes the resolved prompt into the right widget slot', () => {
    const workflow = workflowWith([node(2, START)]);
    const next = applyImpactNodeFeedback(workflow, NODE_TYPES, feedback);
    expect(slots(next?.nodes[0])).toEqual([
      '__flower__', RESOLVED, 'populate', 1, 'fixed', 'Select the Wildcard to add to the text',
    ]);
    // The source workflow is never mutated in place.
    expect(slots(workflow.nodes[0])[1]).toBe('');
  });

  it('leaves other nodes and their slots alone', () => {
    const workflow = workflowWith([node(1, START), node(2, START)]);
    const next = applyImpactNodeFeedback(workflow, NODE_TYPES, feedback);
    expect(slots(next?.nodes[0])[1]).toBe('');
    expect(slots(next?.nodes[1])[1]).toBe(RESOLVED);
  });

  it('reaches a node inside a subgraph definition', () => {
    const workflow = {
      ...workflowWith([node(9, START)]),
      definitions: { subgraphs: [{ id: 'sg-1', nodes: [node(2, START)] }] },
    } as unknown as Workflow;
    const next = applyImpactNodeFeedback(workflow, NODE_TYPES, feedback);
    expect(slots(next?.definitions?.subgraphs?.[0].nodes[0])[1]).toBe(RESOLVED);
    expect(slots(next?.nodes[0])[1]).toBe('');
  });

  it('returns null when nothing matches, so the store is not touched', () => {
    // The event is broadcast to every client, including ones on another workflow.
    const workflow = workflowWith([node(7, START)]);
    expect(applyImpactNodeFeedback(workflow, NODE_TYPES, feedback)).toBeNull();
  });

  it('returns null for an unknown widget name', () => {
    const workflow = workflowWith([node(2, START)]);
    expect(applyImpactNodeFeedback(workflow, NODE_TYPES, {
      ...feedback, widgetName: 'not_a_widget',
    })).toBeNull();
  });

  it('returns null when the value is already current', () => {
    // Re-queueing to the same resolved text must not mark the workflow dirty.
    const already = ['__flower__', RESOLVED, 'populate', 1, 'fixed', 'x'];
    const workflow = workflowWith([node(2, already)]);
    expect(applyImpactNodeFeedback(workflow, NODE_TYPES, feedback)).toBeNull();
  });
});
