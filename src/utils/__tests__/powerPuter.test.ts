import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import {
  buildPowerPuterOutputSlots,
  isPowerPuterNodeType,
  parsePowerPuterOutputs,
  readPowerPuterWidgets,
  toPowerPuterOutputsValue,
} from '../powerPuter';
import { buildWorkflowPromptInputs } from '../workflowInputs';
import { getWidgetDefinitions } from '../widgetDefinitions';

const PUTER = 'Power Puter (rgthree)';

function node(id: number, type: string, over: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id, type, pos: [0, 0], size: [200, 120], flags: {}, order: id, mode: 0,
    inputs: [], outputs: [], properties: {}, ...over,
  } as unknown as WorkflowNode;
}

function wf(nodes: WorkflowNode[], links: unknown[] = []): Workflow {
  return { nodes, links, groups: [], definitions: { subgraphs: [] } } as unknown as Workflow;
}

/**
 * What ComfyUI actually reports for this node: `FlexibleOptionalInputType` seeds
 * no data, so both halves of the schema come back empty. Every test here leans
 * on that — it is the condition that makes the generic prompt path insufficient.
 */
const NODE_TYPES = {
  [PUTER]: { input: { required: {}, optional: {} }, output: ['*'] },
  CLIPTextEncode: {
    input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } },
    output: ['CONDITIONING'],
  },
} as unknown as NodeTypes;

describe('isPowerPuterNodeType', () => {
  it('matches the node type and nothing adjacent', () => {
    expect(isPowerPuterNodeType(PUTER)).toBe(true);
    expect(isPowerPuterNodeType('  Power Puter (rgthree)  ')).toBe(true);
    expect(isPowerPuterNodeType('Power Lora Loader (rgthree)')).toBe(false);
    expect(isPowerPuterNodeType('Power Puter')).toBe(false);
    expect(isPowerPuterNodeType(undefined)).toBe(false);
  });
});

describe('parsePowerPuterOutputs', () => {
  it('reads the current envelope', () => {
    expect(parsePowerPuterOutputs({ outputs: ['STRING', 'INT'] })).toEqual(['STRING', 'INT']);
  });

  it('reads the legacy single-string widget value', () => {
    expect(parsePowerPuterOutputs('FLOAT')).toEqual(['FLOAT']);
  });

  it('rewrites the legacy BOOL type to BOOLEAN', () => {
    // Upstream shipped "BOOL" briefly and its widget setter still repairs it.
    // BOOL is not a real ComfyUI type, so passing it through would declare an
    // output slot nothing can connect to.
    expect(parsePowerPuterOutputs({ outputs: ['BOOL'] })).toEqual(['BOOLEAN']);
    expect(parsePowerPuterOutputs('BOOL')).toEqual(['BOOLEAN']);
  });

  it('returns null for values that are not an outputs list', () => {
    expect(parsePowerPuterOutputs(undefined)).toBeNull();
    expect(parsePowerPuterOutputs(42)).toBeNull();
    expect(parsePowerPuterOutputs({ outputs: [] })).toBeNull();
  });
});

describe('readPowerPuterWidgets', () => {
  it('reads the widget pair upstream writes', () => {
    const n = node(1, PUTER, { widgets_values: [{ outputs: ['INT'] }, 'a + b'] });
    expect(readPowerPuterWidgets(n)).toEqual({
      outputsIndex: 0, codeIndex: 1, outputs: ['INT'], code: 'a + b',
    });
  });

  it('reads a legacy string-valued outputs widget without mistaking it for the code', () => {
    const n = node(1, PUTER, { widgets_values: ['STRING', "', '.join(x)"] });
    expect(readPowerPuterWidgets(n)).toEqual({
      outputsIndex: 0, codeIndex: 1, outputs: ['STRING'], code: "', '.join(x)",
    });
  });

  it('defaults to a single STRING output when the widget is absent', () => {
    const n = node(1, PUTER, { widgets_values: ['a + b'] });
    const read = readPowerPuterWidgets(n);
    expect(read.outputs).toEqual(['STRING']);
    expect(read.code).toBe('a + b');
  });

  it('reads a name-keyed widgets_values record', () => {
    const n = node(1, PUTER, {
      widgets_values: { outputs: { outputs: ['FLOAT'] }, code: '1 / 2' } as never,
    });
    const read = readPowerPuterWidgets(n);
    expect(read.outputs).toEqual(['FLOAT']);
    expect(read.code).toBe('1 / 2');
  });

  it('survives a node with no widgets_values at all', () => {
    expect(readPowerPuterWidgets(node(1, PUTER))).toEqual({
      outputsIndex: null, codeIndex: null, outputs: ['STRING'], code: '',
    });
  });
});

