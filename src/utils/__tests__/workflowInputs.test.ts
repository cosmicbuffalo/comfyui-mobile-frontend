import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildWorkflowPromptInputs,
  getWidgetValue,
  getWorkflowWidgetIndexMap,
  isWidgetInputType,
  normalizeWidgetValue,
  normalizeComboValue,
  optionsAreFileLike,
  isValueCompatible,
  resolveComboOption,
  resolveSource,
} from '../workflowInputs';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';

// ComfyUI seed inputs declare max = 2^64; computed (not a literal) because a
// 0xffffffffffffffff literal silently rounds to 2^64 in a float anyway.
const SEED_MAX = 2 ** 64;

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
    expect(normalizeComboValue('euler', ['euler', 'ddim'])).toBe('euler');
  });

  it('matches by basename (strips path)', () => {
    expect(normalizeComboValue('models/v1-5.safetensors', ['v1-5.safetensors', 'xl.safetensors'])).toBe('v1-5.safetensors');
  });

  it('keeps an unmatched FILE-PICKER value as-is (incomplete option list)', () => {
    // A picked file that isn't in the (stale/incomplete) option list must be
    // sent as-is so the server errors clearly, not swapped for another file.
    expect(normalizeComboValue('my_new_input.png', ['other_a.png', 'other_b.png'])).toBe('my_new_input.png');
    expect(
      normalizeComboValue('subdir/new.safetensors', ['a.safetensors', 'b.safetensors']),
    ).toBe('subdir/new.safetensors');
  });

  it('falls back to the first option for a CLOSED ENUM when nothing matches', () => {
    // Closed enums list every valid value, so an unmatched value is stale.
    // ComfyUI silently drops a node with an out-of-range combo value (and its
    // whole downstream branch), producing "no output". Falling back to the
    // default keeps the prompt executable. Regression: a dynamic
    // ImpactWildcardProcessor "Select to add Wildcard" placeholder captured in
    // widgets_values ("Select Wildcard 🟢 Full Cache") used to be sent verbatim
    // and excluded the entire prompt-processing branch from the run.
    expect(normalizeComboValue('nonexistent', ['euler', 'ddim'])).toBe('euler');
    expect(
      normalizeComboValue(
        'Select Wildcard 🟢 Full Cache',
        ['Select the Wildcard to add to the text'],
      ),
    ).toBe('Select the Wildcard to add to the text');
  });

  it('treats combos with path-like options as file pickers (keeps value)', () => {
    // Format combos such as VHS "video/h264-mp4" contain a path separator and
    // must not be coerced to a different option.
    expect(
      normalizeComboValue('video/unknown-codec', ['video/h264-mp4', 'image/gif']),
    ).toBe('video/unknown-codec');
  });

  it('keeps a file-like value even when the options list looks enum-like', () => {
    // A picker whose current options happen to lack a recognizable extension
    // must not clobber a genuine file selection; the file-like value is kept.
    expect(
      normalizeComboValue('my_model.safetensors', ['baseline', 'turbo']),
    ).toBe('my_model.safetensors');
    expect(
      normalizeComboValue('subdir/clip', ['baseline', 'turbo']),
    ).toBe('subdir/clip');
  });

  it('returns value as-is for empty options', () => {
    expect(normalizeComboValue('anything', [])).toBe('anything');
  });
});

