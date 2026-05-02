import { describe, expect, it } from 'vitest';
import type { NodeTypes, WorkflowNode } from '@/api/types';
import { getWidgetDefinitions } from '../widgetDefinitions';

function makeNode(id: number, type: string, widgetsValues: unknown[]): WorkflowNode {
  return {
    id,
    itemKey: `sk-${id}`,
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: widgetsValues,
  };
}

describe('widgetDefinitions lora manager support', () => {
  it('builds lora manager synthetic widgets with choices from LoraLoader', () => {
    const nodeTypes: NodeTypes = {
      LoraLoader: {
        input: {
          required: {
            lora_name: ['COMBO', { choices: ['a.safetensors', 'b.safetensors'] }],
          },
        },
        output: [],
        output_name: [],
        name: 'LoraLoader',
        display_name: 'LoraLoader',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(1, 'Lora Loader (LoraManager)', [
      'text',
      [{ name: 'a.safetensors', strength: 1, active: true }],
    ]);

    const defs = getWidgetDefinitions(nodeTypes, node);
    expect(defs.map((d) => d.type)).toContain('LM_LORA_HEADER');
    expect(defs.map((d) => d.type)).toContain('LM_LORA');
    expect(defs.map((d) => d.type)).toContain('LM_LORA_ADD');

    const loraDef = defs.find((d) => d.type === 'LM_LORA');
    expect(loraDef?.options).toMatchObject({ entryIndex: 0 });
  });

  it('uses LoRA Manager widget ids to skip metadata widgets', () => {
    const nodeTypes: NodeTypes = {
      'Lora Loader (LoraManager)': {
        input: {
          required: {
            text: ['AUTOCOMPLETE_TEXT_LORAS', {}],
          },
          optional: {},
        },
        input_order: {
          required: ['text'],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'Lora Loader (LoraManager)',
        display_name: 'Lora Loader (LoraManager)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(1, 'Lora Loader (LoraManager)', [
      { version: 1, textWidgetName: 'text' },
      '<lora:a:1.00>',
      [{ name: 'a', strength: 1, active: true }],
    ]);
    node.properties = {
      __lm_widget_ids: ['__lm_autocomplete_meta_text', 'text', 'loras'],
    };

    const defs = getWidgetDefinitions(nodeTypes, node);
    const textDef = defs.find((def) => def.name === 'text');
    expect(textDef).toMatchObject({
      value: '<lora:a:1.00>',
      widgetIndex: 1,
    });
    expect(defs.find((def) => def.type === 'LM_LORA')).toMatchObject({
      widgetIndex: 2,
    });
  });

  it('does not synthesize a phantom lora list for LoRA Text Loader nodes without a list widget', () => {
    const nodeTypes: NodeTypes = {
      'LoRA Text Loader (LoraManager)': {
        input: {
          required: {
            lora_syntax: ['STRING'],
          },
          optional: {},
        },
        input_order: {
          required: ['lora_syntax'],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'LoRA Text Loader (LoraManager)',
        display_name: 'LoRA Text Loader (LoraManager)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(11, 'LoRA Text Loader (LoraManager)', ['<lora:foo:0.8>']);
    const defs = getWidgetDefinitions(nodeTypes, node);

    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: 'lora_syntax',
      value: '<lora:foo:0.8>',
      widgetIndex: 0,
    });
    expect(defs.some((def) => def.type === 'LM_LORA')).toBe(false);
    expect(defs.some((def) => def.type === 'LM_LORA_ADD')).toBe(false);
  });

  it('builds trigger-word synthetic widgets and carries allowStrengthAdjustment', () => {
    const nodeTypes: NodeTypes = {
      'TriggerWord Toggle (LoraManager)': {
        input: {
          required: {
            allow_strength_adjustment: ['BOOLEAN', {}],
          },
          optional: {},
        },
        input_order: {
          required: ['allow_strength_adjustment'],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'TriggerWord Toggle (LoraManager)',
        display_name: 'TriggerWord Toggle (LoraManager)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(2, 'TriggerWord Toggle (LoraManager)', [
      true,
      [{ text: 'foo', active: true, strength: 0.4 }],
      'foo',
    ]);

    const defs = getWidgetDefinitions(nodeTypes, node);
    const tw = defs.find((d) => d.type === 'TW_WORD');
    expect(tw?.options).toMatchObject({ entryIndex: 0, allowStrengthAdjustment: true });
  });

  it('builds standard widget definitions for regular nodes', () => {
    const nodeTypes: NodeTypes = {
      TestNode: {
        input: {
          required: {
            steps: ['INT', {}],
          },
          optional: {},
        },
        output: [],
        output_name: [],
        name: 'TestNode',
        display_name: 'TestNode',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(3, 'TestNode', [20]);
    const defs = getWidgetDefinitions(nodeTypes, node);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: 'steps', type: 'INT', value: 20 });
  });
});
