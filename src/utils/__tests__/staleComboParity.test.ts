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

  it('except an Easy-Use picker, which always sends its placeholder', () => {
    const types = {
      'easy prompt': {
        input: { required: { text: ['STRING', { multiline: true }], prefix: [['Select the prefix add to the text', 'Detailed photo of'], { default: 'Select the prefix add to the text' }] } },
        output: ['STRING'], output_node: true, name: 'easy prompt',
      },
    } as unknown as NodeTypes;
    for (const saved of ['Select the prefix to add to the text', 'Detailed photo of']) {
      const prompt = buildPromptFromWorkflow(workflow(node(1, 'easy prompt', ['a cat', saved])), types) as Record<string, { inputs: Record<string, unknown> }>;
      expect(prompt['1'].inputs.prefix).toBe('Select the prefix add to the text');
    }
  });
});
