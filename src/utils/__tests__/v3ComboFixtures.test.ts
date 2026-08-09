/**
 * V3 combo coverage against real object_info node definitions, so the
 * DynamicCombo sub-input plumbing is exercised without a live server.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import {
  buildWorkflowPromptInputs,
  getComboOptions,
  getDynamicComboSubInputs,
  isComboType,
} from '../workflowInputs';
import { getInputWidgetDefinitions, getWidgetDefinitions } from '../widgetDefinitions';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const fullNodes = JSON.parse(
  readFileSync(join(fixturesDir, 'v3ComboFullNodes.json'), 'utf8')
) as NodeTypes;

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

function makeWorkflow(nodes: WorkflowNode[]): Workflow {
  return {
    id: 'v3-fixture',
    revision: 0,
    last_node_id: nodes.length,
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

function defaultForSub(type: string, opts?: Record<string, unknown>): unknown {
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'default')) {
    return opts.default;
  }
  const t = String(type).toUpperCase();
  if (t === 'INT') return 0;
  if (t === 'FLOAT') return 1;
  if (t === 'BOOLEAN') return false;
  if (t === 'STRING') return '';
  if (t === 'COMBO' || t === 'EASY_COMBO') {
    const options = getComboOptions(type, opts);
    return options[0] ?? '';
  }
  return null;
}

const PRIMITIVE_WIDGET_TYPES = ['INT', 'FLOAT', 'BOOLEAN', 'STRING'];

/** An input occupies a widget slot when it is a combo or a primitive; everything else is a socket. */
function isSocketType(t: unknown): boolean {
  if (isComboType(t as string | unknown[])) return false;
  return !PRIMITIVE_WIDGET_TYPES.includes(String(t).toUpperCase());
}

/** Build widgets_values for a DynamicCombo selection + trailing sibling widgets. */
function widgetsForDynamicCombo(
  nodeType: string,
  comboInputName: string,
  selectedKey: string
): { widgets: unknown[]; skipped: boolean; reason?: string } {
  const typeDef = fullNodes[nodeType];
  if (!typeDef) return { widgets: [], skipped: true, reason: 'missing type' };

  const inputDef =
    typeDef.input.required?.[comboInputName] || typeDef.input.optional?.[comboInputName];
  if (!inputDef) return { widgets: [], skipped: true, reason: 'missing combo input' };

  const [typeOrOptions, inputOptions] = inputDef;
  const subs = getDynamicComboSubInputs(typeOrOptions, inputOptions, selectedKey, comboInputName);

  for (const sub of subs) {
    if (isSocketType(sub.inputDef[0])) {
      return {
        widgets: [],
        skipped: true,
        reason: `socket sub-input ${sub.name}:${String(sub.inputDef[0])}`,
      };
    }
  }

  const widgets: unknown[] = [];
  const orderRequired = typeDef.input_order?.required ?? Object.keys(typeDef.input.required ?? {});
  const orderOptional = typeDef.input_order?.optional ?? Object.keys(typeDef.input.optional ?? {});

  for (const name of [...orderRequired, ...orderOptional]) {
    const def = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
    if (!def) continue;
    const [t, opts] = def;

    if (isSocketType(t)) continue;

    if (name === comboInputName) {
      widgets.push(selectedKey);
      for (const sub of subs) {
        const [subType, subOpts] = sub.inputDef;
        widgets.push(defaultForSub(String(subType), subOpts));
      }
      continue;
    }

    if (isComboType(t)) {
      const comboOpts = getComboOptions(t, opts);
      widgets.push(opts?.default ?? comboOpts[0] ?? '');
      continue;
    }

    if (PRIMITIVE_WIDGET_TYPES.includes(String(t).toUpperCase())) {
      widgets.push(defaultForSub(String(t), opts));
    }
  }

  return { widgets, skipped: false };
}

function allWidgetNames(node: WorkflowNode): string[] {
  const nonCombo = getWidgetDefinitions(fullNodes, node).map((d) => d.name);
  const combo = getInputWidgetDefinitions(fullNodes, node).map((d) => d.name);
  return [...nonCombo, ...combo];
}