describe('optionsAreFileLike', () => {
  it('detects file-picker option lists (extensions or path separators)', () => {
    expect(optionsAreFileLike(['a.safetensors', 'b.safetensors'])).toBe(true);
    expect(optionsAreFileLike(['subdir/model.ckpt'])).toBe(true);
    expect(optionsAreFileLike(['photo.png', 'clip.mp4'])).toBe(true);
  });

  it('treats human-readable enums as closed (not file-like)', () => {
    expect(optionsAreFileLike(['euler', 'dpmpp_2m'])).toBe(false);
    expect(optionsAreFileLike(['Select the Wildcard to add to the text'])).toBe(false);
    expect(optionsAreFileLike(['enable', 'disable'])).toBe(false);
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

  it('follows KJNodes GetNode/SetNode virtual links', () => {
    const wf: Workflow = {
      last_node_id: 4,
      last_link_id: 2,
      nodes: [
        makeNode(1, 'Loader', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
        }),
        makeNode(2, 'SetNode', {
          inputs: [{ name: 'MODEL', type: 'MODEL', link: 1 }],
          widgets_values: ['shared_model'],
        }),
        makeNode(3, 'GetNode', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [2] }],
          widgets_values: ['shared_model'],
        }),
        makeNode(4, 'KSampler', {
          inputs: [{ name: 'model', type: 'MODEL', link: 2 }],
        }),
      ],
      links: [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 3, 0, 4, 0, 'MODEL'],
      ],
      groups: [],
      config: {},
      version: 1,
    };

    expect(resolveSource(wf, 2)).toEqual({ nodeId: 1, slotIndex: 0 });
  });

  it('scopes KJNodes GetNode/SetNode resolution to the expanded subgraph instance', () => {
    const wf: Workflow = {
      last_node_id: 104,
      last_link_id: 3,
      nodes: [
        makeNode(1, 'FirstLoader', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
        }),
        makeNode(2, 'SetNode', {
          inputs: [{ name: 'MODEL', type: 'MODEL', link: 1 }],
          widgets_values: ['shared_model'],
        }),
        makeNode(101, 'SecondLoader', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [2] }],
        }),
        makeNode(102, 'SetNode', {
          inputs: [{ name: 'MODEL', type: 'MODEL', link: 2 }],
          widgets_values: ['shared_model'],
        }),
        makeNode(103, 'GetNode', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [3] }],
          widgets_values: ['shared_model'],
        }),
        makeNode(104, 'KSampler', {
          inputs: [{ name: 'model', type: 'MODEL', link: 3 }],
        }),
      ],
      links: [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 101, 0, 102, 0, 'MODEL'],
        [3, 103, 0, 104, 0, 'MODEL'],
      ],
      groups: [],
      config: {},
      version: 1,
    };
    const promptKeyMap = new Map<number, string>([
      [2, '10:2'],
      [102, '20:2'],
      [103, '20:3'],
    ]);

    expect(resolveSource(wf, 3, new Set(), promptKeyMap)).toEqual({
      nodeId: 101,
      slotIndex: 0,
    });
  });

  it('does not resolve scoped KJNodes GetNode to a SetNode from another scope', () => {
    const wf: Workflow = {
      last_node_id: 4,
      last_link_id: 2,
      nodes: [
        makeNode(1, 'Loader', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
        }),
        makeNode(2, 'SetNode', {
          inputs: [{ name: 'MODEL', type: 'MODEL', link: 1 }],
          widgets_values: ['shared_model'],
        }),
        makeNode(3, 'GetNode', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [2] }],
          widgets_values: ['shared_model'],
        }),
        makeNode(4, 'KSampler', {
          inputs: [{ name: 'model', type: 'MODEL', link: 2 }],
        }),
      ],
      links: [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 3, 0, 4, 0, 'MODEL'],
      ],
      groups: [],
      config: {},
      version: 1,
    };
    const promptKeyMap = new Map<number, string>([
      [2, '10:2'],
      [3, '20:3'],
    ]);

    expect(resolveSource(wf, 2, new Set(), promptKeyMap)).toBeNull();
  });

  it('serializes scoped KJNodes sources with prompt keys through buildWorkflowPromptInputs', () => {
    const target = makeNode(104, 'KSampler', {
      inputs: [{ name: 'model', type: 'MODEL', link: 3 }],
    });
    const wf: Workflow = {
      last_node_id: 104,
      last_link_id: 3,
      nodes: [
        makeNode(1, 'FirstLoader', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
        }),
        makeNode(2, 'SetNode', {
          inputs: [{ name: 'MODEL', type: 'MODEL', link: 1 }],
          widgets_values: ['shared_model'],
        }),
        makeNode(101, 'SecondLoader', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [2] }],
        }),
        makeNode(102, 'SetNode', {
          inputs: [{ name: 'MODEL', type: 'MODEL', link: 2 }],
          widgets_values: ['shared_model'],
        }),
        makeNode(103, 'GetNode', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [3] }],
          widgets_values: ['shared_model'],
        }),
        target,
      ],
      links: [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 101, 0, 102, 0, 'MODEL'],
        [3, 103, 0, 104, 0, 'MODEL'],
      ],
      groups: [],
      config: {},
      version: 1,
    };
    const promptKeyMap = new Map<number, string>([
      [1, '10:1'],
      [2, '10:2'],
      [101, '20:1'],
      [102, '20:2'],
      [103, '20:3'],
      [104, '20:4'],
    ]);
    const nodeTypes: NodeTypes = {
      KSampler: {
        input: {
          required: {
            model: ['MODEL', {}],
          },
        },
        input_order: {
          required: ['model'],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'KSampler',
        display_name: 'KSampler',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputs = buildWorkflowPromptInputs(
      wf,
      nodeTypes,
      target,
      'KSampler',
      new Set([1, 101, 104]),
      null,
      undefined,
      promptKeyMap,
    );

    expect(inputs.model).toEqual(['20:1', 0]);
  });

  it('returns null for GetNode without a matching SetNode', () => {
    const wf: Workflow = {
      last_node_id: 2,
      last_link_id: 1,
      nodes: [
        makeNode(1, 'GetNode', {
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
          widgets_values: ['missing_model'],
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

    expect(resolveSource(wf, 1)).toBeNull();
  });
});

describe('seed override application in buildWorkflowPromptInputs', () => {
  it("replaces a 'seed' INT widget value with the override (stock KSampler)", () => {
    const node = makeNode(1, 'KSampler', {
      widgets_values: [-1],
    });
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const nodeTypes: NodeTypes = {
      KSampler: {
        input: {
          required: {
            seed: ['INT', { default: 0, min: 0, max: SEED_MAX }],
          },
        },
        input_order: { required: ['seed'], optional: [] },
        output: [],
        output_name: [],
        name: 'KSampler',
        display_name: 'KSampler',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputs = buildWorkflowPromptInputs(
      wf, nodeTypes, node, 'KSampler', new Set([1]), null, { 1: 12345 },
    );

    expect(inputs.seed).toBe(12345);
  });

  it("replaces a 'noise_seed' INT widget value with the override (Efficient KSampler Adv)", () => {
    // Regression for issue #57: Efficient KSampler Adv names its seed input
    // 'noise_seed' with min=0. When the user picks a special seed mode the
    // widget holds -1, and the override path must rewrite inputs.noise_seed
    // rather than passing -1 through to the server.
    const node = makeNode(1, 'KSampler Adv (Efficient)', {
      widgets_values: ['enable', -1],
    });
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const nodeTypes: NodeTypes = {
      'KSampler Adv (Efficient)': {
        input: {
          required: {
            add_noise: [['enable', 'disable'], {}],
            noise_seed: ['INT', { default: 0, min: 0, max: SEED_MAX }],
          },
        },
        input_order: { required: ['add_noise', 'noise_seed'], optional: [] },
        output: [],
        output_name: [],
        name: 'KSampler Adv (Efficient)',
        display_name: 'KSampler Adv (Efficient)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputs = buildWorkflowPromptInputs(
      wf, nodeTypes, node, 'KSampler Adv (Efficient)', new Set([1]), null, { 1: 67890 },
    );

    expect(inputs.noise_seed).toBe(67890);
    expect(inputs.add_noise).toBe('enable');
  });

  it("reads later widgets at the correct index when control_after_generate is stripped (Efficient KSampler Adv)", () => {
    // Regression for the off-by-one bug: Efficient Nodes removes the auto
    // control_after_generate widget on the JS side, so widgets_values is one
    // slot shorter than the declared widget order. Inputs after noise_seed
    // (sampler_name, scheduler, preview_method, etc.) should still read from
    // the right positions instead of being shifted by one.
    const node = makeNode(1, 'KSampler Adv (Efficient)', {
      widgets_values: [
        'enable',     // add_noise
        42,           // noise_seed
        // (no control_after_generate slot — stripped by Efficient Nodes)
        20,           // steps
        'euler',      // sampler_name
        'karras',     // scheduler
        'auto',       // preview_method
      ],
    });
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const nodeTypes: NodeTypes = {
      'KSampler Adv (Efficient)': {
        input: {
          required: {
            add_noise: [['enable', 'disable'], {}],
            noise_seed: ['INT', { default: 0, min: 0, max: SEED_MAX }],
            steps: ['INT', { default: 20, min: 1, max: 10000 }],
            sampler_name: [['euler', 'dpmpp_2m'], {}],
            scheduler: [['karras', 'normal'], {}],
            preview_method: [['auto', 'latent2rgb', 'taesd', 'none'], {}],
          },
        },
        input_order: {
          required: ['add_noise', 'noise_seed', 'steps', 'sampler_name', 'scheduler', 'preview_method'],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'KSampler Adv (Efficient)',
        display_name: 'KSampler Adv (Efficient)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputs = buildWorkflowPromptInputs(
      wf, nodeTypes, node, 'KSampler Adv (Efficient)', new Set([1]), null,
    );

    expect(inputs.noise_seed).toBe(42);
    expect(inputs.steps).toBe(20);
    expect(inputs.sampler_name).toBe('euler');
    expect(inputs.scheduler).toBe('karras');
    expect(inputs.preview_method).toBe('auto');
  });

  it("skips a control_after_generate slot that is present but null (KSampler SDXL Eff. real-world workflow)", () => {
    // Regression for the KSampler SDXL (Eff.) shape observed in user
    // workflows: the control_after_generate slot is retained at index 1
    // but its value is null. The walker must still treat it as the control
    // slot (skip past it) so the following inputs read from the right
    // positions and the seed override applies to noise_seed.
    const node = makeNode(1, 'KSampler SDXL (Eff.)', {
      widgets_values: [
        -1,                  // noise_seed
        null,                // control_after_generate (present but blank)
        35,                  // steps
        6.5,                 // cfg
        'euler_ancestral',   // sampler_name
        'karras',            // scheduler
        0,                   // start_at_step
        -1,                  // refine_at_step
        'latent2rgb',        // preview_method
        'true',              // vae_decode
      ],
    });
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const nodeTypes: NodeTypes = {
      'KSampler SDXL (Eff.)': {
        input: {
          required: {
            noise_seed: ['INT', { default: 0, min: 0, max: SEED_MAX }],
            steps: ['INT', { default: 20, min: 1, max: 10000 }],
            cfg: ['FLOAT', { default: 7.0, min: 0.0, max: 100.0 }],
            sampler_name: [['euler', 'euler_ancestral', 'dpmpp_2m'], {}],
            scheduler: [['karras', 'normal'], {}],
            start_at_step: ['INT', { default: 0, min: 0, max: 10000 }],
            refine_at_step: ['INT', { default: -1, min: -1, max: 10000 }],
            preview_method: [['auto', 'latent2rgb', 'taesd', 'none'], {}],
            vae_decode: [['true', 'true (tiled)', 'false'], {}],
          },
        },
        input_order: {
          required: [
            'noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler',
            'start_at_step', 'refine_at_step', 'preview_method', 'vae_decode',
          ],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'KSampler SDXL (Eff.)',
        display_name: 'KSampler SDXL (Eff.)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputs = buildWorkflowPromptInputs(
      wf, nodeTypes, node, 'KSampler SDXL (Eff.)', new Set([1]), null, { 1: 999 },
    );

    expect(inputs.noise_seed).toBe(999); // override applied
    expect(inputs.steps).toBe(35);
    expect(inputs.cfg).toBe(6.5);
    expect(inputs.sampler_name).toBe('euler_ancestral');
    expect(inputs.scheduler).toBe('karras');
    expect(inputs.start_at_step).toBe(0);
    expect(inputs.refine_at_step).toBe(-1);
    expect(inputs.preview_method).toBe('latent2rgb');
    expect(inputs.vae_decode).toBe('true');
  });

  it("still skips the control_after_generate slot when it is present (stock KSampler)", () => {
    const node = makeNode(1, 'KSampler', {
      widgets_values: [
        42,           // seed
        'fixed',      // control_after_generate (stock ComfyUI auto-widget)
        20,           // steps
        'euler',      // sampler_name
      ],
    });
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const nodeTypes: NodeTypes = {
      KSampler: {
        input: {
          required: {
            seed: ['INT', { default: 0, min: 0, max: SEED_MAX }],
            steps: ['INT', { default: 20, min: 1, max: 10000 }],
            sampler_name: [['euler', 'dpmpp_2m'], {}],
          },
        },
        input_order: { required: ['seed', 'steps', 'sampler_name'], optional: [] },
        output: [],
        output_name: [],
        name: 'KSampler',
        display_name: 'KSampler',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputs = buildWorkflowPromptInputs(
      wf, nodeTypes, node, 'KSampler', new Set([1]), null,
    );

    expect(inputs.seed).toBe(42);
    expect(inputs.steps).toBe(20);
    expect(inputs.sampler_name).toBe('euler');
  });

  it("leaves the seed alone when no override is present", () => {
    const node = makeNode(1, 'KSampler Adv (Efficient)', {
      widgets_values: ['enable', 42],
    });
    const wf: Workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const nodeTypes: NodeTypes = {
      'KSampler Adv (Efficient)': {
        input: {
          required: {
            add_noise: [['enable', 'disable'], {}],
            noise_seed: ['INT', { default: 0, min: 0, max: SEED_MAX }],
          },
        },
        input_order: { required: ['add_noise', 'noise_seed'], optional: [] },
        output: [],
        output_name: [],
        name: 'KSampler Adv (Efficient)',
        display_name: 'KSampler Adv (Efficient)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputs = buildWorkflowPromptInputs(
      wf, nodeTypes, node, 'KSampler Adv (Efficient)', new Set([1]), null, undefined,
    );

    expect(inputs.noise_seed).toBe(42);
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
