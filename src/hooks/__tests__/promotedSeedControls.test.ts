import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { resolvePromotedSeedControls } from '@/utils/promotedSeedControls';
import { nonSeedWidgetsDiffer } from '@/utils/workflowDiff';
import { diffWorkflowChange } from '@/utils/workflowUndoDiff';
import { isWorkflowModified } from '@/hooks/useWorkflow/signature';
import { useSeedStore } from '../useSeed';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

/**
 * A subgraph placeholder can promote SEVERAL seeds, and each one keeps its own
 * seed control. Stock resolves them one promoted input at a time
 * (`applyPromotedWidgetControl` in the frontend's promotedWidgetControl.ts):
 * for every unlinked promoted input it finds the concrete interior widget,
 * reads THAT widget's linked control_after_generate, and advances the host's
 * value for that input alone. Nested subgraphs resolve through to the
 * innermost widget the same way.
 *
 * So two promoted seeds with different controls must advance independently,
 * and neither may borrow the other's mode or its value. Every assertion reads
 * the seed that actually reaches /api/prompt, keyed by the inner node that
 * executes it, because a swapped or shared seed still renders a good image.
 */

type Control = 'fixed' | 'increment' | 'decrement' | 'randomize';

function samplerType(name: string, seedInput: string): NodeTypes[string] {
  // The control_after_generate slot is implicit after an INT seed, so it is
  // deliberately NOT declared here -- declaring it double-counts the slot and
  // shifts `steps` onto the wrong index.
  return {
    input: {
      required: {
        [seedInput]: ['INT', { default: 0, min: 0, max: Number.MAX_SAFE_INTEGER }],
        steps: ['INT', { default: 20, min: 1, max: 10000 }],
      },
      optional: {},
    },
    input_order: { required: [seedInput, 'steps'], optional: [] },
    output: ['LATENT'],
    output_name: ['LATENT'],
    name,
    display_name: name,
    description: '',
    python_module: '',
    category: 'test',
  } as unknown as NodeTypes[string];
}

const NODE_TYPES: NodeTypes = {
  KSampler: samplerType('KSampler', 'seed'),
  KSamplerAdvanced: samplerType('KSamplerAdvanced', 'noise_seed'),
};

const SEED_A = 1111;
const SEED_B = 2222;
const STEPS_A = 17;
const STEPS_B = 29;

// Inner node ids. Deliberately different from each other AND from every
// placeholder id, so a prompt key can only match the node it names.
const SAMPLER_A = 10;
const SAMPLER_B = 11;

function innerSampler(
  id: number,
  type: 'KSampler' | 'KSamplerAdvanced',
  seedInput: string,
  linkId: number,
  control: Control,
  steps: number,
): WorkflowNode {
  return {
    id,
    type,
    pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
    inputs: [{ name: seedInput, type: 'INT', widget: { name: seedInput }, link: linkId }],
    outputs: [{ name: 'LATENT', type: 'LATENT', links: [] }],
    properties: {},
    // The interior seed is link-fed by the boundary, so its own value is dead
    // (stock never reads it); a sentinel-free junk value proves that.
    widgets_values: [0, control, steps],
  } as unknown as WorkflowNode;
}

/**
 * Definition "sg-two": two samplers whose seeds are both promoted, in the
 * order [seed, noise_seed]. Boundary link origin_slot is the boundary INDEX.
 */
function twoSeedDefinition(controlA: Control, controlB: Control) {
  return {
    id: 'sg-two',
    name: 'Two samplers',
    nodes: [
      innerSampler(SAMPLER_A, 'KSampler', 'seed', 501, controlA, STEPS_A),
      innerSampler(SAMPLER_B, 'KSamplerAdvanced', 'noise_seed', 502, controlB, STEPS_B),
    ],
    links: [
      { id: 501, origin_id: -10, origin_slot: 0, target_id: SAMPLER_A, target_slot: 0, type: 'INT' },
      { id: 502, origin_id: -10, origin_slot: 1, target_id: SAMPLER_B, target_slot: 0, type: 'INT' },
    ],
    inputs: [
      { name: 'seed', type: 'INT', linkIds: [501] },
      { name: 'noise_seed', type: 'INT', linkIds: [502] },
    ],
    outputs: [],
    inputNode: { id: -10, bounding: [0, 0, 10, 10] },
    outputNode: { id: -20, bounding: [0, 0, 10, 10] },
  };
}

