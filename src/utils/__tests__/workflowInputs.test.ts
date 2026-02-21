import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildWorkflowPromptInputs,
  getWidgetValue,
  getWorkflowWidgetIndexMap,
  isWidgetInputType,
  normalizeWidgetValue,
  normalizeComboValue,
  isValueCompatible,
  resolveComboOption,
  resolveSource,
} from '../workflowInputs';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';

afterEach(() => {
  vi.useRealTimers();
});

function makeNode(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  };
}

describe('getWidgetValue', () => {
  it('returns value by index from array widgets_values', () => {
    const node = makeNode(1, 'KSampler', { widgets_values: [42, 'euler', 20] });
    expect(getWidgetValue(node, 'seed', 0)).toBe(42);
    expect(getWidgetValue(node, 'sampler_name', 1)).toBe('euler');
    expect(getWidgetValue(node, 'steps', 2)).toBe(20);
  });

  it('returns undefined for out-of-bounds index', () => {
    const node = makeNode(1, 'KSampler', { widgets_values: [42] });
    expect(getWidgetValue(node, 'x', 5)).toBeUndefined();
    expect(getWidgetValue(node, 'x', -1)).toBeUndefined();
  });

  it('returns undefined when index is undefined', () => {
    const node = makeNode(1, 'KSampler', { widgets_values: [42] });
    expect(getWidgetValue(node, 'x', undefined)).toBeUndefined();
  });

  it('returns value by name from record widgets_values', () => {
    const node = makeNode(1, 'Custom', {
      widgets_values: { seed: 42, sampler: 'euler' } as unknown as Record<string, unknown>,
    });
    expect(getWidgetValue(node, 'seed', 0)).toBe(42);
    expect(getWidgetValue(node, 'sampler', 1)).toBe('euler');
  });

  it('handles VHS_VideoCombine save_image/save_output alias', () => {
    const node = makeNode(1, 'VHS_VideoCombine', {
      widgets_values: { save_output: true } as unknown as Record<string, unknown>,
    });
    expect(getWidgetValue(node, 'save_image', 0)).toBe(true);
  });
});

describe('getWorkflowWidgetIndexMap', () => {
  it('returns map from widget_idx_map', () => {
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [],
      links: [],
      groups: [],
      config: {},
      version: 1,
      widget_idx_map: { '1': { seed: 0, steps: 1 } },
    };
    expect(getWorkflowWidgetIndexMap(wf, 1)).toEqual({ seed: 0, steps: 1 });
  });

  it('falls back to extra.widget_idx_map', () => {
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [],
      links: [],
      groups: [],
      config: {},
      version: 1,
      extra: { widget_idx_map: { '1': { cfg: 2 } } },
    };
    expect(getWorkflowWidgetIndexMap(wf, 1)).toEqual({ cfg: 2 });
  });

  it('returns null when no map exists', () => {
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    expect(getWorkflowWidgetIndexMap(wf, 1)).toBeNull();
  });
});

describe('isWidgetInputType', () => {
  it('returns true for standard widget types', () => {
    expect(isWidgetInputType('INT')).toBe(true);
    expect(isWidgetInputType('FLOAT')).toBe(true);
    expect(isWidgetInputType('BOOLEAN')).toBe(true);
    expect(isWidgetInputType('STRING')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isWidgetInputType('int')).toBe(true);
    expect(isWidgetInputType('Float')).toBe(true);
  });

  it('returns true for combo arrays', () => {
    expect(isWidgetInputType(['euler', 'ddim', 'dpm'])).toBe(true);
  });

  it('returns false for non-widget types', () => {
    expect(isWidgetInputType('MODEL')).toBe(false);
    expect(isWidgetInputType('LATENT')).toBe(false);
    expect(isWidgetInputType('CONDITIONING')).toBe(false);
  });
});

