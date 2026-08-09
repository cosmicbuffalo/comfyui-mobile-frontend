/**
 * The 3.1.0 editing flows (add node, compatible-node search) classify inputs as
 * "socket" vs "widget" independently of the queue/render paths. Current
 * ComfyUI V3 widgets also have a socket unless explicitly socketless, while
 * legacy array combos remain widget-only and every combo form needs a usable
 * widget default.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import {
  buildDefaultWidgetValues,
  buildDefaultConnectionInputs,
  buildWorkflowPromptInputs,
  getDefaultWidgetValue,
  isMultiSelectCombo,
  isWidgetBackedInput,
  isConnectionSocketInput,
  rebuildDynamicComboNode,
  rebuildDynamicComboWidgetValues,
} from '../workflowInputs';
import { findCompatibleNodeTypesForOutput } from '../connectionUtils';
import { getInputWidgetDefinitions, getWidgetDefinitions } from '../widgetDefinitions';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fullNodes = JSON.parse(
  readFileSync(join(fixturesDir, 'v3ComboFullNodes.json'), 'utf8')
) as NodeTypes;

describe('isWidgetBackedInput', () => {
  it('treats legacy array combos and primitives as widgets', () => {
    expect(isWidgetBackedInput(['a', 'b'])).toBe(true);
    for (const t of ['INT', 'FLOAT', 'STRING', 'BOOLEAN']) {
      expect(isWidgetBackedInput(t), t).toBe(true);
    }
  });

  it('treats V3 string-typed combos as widgets', () => {
    for (const t of ['COMBO', 'COMFY_DYNAMICCOMBO_V3', 'EASY_COMBO']) {
      expect(isWidgetBackedInput(t), t).toBe(true);
    }
  });

  it('uses a concrete default or explicit schema flags as widget evidence', () => {
    expect(isWidgetBackedInput('COLOR', { default: '#fff' })).toBe(true);
    expect(isWidgetBackedInput('WANVIDLORA', { default: null })).toBe(false);
    expect(isWidgetBackedInput('COLOR', { default: '#fff', socketless: true })).toBe(true);
    expect(isWidgetBackedInput('CUSTOM', { widgetType: 'STRING' })).toBe(true);
    expect(isWidgetBackedInput('INT', { forceInput: true })).toBe(false);
  });

  it('leaves genuine connection types as sockets', () => {
    for (const t of ['IMAGE', 'MODEL', 'LATENT', 'COMFY_MATCHTYPE_V3', 'COMFY_AUTOGROW_V3']) {
      expect(isWidgetBackedInput(t), t).toBe(false);
    }
  });
});

describe('isConnectionSocketInput', () => {
  it('gives V3 combo and primitive widgets a coexisting socket', () => {
    for (const t of ['COMBO', 'COMFY_DYNAMICCOMBO_V3', 'EASY_COMBO', 'INT', 'STRING']) {
      expect(isConnectionSocketInput(t), t).toBe(true);
    }
    expect(isConnectionSocketInput(['a', 'b'])).toBe(false);
  });

  /**
   * A declared default must not disqualify a socket. Real connection inputs
   * carry one (WanVideoModelLoader.lora, LayerFilter: HDREffects.image, the
   * wildcard inputs on easy compare); treating "has a default" as widget-only
   * made those nodes unreachable from the compatible-node search.
   */
  it('keeps socket types that also declare a default', () => {
    for (const t of ['COLOR', 'WANVIDLORA', 'BOUNDING_BOX', 'MASK', 'IMAGE', '*']) {
      expect(isConnectionSocketInput(t), t).toBe(true);
    }
  });

  it('honours socketless and forceInput', () => {
    expect(isConnectionSocketInput('COLOR', { default: '#fff', socketless: true })).toBe(false);
    expect(isConnectionSocketInput('INT', { forceInput: true })).toBe(true);
    expect(isConnectionSocketInput('INT', { defaultInput: true })).toBe(true);
    expect(isConnectionSocketInput('CUSTOM', { widgetType: 'STRING' })).toBe(true);
    expect(isConnectionSocketInput('CUSTOM', { widgetType: 'STRING', socketless: true })).toBe(false);
  });
});