function placeholderNode(id: number, type: string, values: unknown[]): WorkflowNode {
  return {
    id,
    itemKey: makeLocationPointer({ type: 'node', nodeId: id, subgraphId: null }),
    type,
    pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
    inputs: [
      { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: null },
      { name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: null },
    ],
    outputs: [],
    properties: {},
    widgets_values: values,
  } as unknown as WorkflowNode;
}

const FLAT_PLACEHOLDER = 100;

/** Root placeholder of sg-two. Prompt keys: `100:10`, `100:11`. */
function flatWorkflow(controlA: Control, controlB: Control): Workflow {
  return {
    last_node_id: FLAT_PLACEHOLDER, last_link_id: 502,
    nodes: [placeholderNode(FLAT_PLACEHOLDER, 'sg-two', [SEED_A, SEED_B])],
    links: [], groups: [], config: {}, version: 0.4,
    definitions: { subgraphs: [twoSeedDefinition(controlA, controlB)] },
  } as unknown as Workflow;
}

const OUTER_PLACEHOLDER = 200;
const INNER_PLACEHOLDER = 50;

/**
 * Root placeholder of "sg-outer", which holds a placeholder of sg-two and
 * re-promotes both of its seeds to its own boundary. Prompt keys:
 * `200:50:10`, `200:50:11`.
 */
function nestedWorkflow(controlA: Control, controlB: Control): Workflow {
  const innerPlaceholder = {
    ...placeholderNode(INNER_PLACEHOLDER, 'sg-two', [0, 0]),
    itemKey: undefined,
    inputs: [
      { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: 601 },
      { name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: 602 },
    ],
  };
  const outer = {
    id: 'sg-outer',
    name: 'Outer',
    nodes: [innerPlaceholder],
    links: [
      { id: 601, origin_id: -10, origin_slot: 0, target_id: INNER_PLACEHOLDER, target_slot: 0, type: 'INT' },
      { id: 602, origin_id: -10, origin_slot: 1, target_id: INNER_PLACEHOLDER, target_slot: 1, type: 'INT' },
    ],
    inputs: [
      { name: 'seed', type: 'INT', linkIds: [601] },
      { name: 'noise_seed', type: 'INT', linkIds: [602] },
    ],
    outputs: [],
    inputNode: { id: -10, bounding: [0, 0, 10, 10] },
    outputNode: { id: -20, bounding: [0, 0, 10, 10] },
  };
  return {
    last_node_id: OUTER_PLACEHOLDER, last_link_id: 602,
    nodes: [placeholderNode(OUTER_PLACEHOLDER, 'sg-outer', [SEED_A, SEED_B])],
    links: [], groups: [], config: {}, version: 0.4,
    definitions: { subgraphs: [outer, twoSeedDefinition(controlA, controlB)] },
  } as unknown as Workflow;
}

function load(workflow: Workflow) {
  const root = workflow.nodes[0];
  const pointer = root.itemKey!;
  useWorkflowStore.setState({
    workflow,
    nodeTypes: NODE_TYPES,
    itemKeyByPointer: { [pointer]: pointer },
    pointerByHierarchicalKey: { [pointer]: pointer },
  });
}

type PromptInputs = Record<string, Record<string, unknown>>;

async function queueOnce(): Promise<PromptInputs> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/queue')) {
      return { ok: true, json: async () => ({ queue_running: [], queue_pending: [] }) };
    }
    return { ok: true, json: async () => ({ prompt_id: 'p-test', number: 1 }) };
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  await useWorkflowStore.getState().queueWorkflow(1);
  const call = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/prompt'));
  expect(call, useWorkflowErrorsStore.getState().error ?? 'no /api/prompt call').toBeDefined();
  const init = (call as unknown as [RequestInfo | URL, RequestInit | undefined])[1];
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    prompt?: Record<string, { inputs?: Record<string, unknown> }>;
  };
  const out: PromptInputs = {};
  for (const [key, node] of Object.entries(body.prompt ?? {})) out[key] = node.inputs ?? {};
  return out;
}

interface Run { a: unknown; b: unknown; stepsA: unknown; stepsB: unknown }