describe('normalizeWidgetValue', () => {
  it('converts string to int for INT type', () => {
    expect(normalizeWidgetValue('42', 'INT')).toBe(42);
    expect(normalizeWidgetValue('3.7', 'INT')).toBe(3); // truncates
  });

  it('converts string to float for FLOAT type', () => {
    expect(normalizeWidgetValue('3.14', 'FLOAT')).toBe(3.14);
  });

  it('converts string booleans for BOOLEAN type', () => {
    expect(normalizeWidgetValue('true', 'BOOLEAN')).toBe(true);
    expect(normalizeWidgetValue('false', 'BOOLEAN')).toBe(false);
    expect(normalizeWidgetValue('TRUE', 'BOOLEAN')).toBe(true);
  });

  it('passes through non-string values unchanged', () => {
    expect(normalizeWidgetValue(42, 'INT')).toBe(42);
    expect(normalizeWidgetValue(true, 'BOOLEAN')).toBe(true);
  });

  it('does not convert empty or non-numeric strings for INT/FLOAT', () => {
    expect(normalizeWidgetValue('', 'INT')).toBe('');
    expect(normalizeWidgetValue('abc', 'FLOAT')).toBe('abc');
  });

  it('resolves combo index to value when comboIndexToValue is true', () => {
    const options = ['euler', 'ddim', 'dpm'];
    expect(normalizeWidgetValue(1, options, { comboIndexToValue: true })).toBe('ddim');
  });

  it('returns original value if combo index is out of range', () => {
    const options = ['euler', 'ddim'];
    expect(normalizeWidgetValue(99, options, { comboIndexToValue: true })).toBe(99);
  });

  it('passes through combo value without comboIndexToValue', () => {
    expect(normalizeWidgetValue('euler', ['euler', 'ddim'])).toBe('euler');
  });
});

describe('normalizeComboValue', () => {
  it('returns direct match from options', () => {
    expect(normalizeComboValue('euler', ['euler', 'ddim'], undefined)).toBe('euler');
  });

  it('matches by basename (strips path)', () => {
    expect(normalizeComboValue('models/v1-5.safetensors', ['v1-5.safetensors', 'xl.safetensors'], undefined)).toBe('v1-5.safetensors');
  });

  it('falls back to default value if present in options', () => {
    expect(normalizeComboValue('nonexistent', ['euler', 'ddim'], 'ddim')).toBe('ddim');
  });

  it('falls back to first option when nothing matches', () => {
    expect(normalizeComboValue('nonexistent', ['euler', 'ddim'], 'also_nonexistent')).toBe('euler');
  });

  it('returns value as-is for empty options', () => {
    expect(normalizeComboValue('anything', [], undefined)).toBe('anything');
  });
});

describe('isValueCompatible', () => {
  it('checks combo membership', () => {
    expect(isValueCompatible('euler', ['euler', 'ddim'])).toBe(true);
    expect(isValueCompatible('unknown', ['euler', 'ddim'])).toBe(false);
  });

  it('checks numeric compatibility for INT and FLOAT', () => {
    expect(isValueCompatible(42, 'INT')).toBe(true);
    expect(isValueCompatible('42', 'INT')).toBe(true);
    expect(isValueCompatible('abc', 'INT')).toBe(false);
    expect(isValueCompatible('', 'FLOAT')).toBe(false);
    expect(isValueCompatible(3.14, 'FLOAT')).toBe(true);
  });

  it('checks boolean compatibility', () => {
    expect(isValueCompatible(true, 'BOOLEAN')).toBe(true);
    expect(isValueCompatible('true', 'BOOLEAN')).toBe(true);
    expect(isValueCompatible('false', 'BOOLEAN')).toBe(true);
    expect(isValueCompatible('yes', 'BOOLEAN')).toBe(false);
    expect(isValueCompatible(42, 'BOOLEAN')).toBe(false);
  });

  it('checks string compatibility', () => {
    expect(isValueCompatible('hello', 'STRING')).toBe(true);
    expect(isValueCompatible(42, 'STRING')).toBe(false);
  });

  it('returns true for unknown types', () => {
    expect(isValueCompatible('anything', 'CUSTOM_TYPE')).toBe(true);
  });
});