describe('getDefaultWidgetValue', () => {
  it('prefers the declared default, else the first combo option', () => {
    const [type, opts] = fullNodes.ResizeImageMaskNode.input.required!.scale_method;
    expect(getDefaultWidgetValue(type, opts)).toBe('area'); // declared default

    const [dynType, dynOpts] = fullNodes.ResizeImageMaskNode.input.required!.resize_type;
    expect(getDefaultWidgetValue(dynType, dynOpts)).toBe('scale dimensions'); // first option
  });

  it('starts a multi-select combo with an array value', () => {
    const opts = { options: [0, 1, 2], multi_select: { placeholder: 'Choose' } };
    expect(isMultiSelectCombo(opts)).toBe(true);
    expect(isMultiSelectCombo({ options: [0, 1], multiselect: { chip: true } })).toBe(true);
    expect(getDefaultWidgetValue('EASY_COMBO', opts)).toEqual([]);
    expect(getDefaultWidgetValue('EASY_COMBO', { ...opts, default: 0 })).toEqual([0]);
  });

  it('omits the seed control slot only when object_info disables it', () => {
    const makeType = (control_after_generate?: boolean | string) => ({
      input: { required: {
        seed: ['INT', { default: 0, ...(control_after_generate === undefined ? {} : { control_after_generate }) }],
        steps: ['INT', { default: 20 }],
      } },
      input_order: { required: ['seed', 'steps'] },
    }) as unknown as NodeTypes[string];

    expect(buildDefaultWidgetValues(makeType(true))).toEqual([0, 'randomize', 20]);
    expect(buildDefaultWidgetValues(makeType('increment'))).toEqual([0, 'increment', 20]);
    expect(buildDefaultWidgetValues(makeType(false))).toEqual([0, 20]);
    // No flag: desktop falls back to the seed/noise_seed name and still adds
    // the control widget, so the slot must exist for round-trip alignment.
    expect(buildDefaultWidgetValues(makeType())).toEqual([0, 'randomize', 20]);
  });
});

