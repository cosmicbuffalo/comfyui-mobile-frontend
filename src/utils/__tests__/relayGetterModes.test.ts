import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { buildWorkflowPromptInputs, resolveSource } from '../workflowInputs';

function node(id: number, type: string, opts: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, type, pos: [0, 0], size: [100, 60], flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: [], ...opts };
}

const packs = [
  { getter: 'GetNode', setter: 'SetNode' },
];

const nodeTypes = {
  Consumer: { input: { required: {
    linked: ['STRING', { forceInput: true }],
    value: ['STRING', {}],
  } } },
} as unknown as NodeTypes;

describe.each(packs)('$getter modes', ({ getter, setter }) => {
  // A KJ getter can read a setter in an enclosing graph.
  describe.each(['root', 'subgraph'])('%s getter', (scope) => {
    it.each([
      { mode: 0, label: 'active', resolves: true },
      { mode: 2, label: 'muted', resolves: false },
      { mode: 4, label: 'bypassed', resolves: false },
    ])('$label getter (mode $mode)', ({ mode, resolves }) => {
      const producer = node(1, 'Producer', { outputs: [{ name: 'value', type: 'STRING', links: [1] }] });
      const publisher = node(2, setter, {
        widgets_values: ['channel'], inputs: [{ name: 'value', type: 'STRING', link: 1 }],
      });
      const subscriber = node(3, getter, {
        mode,
        widgets_values: ['channel'],
        outputs: [{ name: 'value', type: 'STRING', links: [2, 3] }],
      });
      const consumer = node(4, 'Consumer', {
        inputs: [
          { name: 'linked', type: 'STRING', link: 2 },
          { name: 'value', type: 'STRING', link: 3, widget: { name: 'value' } },
        ],
        widgets_values: ['fallback'],
      });
      const workflow: Workflow = {
        last_node_id: 4, last_link_id: 3, nodes: [producer, publisher, subscriber, consumer],
        links: [[1, 1, 0, 2, 0, 'STRING'], [2, 3, 0, 4, 0, 'STRING'], [3, 3, 0, 4, 1, 'STRING']],
        groups: [], config: {}, version: 0.4,
      };
      const nested = scope === 'subgraph';
      const producerKey = '1';
      const keys = new Map([
        [1, producerKey], [2, '2'],
        [3, nested ? '10:3' : '3'], [4, nested ? '10:4' : '4'],
      ]);

      expect(resolveSource(workflow, 2, new Set(), keys)).toEqual(resolves ? { nodeId: 1, slotIndex: 0 } : null);
      expect(buildWorkflowPromptInputs(workflow, nodeTypes, consumer, consumer.type, new Set([1, 4]), null, undefined, keys))
        .toEqual(resolves ? { linked: [producerKey, 0], value: [producerKey, 0] } : { value: 'fallback' });
    });
  });
});