describe('buildPowerPuterOutputSlots', () => {
  it('retypes in place and keeps links on surviving slots', () => {
    const existing = [
      { name: 'STRING', type: 'STRING', links: [7] },
      { name: 'INT', type: 'INT', links: null },
    ];
    expect(buildPowerPuterOutputSlots(existing, ['FLOAT', 'INT'])).toEqual([
      { name: 'FLOAT', type: 'FLOAT', label: 'FLOAT', links: [7], slot_index: 0 },
      { name: 'INT', type: 'INT', label: 'INT', links: null, slot_index: 1 },
    ]);
  });

  it('preserves a user-renamed label but refreshes a mirrored one', () => {
    const existing = [
      { name: 'STRING', type: 'STRING', links: null, label: 'prompt' },
      { name: 'INT', type: 'INT', links: null, label: 'INT' },
    ];
    const slots = buildPowerPuterOutputSlots(existing, ['INT', 'FLOAT']);
    expect(slots[0].label).toBe('prompt');
    expect(slots[1].label).toBe('FLOAT');
  });

  it('drops surplus slots and appends new ones', () => {
    const existing = [{ name: 'STRING', type: 'STRING', links: [3] }];
    expect(buildPowerPuterOutputSlots(existing, ['STRING', 'INT'])).toHaveLength(2);
    expect(buildPowerPuterOutputSlots(existing, [])).toHaveLength(0);
  });
});

describe('prompt serialization (rgthree-comfy#758)', () => {
  function inputsFor(n: WorkflowNode, workflow = wf([n])) {
    return buildWorkflowPromptInputs(
      workflow, NODE_TYPES, n, PUTER, new Set(workflow.nodes.map((x) => x.id)), null,
    );
  }

  it('sends code and outputs even though object_info declares no widgets', () => {
    // The bug: the schema walk finds nothing, so without the explicit append the
    // backend gets a prompt with no `code` key and raises on kwargs['code'].
    const n = node(1, PUTER, { widgets_values: [{ outputs: ['STRING'] }, 'a + b'] });
    expect(inputsFor(n)).toEqual({ code: 'a + b', outputs: { outputs: ['STRING'] } });
  });

  it('nests the outputs list the way main() unwraps it', () => {
    const n = node(1, PUTER, { widgets_values: [{ outputs: ['INT', 'FLOAT'] }, 'a'] });
    // get_dict_value(kwargs, 'outputs.outputs') — a bare array would read as None
    // and the node would silently fall back to a single STRING output.
    expect(inputsFor(n).outputs).toEqual({ outputs: ['INT', 'FLOAT'] });
  });

  it('normalizes a legacy BOOL workflow on the way out', () => {
    const n = node(1, PUTER, { widgets_values: [{ outputs: ['BOOL'] }, 'a > b'] });
    expect(inputsFor(n).outputs).toEqual({ outputs: ['BOOLEAN'] });
  });

  it('keeps wired inputs alongside the injected widgets', () => {
    const source = node(2, 'CLIPTextEncode', { outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [5] }] });
    const puter = node(1, PUTER, {
      inputs: [{ name: 'a', type: '*', link: 5 }] as never,
      widgets_values: [{ outputs: ['STRING'] }, 'a'],
    });
    const workflow = wf([puter, source], [[5, 2, 0, 1, 0, '*']]);
    expect(inputsFor(puter, workflow)).toEqual({
      a: ['2', 0],
      code: 'a',
      outputs: { outputs: ['STRING'] },
    });
  });

  it('still injects when the type definition carries no input key at all', () => {
    const n = node(1, PUTER, { widgets_values: [{ outputs: ['STRING'] }, 'a'] });
    const bare = { [PUTER]: { output: ['*'] } } as unknown as NodeTypes;
    const inputs = buildWorkflowPromptInputs(wf([n]), bare, n, PUTER, new Set([1]), null);
    expect(inputs).toEqual({ code: 'a', outputs: { outputs: ['STRING'] } });
  });

  it('leaves every other node type untouched', () => {
    const n = node(1, 'CLIPTextEncode', { widgets_values: ['hello'] });
    const inputs = buildWorkflowPromptInputs(
      wf([n]), NODE_TYPES, n, 'CLIPTextEncode', new Set([1]), null,
    );
    expect(inputs).not.toHaveProperty('outputs');
  });
});

describe('widget definitions', () => {
  it('renders an outputs chip row and a multiline code box', () => {
    const n = node(1, PUTER, { widgets_values: [{ outputs: ['STRING', 'INT'] }, 'a + b'] });
    const defs = getWidgetDefinitions(NODE_TYPES, n);
    expect(defs.map((d) => [d.name, d.type])).toEqual([
      ['outputs', 'POWER_PUTER_OUTPUTS'],
      ['code', 'STRING'],
    ]);
    expect(defs[0].value).toEqual(['STRING', 'INT']);
    expect(defs[1].options).toEqual({ multiline: true });
    expect(defs[1].value).toBe('a + b');
  });

  it('points a missing outputs widget at the slot upstream would write', () => {
    // Otherwise the first edit appends a stray value instead of filling slot 0.
    const n = node(1, PUTER, { widgets_values: ['a + b'] });
    const defs = getWidgetDefinitions(NODE_TYPES, n);
    expect(defs[0].widgetIndex).toBe(0);
    expect(defs[1].widgetIndex).toBe(0);
  });
});

describe('toPowerPuterOutputsValue', () => {
  it('copies rather than aliasing the caller list', () => {
    const outputs = ['STRING'];
    const value = toPowerPuterOutputsValue(outputs);
    outputs.push('INT');
    expect(value.outputs).toEqual(['STRING']);
  });
});