describe('adding a node with V3 combos', () => {
  it('ResizeImageMaskNode: combos become widgets, not sockets', () => {
    const typeDef = fullNodes.ResizeImageMaskNode;
    const required = typeDef.input.required!;

    // Widgets retain their coexisting sockets under current ComfyUI semantics.
    expect(isConnectionSocketInput(required.input[0])).toBe(true);
    expect(isConnectionSocketInput(...required.resize_type)).toBe(true);
    expect(isConnectionSocketInput(...required.scale_method)).toBe(true);
    expect(isWidgetBackedInput(...required.resize_type)).toBe(true);
    expect(isWidgetBackedInput(...required.scale_method)).toBe(true);

    // Default option is "scale dimensions" -> width, height, crop.
    expect(buildDefaultWidgetValues(typeDef)).toEqual([
      'scale dimensions', 512, 512, 'center', 'area',
    ]);
  });

  it('produces widgets_values the render path reads back correctly', () => {
    for (const nodeType of Object.keys(fullNodes)) {
      const typeDef = fullNodes[nodeType];
      const widgets = buildDefaultWidgetValues(typeDef);
      // Mirror addNode, including active DynamicCombo child sockets.
      const inputs = buildDefaultConnectionInputs(typeDef).map((input) => ({
        ...input,
        link: null,
      }));
      const node = {
        id: 1, type: nodeType, pos: [0, 0] as [number, number], size: [200, 100] as [number, number],
        flags: {}, order: 0, mode: 0, inputs, outputs: [], properties: {},
        widgets_values: widgets,
      };
      const defs = [
        ...getWidgetDefinitions(fullNodes, node),
        ...getInputWidgetDefinitions(fullNodes, node),
      ];
      // Every widget the UI renders must land inside the values we generated,
      // otherwise a freshly added node shows blanks or reads a neighbour's value.
      for (const def of defs) {
        expect(def.widgetIndex, `${nodeType}.${def.name} index out of range`)
          .toBeLessThan(widgets.length);
        expect(def.value, `${nodeType}.${def.name} value`).toBe(widgets[def.widgetIndex]);
      }
    }
  });

  it('does not create a phantom widget slot for a defaulted custom socket', () => {
    const typeDef = {
      input: {
        required: {
          lora: ['WANVIDLORA', { default: null }],
          strength: ['FLOAT', { default: 1 }],
        },
      },
      input_order: { required: ['lora', 'strength'] },
    } as unknown as NodeTypes[string];

    expect(buildDefaultConnectionInputs(typeDef)).toEqual([
      { name: 'lora', type: 'WANVIDLORA' },
      { name: 'strength', type: 'FLOAT', widget: { name: 'strength' } },
    ]);
    expect(buildDefaultWidgetValues(typeDef)).toEqual([1]);
  });

  it('keeps legacy array combos out of serialized connection sockets', () => {
    const typeDef = {
      input: { required: {
        checkpoint: [['a.safetensors', 'b.safetensors']],
        model: ['MODEL'],
      } },
      input_order: { required: ['checkpoint', 'model'] },
    } as unknown as NodeTypes[string];

    expect(buildDefaultConnectionInputs(typeDef)).toEqual([
      { name: 'model', type: 'MODEL' },
    ]);
    expect(buildDefaultWidgetValues(typeDef)).toEqual(['a.safetensors']);
  });

  it('retains legacy custom widgets without markers in the slot and prompt walks', () => {
    const nodeTypes = {
      PaintedBorder: {
        input: { required: {
          color: ['COLOR', { default: '#ffffff' }],
          thickness: ['INT', { default: 1 }],
        } },
        input_order: { required: ['color', 'thickness'] },
        output: [], output_name: [], name: 'PaintedBorder', display_name: 'Painted Border',
        description: '', python_module: '', category: 'test',
      },
    } as unknown as NodeTypes;
    const node = {
      id: 1, type: 'PaintedBorder', pos: [0, 0] as [number, number],
      size: [200, 100] as [number, number], flags: {}, order: 0, mode: 0,
      // Older mobile workflows materialized the socket but omitted its marker.
      inputs: [{ name: 'color', type: 'COLOR', link: null }],
      outputs: [], properties: {}, widgets_values: ['#123456', 7],
    };
    const workflow = {
      last_node_id: 1, last_link_id: 0, nodes: [node], links: [], groups: [],
      config: {}, version: 0.4,
    } as unknown as Workflow;

    expect(getWidgetDefinitions(nodeTypes, node).map((widget) => [widget.name, widget.value]))
      .toEqual([['color', '#123456'], ['thickness', 7]]);
    expect(buildWorkflowPromptInputs(
      workflow, nodeTypes, node, 'PaintedBorder', new Set([1]), null,
    )).toMatchObject({ color: '#123456', thickness: 7 });
  });

  it('uses a DynamicCombo default to discover children when its saved slot is truncated', () => {
    const nodeTypes = {
      Truncated: {
        input: { required: {
          mode: ['COMFY_DYNAMICCOMBO_V3', { options: [
            { key: 'default', inputs: { required: { amount: ['FLOAT', { default: 1 }] } } },
          ] }],
        } },
        input_order: { required: ['mode'] },
        output: [], output_name: [], name: 'Truncated', display_name: 'Truncated',
        description: '', python_module: '', category: 'test',
      },
    } as unknown as NodeTypes;
    const node = {
      id: 1, type: 'Truncated', pos: [0, 0] as [number, number], size: [200, 100] as [number, number],
      flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: [],
    };

    expect([
      ...getInputWidgetDefinitions(nodeTypes, node),
      ...getWidgetDefinitions(nodeTypes, node),
    ].map((widget) => widget.inputName))
      .toEqual(['mode', 'mode.amount']);
  });
});