async function queueRuns(times: number, keyA: string, keyB: string): Promise<Run[]> {
  const runs: Run[] = [];
  for (let i = 0; i < times; i++) {
    const prompt = await queueOnce();
    expect(Object.keys(prompt).sort()).toEqual([keyA, keyB].sort());
    runs.push({
      a: prompt[keyA].seed,
      b: prompt[keyB].noise_seed,
      stepsA: prompt[keyA].steps,
      stepsB: prompt[keyB].steps,
    });
  }
  return runs;
}

/** What each seed's sequence must look like under its own control. */
function expectFollows(seeds: unknown[], control: Control, authored: number) {
  expect(seeds.every((s) => Number.isSafeInteger(s))).toBe(true);
  const values = seeds as number[];
  switch (control) {
    case 'fixed':
      expect(values).toEqual(values.map(() => authored));
      break;
    case 'increment':
      values.slice(1).forEach((s, i) => expect(s).toBe(values[i] + 1));
      break;
    case 'decrement':
      values.slice(1).forEach((s, i) => expect(s).toBe(values[i] - 1));
      break;
    case 'randomize':
      // Three rolls from a 2^53 range colliding is not a flake worth handling.
      expect(new Set(values).size).toBe(values.length);
      break;
  }
}

const SHAPES = [
  { label: 'a placeholder', build: flatWorkflow, keyA: '100:10', keyB: '100:11' },
  { label: 'a nested placeholder', build: nestedWorkflow, keyA: '200:50:10', keyB: '200:50:11' },
] as const;

const COMBINATIONS: Array<[Control, Control]> = [
  ['fixed', 'fixed'],
  ['randomize', 'randomize'],
  ['increment', 'increment'],
  ['fixed', 'randomize'],
  ['randomize', 'fixed'],
  ['increment', 'decrement'],
  ['fixed', 'increment'],
];

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null,
    originalWorkflow: null,
    diffBaseWorkflow: null,
    lastEnqueuedWorkflow: null,
    nodeTypes: null,
    hiddenItems: {},
    collapsedItems: {},
    connectionHighlightModes: {},
    mobileLayout: createEmptyMobileLayout(),
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    scopeStack: [{ type: 'root' }],
    currentWorkflowKey: null,
    savedWorkflowStates: {},
    executingNodeId: null,
    executingNodePath: null,
    executingPromptId: null,
    nodeOutputs: {},
    nodeTextOutputs: {},
    promptOutputs: {},
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    infiniteLoopSessionId: null,
    promptToSession: {},
    isLoadingBySession: {},
    closeForNewWorkflowRequest: null,
  });
  useWorkflowErrorsStore.setState({
    error: null, nodeErrors: {}, errorCycleIndex: 0, errorsDismissed: false,
  });
  useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const shape of SHAPES) {
  describe(`two promoted seeds on ${shape.label}`, () => {
    it.each(COMBINATIONS)('seed on %s and noise_seed on %s advance independently', async (controlA, controlB) => {
      load(shape.build(controlA, controlB));
      const runs = await queueRuns(3, shape.keyA, shape.keyB);

      expectFollows(runs.map((r) => r.a), controlA, SEED_A);
      expectFollows(runs.map((r) => r.b), controlB, SEED_B);
    });

    it('never lets the two seeds share or swap a value', async () => {
      load(shape.build('randomize', 'randomize'));
      const runs = await queueRuns(3, shape.keyA, shape.keyB);
      for (const run of runs) expect(run.a).not.toBe(run.b);
    });

    it('sends each seed to its own sampler on the first run', async () => {
      // Value integrity: the authored name -> value mapping, not just "two
      // seeds arrived". A rotation would still produce two plausible seeds.
      load(shape.build('fixed', 'fixed'));
      const [run] = await queueRuns(1, shape.keyA, shape.keyB);
      expect(run.a).toBe(SEED_A);
      expect(run.b).toBe(SEED_B);
    });

    it('never touches the widget after either seed', async () => {
      load(shape.build('randomize', 'increment'));
      const runs = await queueRuns(3, shape.keyA, shape.keyB);
      for (const run of runs) {
        expect(run.stepsA).toBe(STEPS_A);
        expect(run.stepsB).toBe(STEPS_B);
      }
    });
  });
}