describe('resolveSource', () => {
  it('resolves a direct link to source node', () => {
    const wf: Workflow = {
      last_node_id: 2,
      last_link_id: 1,
      nodes: [
        makeNode(1, 'Loader'),
        makeNode(2, 'KSampler', { inputs: [{ name: 'model', type: 'MODEL', link: 1 }] }),
      ],
      links: [[1, 1, 0, 2, 0, 'MODEL']],
      groups: [],
      config: {},
      version: 1,
    };

    const result = resolveSource(wf, 1);
    expect(result).toEqual({ nodeId: 1, slotIndex: 0 });
  });

  it('follows Reroute nodes recursively', () => {
    const wf: Workflow = {
      last_node_id: 3,
      last_link_id: 2,
      nodes: [
        makeNode(1, 'Loader', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
        }),
        makeNode(2, 'Reroute', {
          inputs: [{ name: 'in', type: 'MODEL', link: 1 }],
          outputs: [{ name: 'out', type: 'MODEL', links: [2] }],
        }),
        makeNode(3, 'KSampler', {
          inputs: [{ name: 'model', type: 'MODEL', link: 2 }],
        }),
      ],
      links: [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 2, 0, 3, 0, 'MODEL'],
      ],
      groups: [],
      config: {},
      version: 1,
    };

    // Resolve link 2 (Reroute -> KSampler), should trace back to Loader
    const result = resolveSource(wf, 2);
    expect(result).toEqual({ nodeId: 1, slotIndex: 0 });
  });

  it('follows muted nodes (mode 4) like reroutes', () => {
    const wf: Workflow = {
      last_node_id: 3,
      last_link_id: 2,
      nodes: [
        makeNode(1, 'Loader', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
        }),
        makeNode(2, 'SomeNode', {
          mode: 4, // muted
          inputs: [{ name: 'in', type: 'MODEL', link: 1 }],
          outputs: [{ name: 'out', type: 'MODEL', links: [2] }],
        }),
        makeNode(3, 'KSampler', {
          inputs: [{ name: 'model', type: 'MODEL', link: 2 }],
        }),
      ],
      links: [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 2, 0, 3, 0, 'MODEL'],
      ],
      groups: [],
      config: {},
      version: 1,
    };

    const result = resolveSource(wf, 2);
    expect(result).toEqual({ nodeId: 1, slotIndex: 0 });
  });

  it('returns null for non-existent link', () => {
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [makeNode(1, 'Loader')],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    expect(resolveSource(wf, 999)).toBeNull();
  });

  it('returns null for reroute with no input connection', () => {
    const wf: Workflow = {
      last_node_id: 2,
      last_link_id: 1,
      nodes: [
        makeNode(1, 'Reroute', {
          inputs: [{ name: 'in', type: 'MODEL', link: null }],
          outputs: [{ name: 'out', type: 'MODEL', links: [1] }],
        }),
        makeNode(2, 'KSampler', {
          inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
        }),
      ],
      links: [[1, 1, 0, 2, 0, 'MODEL']],
      groups: [],
      config: {},
      version: 1,
    };

    const result = resolveSource(wf, 1);
    expect(result).toBeNull();
  });
});

describe('resolveComboOption', () => {
  it('matches extensionless and base-path values to combo options', () => {
    const options = ['foo.safetensors', 'bar.safetensors'];
    expect(resolveComboOption('models/foo', options)).toBe('foo.safetensors');
    expect(resolveComboOption('nested/path/bar.safetensors', options)).toBe('bar.safetensors');
  });

  it('resolves numeric combo index values to option value', () => {
    const options = ['euler', 'ddim', 'dpmpp'];
    expect(resolveComboOption(1, options)).toBe('ddim');
  });
});