describe('rebuildDynamicComboWidgetValues', () => {
  const resizeDef = fullNodes.ResizeImageMaskNode.input.required!.resize_type;
  const makeResize = (widgets: unknown[]) => ({
    id: 1, type: 'ResizeImageMaskNode', pos: [0, 0] as [number, number],
    size: [200, 100] as [number, number], flags: {}, order: 0, mode: 0,
    inputs: [{ name: 'input', type: 'IMAGE', link: 1 }],
    outputs: [], properties: {}, widgets_values: widgets,
  });

  it('replaces the old option\'s slots with defaults for the new one', () => {
    // "scale dimensions" -> width, height, crop ... then scale_method
    const node = makeResize(['scale dimensions', 512, 512, 'center', 'area']);
    expect(
      rebuildDynamicComboWidgetValues(node, 'resize_type', resizeDef, 0, 'scale by multiplier')
    ).toEqual(['scale by multiplier', 1.0, 'area']);
  });

  it('grows the slot span when the new option has more sub-inputs', () => {
    const node = makeResize(['scale by multiplier', 2.0, 'area']);
    expect(
      rebuildDynamicComboWidgetValues(node, 'resize_type', resizeDef, 0, 'scale dimensions')
    ).toEqual(['scale dimensions', 512, 512, 'center', 'area']);
  });

  it('handles an option with no sub-inputs', () => {
    const statsDef = fullNodes.ColorTransfer.input.required!.source_stats;
    const node = {
      id: 1, type: 'ColorTransfer', pos: [0, 0] as [number, number],
      size: [200, 100] as [number, number], flags: {}, order: 0, mode: 0,
      inputs: [
        { name: 'image_target', type: 'IMAGE', link: 1 },
        { name: 'image_ref', type: 'IMAGE', link: 2 },
      ],
      outputs: [], properties: {},
      // method, source_stats, target_index (from "target_frame"), strength
      widgets_values: ['mkl_lab', 'target_frame', 4, 1.0],
    };
    expect(
      rebuildDynamicComboWidgetValues(node, 'source_stats', statsDef, 1, 'per_frame')
    ).toEqual(['mkl_lab', 'per_frame', 1.0]);
  });

  it('returns null when the selection did not change, or for a non-DynamicCombo', () => {
    const node = makeResize(['scale by multiplier', 2.0, 'area']);
    expect(
      rebuildDynamicComboWidgetValues(node, 'resize_type', resizeDef, 0, 'scale by multiplier')
    ).toBeNull();
    const plainCombo = fullNodes.ResizeImageMaskNode.input.required!.scale_method;
    expect(
      rebuildDynamicComboWidgetValues(node, 'scale_method', plainCombo, 2, 'lanczos')
    ).toBeNull();
  });

  it('keeps the render, write and prompt paths consistent after a switch', () => {
    const node = makeResize(['scale dimensions', 512, 512, 'center', 'area']);
    const rebuilt = rebuildDynamicComboWidgetValues(
      node, 'resize_type', resizeDef, 0, 'scale by multiplier'
    )!;
    const next = { ...node, widgets_values: rebuilt };
    const wf = {
      id: 'r', revision: 0, last_node_id: 1, last_link_id: 1,
      nodes: [next], links: [], groups: [], config: {}, extra: {}, version: 0.4,
    } as unknown as Workflow;

    const defs = [...getWidgetDefinitions(fullNodes, next), ...getInputWidgetDefinitions(fullNodes, next)];
    expect(defs.find((d) => d.name === 'multiplier')?.value).toBe(1.0);
    expect(defs.find((d) => d.name === 'scale_method')?.value).toBe('area');

    const prompt = buildWorkflowPromptInputs(
      wf, fullNodes, next, 'ResizeImageMaskNode', new Set([1]), null
    );
    expect(prompt['resize_type.multiplier']).toBe(1.0);
    expect(prompt.scale_method).toBe('area');
    // The stale width/height/crop must be gone entirely.
    expect(prompt['resize_type.width']).toBeUndefined();
  });

  it('submits a nested seed override only under its qualified input name', () => {
    const nodeTypes = {
      TextGenerate: {
        input: { required: {
          sampling_mode: ['COMFY_DYNAMICCOMBO_V3', { options: [
            { key: 'on', inputs: { required: {
              seed: ['INT', { default: 1 }],
            } } },
          ] }],
          temperature: ['FLOAT', { default: 0.7 }],
        } },
        input_order: { required: ['sampling_mode', 'temperature'] },
        output: [], output_name: [], name: 'TextGenerate', display_name: 'Text Generate',
        description: '', python_module: '', category: 'test',
      },
    } as unknown as NodeTypes;
    const node = {
      id: 1, type: 'TextGenerate', pos: [0, 0] as [number, number],
      size: [200, 100] as [number, number], flags: {}, order: 0, mode: 0,
      inputs: [], outputs: [], properties: {},
      widgets_values: ['on', 123, 'randomize', 0.7],
    };
    const workflow = {
      id: 'seed', revision: 0, last_node_id: 1, last_link_id: 0,
      nodes: [node], links: [], groups: [], config: {}, extra: {}, version: 0.4,
    } as unknown as Workflow;

    const prompt = buildWorkflowPromptInputs(
      workflow, nodeTypes, node, 'TextGenerate', new Set([1]), null, { 1: 999 },
    );

    expect(prompt['sampling_mode.seed']).toBe(999);
    expect(prompt.seed).toBeUndefined();
    expect(prompt.temperature).toBe(0.7);
  });

  it('replaces stale widget markers when a same-named child changes shape', () => {
    const typeDef = {
      input: { required: {
        mode: ['COMFY_DYNAMICCOMBO_V3', { options: [
          { key: 'widget', inputs: { required: { shared: ['INT', { default: 1 }] } } },
          { key: 'socket', inputs: { required: { shared: ['IMAGE'] } } },
        ] }],
      } },
      input_order: { required: ['mode'] },
      output: [], output_name: [], name: 'Switcher', display_name: 'Switcher',
      description: '', python_module: '', category: 'test',
    } as unknown as NodeTypes[string];
    const inputDef = typeDef.input.required!.mode;
    const widgetNode = {
      id: 1, type: 'Switcher', pos: [0, 0] as [number, number], size: [200, 100] as [number, number],
      flags: {}, order: 0, mode: 0, outputs: [], properties: {},
      inputs: [
        { name: 'mode', type: 'COMFY_DYNAMICCOMBO_V3', link: null, widget: { name: 'mode' } },
        { name: 'mode.shared', type: 'INT', link: null, widget: { name: 'mode.shared' } },
      ],
      widgets_values: ['widget', 5],
    } as WorkflowNode;

    const socketResult = rebuildDynamicComboNode(
      widgetNode, typeDef, 'mode', inputDef, 0, 'socket',
    );
    expect(socketResult?.node.inputs.find((input) => input.name === 'mode.shared'))
      .toEqual({ name: 'mode.shared', type: 'IMAGE', link: null });

    const widgetResult = rebuildDynamicComboNode(
      socketResult!.node, typeDef, 'mode', inputDef, 0, 'widget',
    );
    expect(widgetResult?.node.inputs.find((input) => input.name === 'mode.shared'))
      .toEqual({
        name: 'mode.shared', type: 'INT', link: null,
        widget: { name: 'mode.shared' },
      });
  });
});