describe('what stock leaves alone', () => {
  it('does not advance a promoted seed whose input is linked', async () => {
    // Stock's collectPromotedControlTargets skips an input with a link: the
    // value comes from upstream, so there is nothing on the host to advance.
    const workflow = flatWorkflow('randomize', 'randomize');
    const placeholder = workflow.nodes[0];
    placeholder.inputs[1] = { ...placeholder.inputs[1], link: 900 };
    load(workflow);

    await queueOnce();
    await queueOnce();

    const after = useWorkflowStore.getState().workflow!.nodes[0].widgets_values as unknown[];
    expect(after[0]).not.toBe(SEED_A);
    expect(after[1]).toBe(SEED_B);
  });

  it('never rewrites the interior seed the boundary feeds', async () => {
    // The interior widget is link-fed, so stock's own control returns early
    // for it. Advancing it anyway rewrote a dead value inside the definition
    // on every run.
    load(flatWorkflow('randomize', 'increment'));
    await queueOnce();
    await queueOnce();

    const definition = useWorkflowStore.getState().workflow!.definitions!.subgraphs![0];
    for (const inner of definition.nodes!) {
      expect((inner.widgets_values as unknown[])[0]).toBe(0);
    }
  });

  it('does not advance a linked seed on an ordinary node either', async () => {
    const sampler = {
      id: 1,
      itemKey: makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null }),
      type: 'KSampler',
      pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
      inputs: [{ name: 'seed', type: 'INT', widget: { name: 'seed' }, link: 77 }],
      outputs: [], properties: {},
      widgets_values: [SEED_A, 'randomize', STEPS_A],
    } as unknown as WorkflowNode;
    load({
      last_node_id: 1, last_link_id: 0, nodes: [sampler], links: [], groups: [], config: {}, version: 0.4,
    } as unknown as Workflow);

    await queueOnce();

    const after = useWorkflowStore.getState().workflow!.nodes[0].widgets_values as unknown[];
    expect(after[0]).toBe(SEED_A);
  });
});

describe('where each promoted seed is recorded', () => {
  it('sends each seed as it stands, then advances it on the placeholder, one slot per seed', async () => {
    // Stock's default timing: the run gets the current values, and each
    // control moves its own slot afterwards, ready for the next run.
    load(flatWorkflow('increment', 'decrement'));
    const prompt = await queueOnce();
    expect(prompt['100:10'].seed).toBe(SEED_A);
    expect(prompt['100:11'].noise_seed).toBe(SEED_B);

    const after = useWorkflowStore.getState().workflow!.nodes[0].widgets_values as unknown[];
    expect(after).toEqual([SEED_A + 1, SEED_B - 1]);
  });

  it('keeps two instances of one subgraph on their own values under the shared mode', async () => {
    // The mode lives on the definition's interior widget, so both instances
    // follow it. The values live on each host, so they never merge.
    const workflow = flatWorkflow('increment', 'fixed');
    workflow.nodes.push(placeholderNode(101, 'sg-two', [5000, 6000]));
    useWorkflowStore.setState({
      workflow,
      nodeTypes: NODE_TYPES,
      itemKeyByPointer: Object.fromEntries(workflow.nodes.map((n) => [n.itemKey!, n.itemKey!])),
      pointerByHierarchicalKey: Object.fromEntries(workflow.nodes.map((n) => [n.itemKey!, n.itemKey!])),
    });

    const prompt = await queueOnce();

    expect(prompt['100:10'].seed).toBe(SEED_A);
    expect(prompt['101:10'].seed).toBe(5000);
    expect(prompt['100:11'].noise_seed).toBe(SEED_B);
    expect(prompt['101:11'].noise_seed).toBe(6000);
    const next = await queueOnce();
    expect(next['100:10'].seed).toBe(SEED_A + 1);
    expect(next['101:10'].seed).toBe(5001);
    expect(next['100:11'].noise_seed).toBe(SEED_B);
    expect(next['101:11'].noise_seed).toBe(6000);
  });
});