describe('lora manager prompt serialization', () => {
  const nodeTypes: NodeTypes = {
    'Lora Loader (LoraManager)': {
      input: {
        required: {
          text: ['STRING', {}],
        },
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

  it('includes loras input from widgetIndexMap in workflow prompt', () => {
    const loras = [{ name: 'foo.safetensors', strength: 0.7 }];
    const node = makeNode(1, 'Lora Loader (LoraManager)', {
      widgets_values: ['prompt', loras],
    });
    const workflow: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };

    const inputs = buildWorkflowPromptInputs(
      workflow,
      nodeTypes,
      node,
      'Lora Loader (LoraManager)',
      new Set([1]),
      { text: 0, loras: 1 },
    );

    expect(inputs).toMatchObject({
      text: 'prompt',
      loras,
    });
  });

});

describe('trigger word prompt serialization', () => {
  const nodeTypes: NodeTypes = {
    'TriggerWord Toggle (LoraManager)': {
      input: {
        required: {
          group_mode: ['BOOLEAN', {}],
          default_active: ['BOOLEAN', {}],
          allow_strength_adjustment: ['BOOLEAN', {}],
        },
      },
      input_order: {
        required: ['group_mode', 'default_active', 'allow_strength_adjustment'],
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

  function makeTriggerWorkflow(node: WorkflowNode): Workflow {
    return {
      last_node_id: node.id,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
  }

  it('uses originalMessage key when present in widgetIndexMap', () => {
    const list = [{ text: 'foo', active: true }];
    const node = makeNode(5, 'TriggerWord Toggle (LoraManager)', {
      widgets_values: [true, true, false, list, 'foo'],
    });
    const workflow = makeTriggerWorkflow(node);
    const inputs = buildWorkflowPromptInputs(
      workflow,
      nodeTypes,
      node,
      'TriggerWord Toggle (LoraManager)',
      new Set([5]),
      { group_mode: 0, default_active: 1, allow_strength_adjustment: 2, toggle_trigger_words: 3, originalMessage: 4 },
    );

    expect(inputs.toggle_trigger_words).toEqual(list);
    expect(inputs.originalMessage).toBe('foo');
  });

  it('falls back to orinalMessage key when originalMessage is not mapped', () => {
    const list = [{ text: 'foo', active: true }];
    const node = makeNode(6, 'TriggerWord Toggle (LoraManager)', {
      widgets_values: [true, true, false, list, 'foo'],
    });
    const workflow = makeTriggerWorkflow(node);
    const inputs = buildWorkflowPromptInputs(
      workflow,
      nodeTypes,
      node,
      'TriggerWord Toggle (LoraManager)',
      new Set([6]),
      { group_mode: 0, default_active: 1, allow_strength_adjustment: 2, toggle_trigger_words: 3 },
    );

    expect(inputs.toggle_trigger_words).toEqual(list);
    expect(inputs.orinalMessage).toBe('foo');
  });

  it('prefers mapped trigger-word list index when earlier empty arrays exist', () => {
    const list = [{ text: 'mapped', active: true }];
    const node = makeNode(7, 'TriggerWord Toggle (LoraManager)', {
      widgets_values: [true, [], false, list, 'mapped'],
    });
    const workflow = makeTriggerWorkflow(node);
    const inputs = buildWorkflowPromptInputs(
      workflow,
      nodeTypes,
      node,
      'TriggerWord Toggle (LoraManager)',
      new Set([7]),
      { group_mode: 0, default_active: 2, toggle_trigger_words: 3, originalMessage: 4 },
    );

    expect(inputs.toggle_trigger_words).toEqual(list);
    expect(inputs.originalMessage).toBe('mapped');
  });
});

describe('filename_prefix replacements', () => {
  const nodeTypes: NodeTypes = {
    EmptyLatentImage: {
      input: {
        required: {
          width: ['INT', {}],
          height: ['INT', {}],
        },
      },
      input_order: {
        required: ['width', 'height'],
        optional: [],
      },
      output: [],
      output_name: [],
      name: 'EmptyLatentImage',
      display_name: 'Empty Latent Image',
      description: '',
      python_module: '',
      category: '',
    },
    SaveImage: {
      input: {
        required: {
          images: ['IMAGE', {}],
          filename_prefix: ['STRING', {}],
        },
      },
      input_order: {
        required: ['images', 'filename_prefix'],
        optional: [],
      },
      output: [],
      output_name: [],
      name: 'SaveImage',
      display_name: 'SaveImage',
      description: '',
      python_module: '',
      category: '',
    },
  };

  function createWorkflow(): { workflow: Workflow; saveNode: WorkflowNode } {
    const sourceNode = makeNode(1, 'EmptyLatentImage', {
      properties: {
        'Node name for S&R': 'Empty Latent Image',
      },
      widgets_values: [768, 512],
    });

    const saveNode = makeNode(2, 'SaveImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: null }],
      widgets_values: ['video/%date:yyyy-MM-dd%/%date:hhmmss%_%Empty Latent Image.width%?bad'],
    });

    const workflow: Workflow = {
      last_node_id: 2,
      last_link_id: 0,
      nodes: [sourceNode, saveNode],
      links: [],
      groups: [],
      config: {},
      version: 1,
      widget_idx_map: {
        '1': { width: 0, height: 1 },
        '2': { filename_prefix: 0 },
      },
    };

    return { workflow, saveNode };
  }

  it('applies %date and %Node.widget replacements in workflow prompt serialization', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T14:05:09'));

    const { workflow, saveNode } = createWorkflow();
    const inputs = buildWorkflowPromptInputs(
      workflow,
      nodeTypes,
      saveNode,
      'SaveImage',
      new Set([1, 2]),
      { filename_prefix: 0 },
    );

    expect(inputs.filename_prefix).toBe('video/2026-02-21/140509_768?bad');
  });

});