describe('compatible-node search', () => {
  const COMBO_TYPES = ['COMBO', 'COMFY_DYNAMICCOMBO_V3', 'EASY_COMBO'];
  const comboTyped = (matches: Array<{ typeName: string; inputName: string; inputType: string }>) =>
    matches
      .filter((m) => COMBO_TYPES.includes(String(m.inputType).toUpperCase()))
      .map((m) => `${m.typeName}.${m.inputName}`);

  it('offers combo widgets as connectable unless they are socketless', () => {
    expect(comboTyped(findCompatibleNodeTypesForOutput(fullNodes, 'COMBO')).length)
      .toBeGreaterThan(0);
    const socketless = {
      SocketlessCombo: {
        input: { required: { mode: ['COMBO', { options: ['a'], socketless: true }] } },
        output: [], output_name: [], name: 'SocketlessCombo', display_name: 'Socketless Combo',
        description: '', python_module: '', category: 'test',
      },
    } as unknown as NodeTypes;
    expect(findCompatibleNodeTypesForOutput(socketless, 'COMBO')).toEqual([]);
  });

  it('still offers genuine connection inputs', () => {
    expect(findCompatibleNodeTypesForOutput(fullNodes, 'IMAGE').length).toBeGreaterThan(0);
  });

  /**
   * A socket type may carry a default without owning a widget slot, and the
   * search must still reach it. Modelled on WanVideoModelLoader.lora rather than
   * MediaPipeFaceMeshVisualize.color: the latter also declares
   * `"socketless": true`, which suppresses the socket entirely.
   */
  it('offers socket inputs that also declare a default', () => {
    const withDefaultSocket = {
      LoraConsumer: {
        input: { required: { lora: ['CUSTOMLORA', { default: null }] } },
        output: [],
        output_name: [],
        name: 'LoraConsumer',
        display_name: 'Lora Consumer',
        description: '',
        python_module: '',
        category: 'test',
      },
    } as unknown as NodeTypes;

    expect(
      findCompatibleNodeTypesForOutput(withDefaultSocket, 'CUSTOMLORA')
        .map((m) => `${m.typeName}.${m.inputName}`)
    ).toContain('LoraConsumer.lora');
  });
});