describe('v3 combo full-node prompt + widget defs (mocked, no UI)', () => {
  it('ResizeImageMaskNode: each non-socket mode builds widgets + prompt fields', () => {
    const comboName = 'resize_type';
    const inputDef = fullNodes.ResizeImageMaskNode.input.required![comboName];
    const [typeOrOptions, inputOptions] = inputDef;
    const keys = getComboOptions(typeOrOptions, inputOptions).map(String);

    expect(keys).toContain('scale dimensions');
    expect(keys).toContain('scale by multiplier');

    let exercised = 0;
    for (const key of keys) {
      const built = widgetsForDynamicCombo('ResizeImageMaskNode', comboName, key);
      if (built.skipped) continue;

      const node = makeNode(1, 'ResizeImageMaskNode', {
        inputs: [{ name: 'input', type: 'IMAGE', link: 1 }],
        widgets_values: built.widgets,
      });
      const workflow = makeWorkflow([node]);
      const names = allWidgetNames(node);

      expect(names, key).toContain(comboName);
      const comboDef = getInputWidgetDefinitions(fullNodes, node).find((d) => d.name === comboName);
      expect(comboDef?.value, key).toBe(key);

      const subs = getDynamicComboSubInputs(typeOrOptions, inputOptions, key, comboName);
      for (const sub of subs) {
        expect(names, `${key} missing widget ${sub.name}`).toContain(sub.name);
      }

      const prompt = buildWorkflowPromptInputs(
        workflow,
        fullNodes,
        node,
        'ResizeImageMaskNode',
        new Set([1]),
        null
      );
      expect(prompt[comboName], key).toBe(key);
      for (const sub of subs) {
        expect(prompt, `${key} prompt`).toHaveProperty(sub.qualifiedName);
      }
      exercised += 1;
    }

    expect(exercised).toBeGreaterThanOrEqual(7);
  });

  it('SaveVideo / SaveImageAdvanced / ColorTransfer: combo options parse and prompt includes selection', () => {
    const cases: Array<{ node: string; combo: string }> = [
      { node: 'SaveVideo', combo: 'codec' },
      { node: 'SaveImageAdvanced', combo: 'format' },
      { node: 'ColorTransfer', combo: 'source_stats' },
      { node: 'SeedVR2TemporalChunk', combo: 'chunking_mode' },
      { node: 'DecodeAndSaveVideo', combo: 'tiling' },
    ];

    for (const { node: nodeType, combo } of cases) {
      const typeDef = fullNodes[nodeType];
      expect(typeDef, nodeType).toBeTruthy();
      const inputDef = typeDef.input.required?.[combo] || typeDef.input.optional?.[combo];
      expect(inputDef, `${nodeType}.${combo}`).toBeTruthy();
      const [typeOrOptions, inputOptions] = inputDef!;
      const keys = getComboOptions(typeOrOptions, inputOptions).map(String);
      expect(keys.length, nodeType).toBeGreaterThan(0);

      const key = keys[0];
      const built = widgetsForDynamicCombo(nodeType, combo, key);
      if (built.skipped) {
        expect(keys[0]).toBeTruthy();
        continue;
      }

      const socketInputs = Object.entries({
        ...(typeDef.input.required ?? {}),
        ...(typeDef.input.optional ?? {}),
      })
        .filter(([, def]) => isSocketType(def[0]))
        .map(([name, def], idx) => ({
          name,
          type: String(def[0]),
          link: idx + 1,
        }));

      const node = makeNode(1, nodeType, {
        inputs: socketInputs,
        widgets_values: built.widgets,
      });
      const workflow = makeWorkflow([node]);
      const prompt = buildWorkflowPromptInputs(
        workflow,
        fullNodes,
        node,
        nodeType,
        new Set([1]),
        null
      );
      expect(prompt[combo], nodeType).toBe(key);
    }
  });

  it('easy humanSegmentation EASY_COMBO options flatten via getComboOptions', () => {
    const typeDef = fullNodes['easy humanSegmentation'];
    expect(typeDef).toBeTruthy();
    const inputDef = typeDef.input.required!['mask_components'];
    const [typeOrOptions, inputOptions] = inputDef;
    expect(String(typeOrOptions).toUpperCase()).toBe('EASY_COMBO');
    const options = getComboOptions(typeOrOptions, inputOptions);
    expect(options.length).toBeGreaterThan(0);
  });

  it('BasicScheduler string COMBO still resolves like classic combo', () => {
    const typeDef = fullNodes.BasicScheduler;
    const inputDef = typeDef.input.required!['scheduler'];
    const [typeOrOptions, inputOptions] = inputDef;
    expect(isComboType(typeOrOptions)).toBe(true);
    const options = getComboOptions(typeOrOptions, inputOptions);
    expect(options.length).toBeGreaterThan(0);

    const node = makeNode(1, 'BasicScheduler', {
      inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
      widgets_values: [options[0], 20, 1],
    });
    const prompt = buildWorkflowPromptInputs(
      makeWorkflow([node]),
      fullNodes,
      node,
      'BasicScheduler',
      new Set([1]),
      null
    );
    expect(prompt.scheduler).toBe(options[0]);
  });
});
