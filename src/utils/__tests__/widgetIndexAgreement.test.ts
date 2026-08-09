/**
 * Widget-slot indexing must agree across the three independent implementations
 * of the same walk:
 *
 * - `widgetDefinitions`        — which widget the UI renders at an index
 * - `seedUtils`                — which index seed/value writes land on
 * - `buildWorkflowPromptInputs`— which value is submitted for each input
 *
 * When any two disagree the UI shows one widget while a write or a submission
 * lands on another: silent corruption rather than a visible failure.
 *
 * COMFY_DYNAMICCOMBO_V3 is the case that broke: the selected option contributes
 * extra widget slots right after the combo, so every later widget shifts. These
 * tests build widgets_values from the node schema so the expected index of each
 * widget is known ground truth, then assert ALL THREE land on it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodeTypes, Workflow, WorkflowNode, WorkflowInput } from '@/api/types';
import {
  buildWorkflowPromptInputs,
  getComboOptions,
  getDynamicComboSubInputs,
  isComboType,
  isMultiSelectCombo,
  isWidgetBackedInput,
} from '../workflowInputs';
import { getInputWidgetDefinitions, getWidgetDefinitions } from '../widgetDefinitions';
import { findSeedWidgetIndex, getWidgetIndexForInput } from '../seedUtils';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fullNodes = JSON.parse(
  readFileSync(join(fixturesDir, 'v3ComboFullNodes.json'), 'utf8')
) as NodeTypes;

type InputDef = [string | unknown[], Record<string, unknown>?];

/**
 * Ground-truth schema classification. Workflow-specific materialized widgets
 * are covered separately below.
 */
function isWidgetSlotType(t: unknown, opts?: Record<string, unknown>): boolean {
  return isWidgetBackedInput(t as string | unknown[], opts);
}

function defaultValueFor(type: string | unknown[], opts?: Record<string, unknown>): unknown {
  if (isComboType(type) && isMultiSelectCombo(opts)) {
    const declared = opts?.default;
    if (Array.isArray(declared)) return declared;
    if (declared !== undefined) return [declared];
    return [getComboOptions(type, opts)[0]].filter((entry) => entry !== undefined);
  }
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'default')) return opts.default;
  if (isComboType(type)) return getComboOptions(type, opts)[0] ?? '';
  switch (String(type).toUpperCase()) {
    case 'INT': return 7;
    case 'FLOAT': return 1.5;
    case 'BOOLEAN': return false;
    default: return 'x';
  }
}

interface ExpectedSlot {
  /** widgets_values index this input occupies */
  index: number;
  /** key the prompt carries it under — "parent.child" for DynamicCombo sub-inputs */
  promptKey: string;
  /** the value placed at `index` */
  value: unknown;
}

interface BuiltNode {
  node: WorkflowNode;
  expected: Map<string, ExpectedSlot>;
}

/**
 * Lay out a node exactly the way ComfyUI serializes it: socket inputs get
 * materialized+connected entries (so they consume no widget slot), widget
 * inputs append to widgets_values in declaration order, a DynamicCombo is
 * followed immediately by its selected option's sub-inputs, and every INT
 * seed is followed by its implicit control_after_generate slot.
 */
function buildNode(nodeType: string, dynamicChoices: Record<string, string>): BuiltNode {
  const typeDef = fullNodes[nodeType];
  const required = (typeDef.input.required ?? {}) as Record<string, InputDef>;
  const optional = (typeDef.input.optional ?? {}) as Record<string, InputDef>;
  const order = [
    ...(typeDef.input_order?.required ?? Object.keys(required)),
    ...(typeDef.input_order?.optional ?? Object.keys(optional)),
  ];

  const widgets: unknown[] = [];
  const expected = new Map<string, ExpectedSlot>();
  const sockets: WorkflowInput[] = [];
  let linkId = 1;

  const place = (name: string, qualifiedName: string, def: InputDef) => {
    const [type, opts] = def;
    if (!isWidgetSlotType(type, opts)) {
      // Materialized + connected: consumes a socket, never a widget slot.
      sockets.push({ name: qualifiedName, type: String(type), link: linkId++ } as WorkflowInput);
      return;
    }
    const isDynamic = String(type).toUpperCase() === 'COMFY_DYNAMICCOMBO_V3';
    const value = isDynamic
      ? dynamicChoices[qualifiedName] ?? dynamicChoices[name] ?? String(getComboOptions(type, opts)[0])
      : defaultValueFor(type, opts);
    expected.set(qualifiedName, {
      index: widgets.length,
      promptKey: qualifiedName,
      value,
    });
    widgets.push(value);

    // ComfyUI appends control_after_generate right after an INT seed widget.
    if (String(type).toUpperCase() === 'INT' && (name === 'seed' || name === 'noise_seed')) {
      widgets.push('randomize');
    }

    if (isDynamic) {
      for (const sub of getDynamicComboSubInputs(type, opts, value, qualifiedName)) {
        place(sub.name, sub.qualifiedName, sub.inputDef as InputDef);
      }
    }
  };

  for (const name of order) {
    const def = required[name] ?? optional[name];
    if (def) place(name, name, def);
  }

  return {
    node: {
      id: 1, type: nodeType, pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
      inputs: sockets, outputs: [], properties: {}, widgets_values: widgets,
    },
    expected,
  };
}