describe('the shapes real templates ship', () => {
  /**
   * Official templates routinely serialize the placeholder with an empty (or
   * short) widgets_values and keep the real seed on the inner sampler. Stock
   * skips the missing entry and the inner widget's own value stands -- so that
   * is the seed that runs, and the one its control advances.
   */
  function templateShaped(controlA: Control, controlB: Control): Workflow {
    const workflow = flatWorkflow(controlA, controlB);
    workflow.nodes[0].widgets_values = [];
    const [a, b] = workflow.definitions!.subgraphs![0].nodes!;
    (a.widgets_values as unknown[])[0] = SEED_A;
    (b.widgets_values as unknown[])[0] = SEED_B;
    return workflow;
  }

  it('runs the inner seeds when the placeholder holds none', async () => {
    load(templateShaped('fixed', 'fixed'));
    const [run] = await queueRuns(1, '100:10', '100:11');
    expect(run.a).toBe(SEED_A);
    expect(run.b).toBe(SEED_B);
  });

  it('advances each inner seed under its own control', async () => {
    load(templateShaped('increment', 'randomize'));
    const runs = await queueRuns(3, '100:10', '100:11');
    expectFollows(runs.map((r) => r.a), 'increment', SEED_A);
    expectFollows(runs.map((r) => r.b), 'randomize', SEED_B);
    expect(runs[0].a).toBe(SEED_A);
    expect(runs[0].b).toBe(SEED_B);
  });

  it('keeps the advanced seeds on the placeholder, never padding with null', async () => {
    // Stock keeps each instance's value on the host and serializes it after a
    // run. A null entry would be worse than none: stock writes it over the
    // inner widget's default the next time the file opens on desktop.
    load(templateShaped('randomize', 'increment'));
    const prompt = await queueOnce();
    expect(prompt['100:10'].seed).toBe(SEED_A);
    const after = useWorkflowStore.getState().workflow!.nodes[0].widgets_values as unknown[];
    expect(after).toHaveLength(2);
    expect(after).not.toContain(null);
    expect(after[0]).not.toBe(SEED_A);
    expect(after[1]).toBe(SEED_B + 1);
  });

  it('fills an empty slot below a written seed with the value it runs', async () => {
    // Only noise_seed advances; the fixed seed's slot beneath it must be filled
    // with the seed that actually runs, not left as a hole.
    load(templateShaped('fixed', 'increment'));
    await queueOnce();
    const after = useWorkflowStore.getState().workflow!.nodes[0].widgets_values as unknown[];
    expect(after).toEqual([SEED_A, SEED_B + 1]);
  });

  it('advances two instances of one empty-shipped subgraph independently', async () => {
    // Each instance's value lives on its own placeholder, as in stock. Writing
    // into the shared definition instead gave every instance the same seed.
    const workflow = templateShaped('randomize', 'increment');
    workflow.nodes.push(placeholderNode(101, 'sg-two', []));
    useWorkflowStore.setState({
      workflow,
      nodeTypes: NODE_TYPES,
      itemKeyByPointer: Object.fromEntries(workflow.nodes.map((n) => [n.itemKey!, n.itemKey!])),
      pointerByHierarchicalKey: Object.fromEntries(workflow.nodes.map((n) => [n.itemKey!, n.itemKey!])),
    });

    // Both run the shipped values first, then each rolls its own.
    const first = await queueOnce();
    expect([first['100:10'].seed, first['101:10'].seed]).toEqual([SEED_A, SEED_A]);
    expect([first['100:11'].noise_seed, first['101:11'].noise_seed]).toEqual([SEED_B, SEED_B]);

    const second = await queueOnce();
    expect(second['100:10'].seed).not.toBe(second['101:10'].seed);
    expect(second['100:11'].noise_seed).toBe(SEED_B + 1);
    expect(second['101:11'].noise_seed).toBe(SEED_B + 1);
    // The shared definition is left as it was.
    const [, inner] = useWorkflowStore.getState().workflow!.definitions!.subgraphs![0].nodes!;
    expect((inner.widgets_values as unknown[])[0]).toBe(SEED_B);
  });

  it('steps from a middle placeholder\'s value when the outer one holds none', async () => {
    // Nested: the outer placeholder ships empty and the placeholder inside it
    // holds [7000, 8000]. That is the value that runs, so it is the one a
    // control advances; stepping the innermost widget instead never moved.
    const workflow = nestedWorkflow('increment', 'decrement');
    workflow.nodes[0].widgets_values = [];
    workflow.definitions!.subgraphs!.find((d) => d.id === 'sg-outer')!.nodes![0].widgets_values = [7000, 8000];
    load(workflow);

    const runs = await queueRuns(3, '200:50:10', '200:50:11');
    expect(runs.map((r) => r.a)).toEqual([7000, 7001, 7002]);
    expect(runs.map((r) => r.b)).toEqual([8000, 7999, 7998]);
  });

  it('fills the placeholder on load, so neither the load nor a run reads as an edit', async () => {
    useWorkflowStore.setState({ nodeTypes: NODE_TYPES });
    await useWorkflowStore.getState().loadWorkflow(templateShaped('fixed', 'increment'), 'template.json');
    const loaded = useWorkflowStore.getState();
    expect(loaded.workflow!.nodes[0].widgets_values).toEqual([SEED_A, SEED_B]);
    expect(isWorkflowModified(loaded.workflow!, loaded.originalWorkflow!)).toBe(false);

    await queueOnce();
    const after = useWorkflowStore.getState();
    expect(after.workflow!.nodes[0].widgets_values).toEqual([SEED_A, SEED_B + 1]);
    // Only the seed moved: undo and the queue diff's base must not see a change.
    expect(diffWorkflowChange(loaded.workflow!, after.workflow!, NODE_TYPES).changedNodeIds).toEqual([]);
    expect(nonSeedWidgetsDiffer(loaded.workflow!, after.workflow!, NODE_TYPES)).toBe(false);
  });

  it('matches a placeholder input to its boundary slot by name', () => {
    // Load normalizes inputs into boundary order; a caller holding an
    // unnormalized placeholder must still get each seed's own sampler.
    const workflow = flatWorkflow('randomize', 'decrement');
    const placeholder = workflow.nodes[0];
    placeholder.inputs = [placeholder.inputs[1], placeholder.inputs[0]];

    const controls = resolvePromotedSeedControls(workflow, NODE_TYPES, placeholder);
    const byInput = Object.fromEntries(
      controls.map((control) => [placeholder.inputs[control.inputSlot].name, control]),
    );
    expect(byInput.seed.node.id).toBe(SAMPLER_A);
    expect(byInput.seed.mode).toBe('randomize');
    expect(byInput.noise_seed.node.id).toBe(SAMPLER_B);
    expect(byInput.noise_seed.mode).toBe('decrement');
  });
});

