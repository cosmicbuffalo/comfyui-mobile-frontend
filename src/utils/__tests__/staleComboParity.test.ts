import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { buildPromptFromWorkflow } from '../buildPromptFromWorkflow';

function node(id: number, type: string, widgets: unknown[]): WorkflowNode {
  return { id, type, pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: widgets };
}
const workflow = (n: WorkflowNode) => ({ nodes: [n], links: [], groups: [], config: {}, version: 1, last_node_id: 1, last_link_id: 0 }) as unknown as Workflow;

describe('combo values the server does not offer', () => {
  it('are sent as saved, so the server rejects them as it does stock\'s', () => {
    const types = {
      Saver: { input: { required: { root: [['output', 'temp'], { default: 'output' }] } }, output: [], output_node: true, name: 'Saver' },
    } as unknown as NodeTypes;
    const prompt = buildPromptFromWorkflow(workflow(node(1, 'Saver', ['[time(%Y-%m-%d)]'])), types) as Record<string, { inputs: Record<string, unknown> }>;
    expect(prompt['1'].inputs.root).toBe('[time(%Y-%m-%d)]');
  });

  it('except the wildcard picker, which always sends its placeholder', () => {
    const sentinel = 'Select the Wildcard to add to the text';
    const types = {
      ImpactWildcardProcessor: {
        input: { required: { wildcard_text: ['STRING', { multiline: true }], 'Select to add Wildcard': [[sentinel]] } },
        output: ['STRING'], output_node: true, name: 'ImpactWildcardProcessor',
      },
    } as unknown as NodeTypes;
    for (const saved of [sentinel, '__animals__']) {
      const prompt = buildPromptFromWorkflow(workflow(node(1, 'ImpactWildcardProcessor', ['a cat', saved])), types) as Record<string, { inputs: Record<string, unknown> }>;
      expect(prompt['1'].inputs['Select to add Wildcard']).toBe(sentinel);
    }
  });
});