function makeWorkflow(node: WorkflowNode): Workflow {
  return {
    id: 'agreement', revision: 0, last_node_id: 1, last_link_id: 99,
    nodes: [node], links: [], groups: [], config: {}, extra: {}, version: 0.4,
  } as Workflow;
}

/** Every combination of option keys for a node's DynamicCombo inputs. */
function dynamicComboChoices(nodeType: string): Array<Record<string, string>> {
  const typeDef = fullNodes[nodeType];
  const all = { ...(typeDef.input.required ?? {}), ...(typeDef.input.optional ?? {}) } as Record<string, InputDef>;
  const dynamic = Object.entries(all).filter(
    ([, d]) => String(d[0]).toUpperCase() === 'COMFY_DYNAMICCOMBO_V3'
  );
  if (dynamic.length === 0) return [{}];
  let combos: Array<Record<string, string>> = [{}];
  for (const [name, def] of dynamic) {
    const keys = getComboOptions(def[0], def[1]).map(String);
    combos = combos.flatMap((base) => keys.map((k) => ({ ...base, [name]: k })));
  }
  return combos;
}

const NODE_TYPES = Object.keys(fullNodes);

describe('widget index agreement: widgetDefinitions vs seedUtils', () => {
  it.each(NODE_TYPES)('%s: both implementations match the true widget layout', (nodeType) => {
    let checked = 0;

    for (const choices of dynamicComboChoices(nodeType)) {
      const { node, expected } = buildNode(nodeType, choices);
      const workflow = makeWorkflow(node);
      const label = `${nodeType} ${JSON.stringify(choices)}`;

      const defs = [
        ...getWidgetDefinitions(fullNodes, node),
        ...getInputWidgetDefinitions(fullNodes, node),
      ];

      // The third implementation of the same slot walk. It exposes values, not
      // indices, so it is checked by what it submits for each widget.
      const prompt = buildWorkflowPromptInputs(
        workflow, fullNodes, node, nodeType, new Set([node.id]), null
      );

      for (const [inputName, slot] of expected) {
        const rendered = defs.find((d) => (d.inputName ?? d.name) === inputName);
        expect(rendered, `${label}: "${inputName}" missing from widget definitions`).toBeTruthy();
        expect(rendered!.widgetIndex, `${label}: widgetDefinitions index for "${inputName}"`)
          .toBe(slot.index);

        const writeIndex = getWidgetIndexForInput(workflow, fullNodes, node, inputName);
        expect(writeIndex, `${label}: seedUtils index for "${inputName}"`).toBe(slot.index);

        expect(prompt[slot.promptKey], `${label}: prompt value for "${slot.promptKey}"`)
          .toEqual(slot.value);
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(0);
  });
});

describe('materialized widget input', () => {
  /**
   * ComfyUI marks a converted widget with `input.widget`. Once connected it
   * still keeps its widgets_values slot, so every walk must count that concrete
   * workflow evidence even though the schema itself describes a socket.
   */
  it('keeps its widgets_values slot, so later widgets do not shift', () => {
    const convertedTypes = {
      ConvertedColor: {
        input: { required: {
          color: ['COLOR', { default: '#FF0000' }],
          thickness: ['INT', { default: 3 }],
          point_size: ['INT', { default: 5 }],
        } },
        input_order: { required: ['color', 'thickness', 'point_size'] },
        output: [], output_name: [], name: 'ConvertedColor', display_name: 'Converted Color',
        description: '', python_module: '', category: 'test',
      },
    } as unknown as NodeTypes;
    const node: WorkflowNode = {
      id: 1, type: 'ConvertedColor', pos: [0, 0], size: [200, 100],
      flags: {}, order: 0, mode: 0,
      inputs: [
        { name: 'color', type: 'COLOR', link: 2, widget: { name: 'color' } },
      ] as WorkflowInput[],
      outputs: [], properties: {},
      widgets_values: ['#FF0000', 3, 5],
    };
    const workflow = makeWorkflow(node);
    const defs = [
      ...getWidgetDefinitions(convertedTypes, node),
      ...getInputWidgetDefinitions(convertedTypes, node),
    ];
    const prompt = buildWorkflowPromptInputs(
      workflow, convertedTypes, node, 'ConvertedColor', new Set([1]), null
    );

    for (const [name, trueIndex] of [['thickness', 1], ['point_size', 2]] as const) {
      const trueValue = name === 'thickness' ? 3 : 5;
      expect(defs.find((d) => d.name === name)?.widgetIndex, `widgetDefinitions "${name}"`)
        .toBe(trueIndex);
      expect(getWidgetIndexForInput(workflow, convertedTypes, node, name), `seedUtils "${name}"`)
        .toBe(trueIndex);
      expect((node.widgets_values as unknown[])[trueIndex], `value at "${name}"`)
        .toBe(trueValue);
      expect(prompt[name], `prompt value for "${name}"`).toBe(trueValue);
    }
    expect(prompt.color).toBeUndefined();
  });
});

describe('explicit widget index maps', () => {
  it('advances unmapped widgets past a mapped slot instead of overlapping it', () => {
    const mappedTypes = {
      MappedWidgets: {
        input: { required: {
          first: ['STRING', { default: 'first' }],
          second: ['INT', { default: 7 }],
        } },
        input_order: { required: ['first', 'second'] },
        output: [], output_name: [], name: 'MappedWidgets', display_name: 'Mapped Widgets',
        description: '', python_module: '', category: 'test',
      },
    } as unknown as NodeTypes;
    const node: WorkflowNode = {
      id: 1, type: 'MappedWidgets', pos: [0, 0], size: [200, 100],
      flags: {}, order: 0, mode: 0, inputs: [], outputs: [],
      properties: { __lm_widget_ids: ['__lm_internal_0', '__lm_internal_1', 'first'] },
      widgets_values: ['internal-a', 'internal-b', 'mapped-first', 42],
    };
    const workflow = makeWorkflow(node);
    const defs = [
      ...getWidgetDefinitions(mappedTypes, node),
      ...getInputWidgetDefinitions(mappedTypes, node),
    ];
    const prompt = buildWorkflowPromptInputs(
      workflow, mappedTypes, node, 'MappedWidgets', new Set([1]), null,
    );

    expect(defs.find((definition) => definition.name === 'first')?.widgetIndex).toBe(2);
    expect(defs.find((definition) => definition.name === 'second')?.widgetIndex).toBe(3);
    expect(getWidgetIndexForInput(workflow, mappedTypes, node, 'second')).toBe(3);
    expect(prompt).toMatchObject({ first: 'mapped-first', second: 42 });
  });
});

describe('seed randomization targets the real seed widget', () => {
  it('ClaudeNode: seed sits after a DynamicCombo that adds sub-input slots', () => {
    for (const choices of dynamicComboChoices('ClaudeNode')) {
      const { node, expected } = buildNode('ClaudeNode', choices);
      const workflow = makeWorkflow(node);
      const seedIndex = expected.get('seed')?.index;
      const label = `ClaudeNode ${JSON.stringify(choices)}`;

      expect(seedIndex, label).toBeDefined();
      // The sub-inputs must actually shift the seed, otherwise this node would
      // not exercise the regression at all.
      expect(seedIndex, `${label}: expected sub-inputs to shift the seed`).toBeGreaterThan(2);

      expect(findSeedWidgetIndex(workflow, fullNodes, node), `${label}: findSeedWidgetIndex`)
        .toBe(seedIndex);
      // The value actually written must be the seed, not a neighbouring widget.
      expect(
        (node.widgets_values as unknown[])[findSeedWidgetIndex(workflow, fullNodes, node)!],
        `${label}: value at the seed index`
      ).toBe((node.widgets_values as unknown[])[seedIndex!]);
    }
  });
});