describe('a legacy sentinel left in a promoted slot', () => {
  /**
   * Older mobile versions wrote the mode into a promoted seed as -1/-2/-3.
   * With an interior control to say what the mode is, the sentinel carries
   * nothing more -- and it is not a seed stock can run (min 0), so it must
   * never reach the prompt, whichever of the promoted seeds holds it.
   */
  function withSentinels(values: unknown[], controlA: Control, controlB: Control): Workflow {
    const workflow = flatWorkflow(controlA, controlB);
    workflow.nodes[0].widgets_values = values;
    const [a, b] = workflow.definitions!.subgraphs![0].nodes!;
    (a.widgets_values as unknown[])[0] = SEED_A;
    (b.widgets_values as unknown[])[0] = SEED_B;
    return workflow;
  }

  it.each([
    [[SEED_A, -1]],
    [[-1, SEED_B]],
    [[-1, -2]],
    [[-3, -1]],
  ])('never sends a sentinel for %j', async (values) => {
    load(withSentinels(values, 'randomize', 'randomize'));
    const runs = await queueRuns(2, '100:10', '100:11');
    for (const run of runs) {
      for (const seed of [run.a, run.b]) {
        expect(Number.isSafeInteger(seed)).toBe(true);
        expect(seed as number).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('follows the interior mode and replaces the sentinel with the seed that ran', async () => {
    load(withSentinels([SEED_A, -1], 'fixed', 'increment'));
    const prompt = await queueOnce();

    expect(prompt['100:10'].seed).toBe(SEED_A);
    // The sentinel is no value, so the run is sent the value beneath it, and
    // the control steps on from there afterwards.
    expect(prompt['100:11'].noise_seed).toBe(SEED_B);
    const after = useWorkflowStore.getState().workflow!.nodes[0].widgets_values as unknown[];
    expect(after).toEqual([SEED_A, SEED_B + 1]);
  });

  it('gives a fixed seed a concrete value instead of the sentinel', async () => {
    load(withSentinels([-1, SEED_B], 'fixed', 'fixed'));
    const prompt = await queueOnce();
    expect(prompt['100:10'].seed).toBe(SEED_A);
    expect(prompt['100:11'].noise_seed).toBe(SEED_B);
  });
});
