import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { inferSeedMode } from '@/hooks/useWorkflow/seedExpansion';
import { useSeedStore } from '../useSeed';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

/**
 * Behavioural coverage for every seed-carrying node shape we support.
 *
 * Seeds are the one widget where being wrong is invisible: a re-rolled "fixed"
 * seed still renders a perfectly good image, so nothing looks broken until
 * someone tries to reproduce a result and cannot. Every case below therefore
 * asserts the seed that reaches `/api/prompt`, not an intermediate.
 *
 * There are two ways a node declares its seed mode, and they must not be
 * confused:
 *
 *   1. A `control_after_generate` widget next to the seed (stock ComfyUI).
 *      That widget's value IS the mode, and the seed advances in place.
 *   2. No such widget, and the seed VALUE encodes the mode (rgthree's Seed):
 *      -1 randomize, -2 increment, -3 decrement, anything else FIXED.
 *
 * For shape 2 there is no second source of truth. Our seed-mode store must not
 * get a vote, because it is persisted to localStorage and only updated through
 * our own UI — see the rgthree regression block at the bottom.
 */

const RGTHREE_SEED = 'Seed (rgthree)';

function pointer(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function makeNode(id: number, overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: pointer(id),
    type: 'Any',
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
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 1,
  } as unknown as Workflow;
}

function registry(nodeIds: number[]) {
  const itemKeyByPointer: Record<string, string> = {};
  const pointerByHierarchicalKey: Record<string, string> = {};
  for (const id of nodeIds) {
    itemKeyByPointer[pointer(id)] = pointer(id);
    pointerByHierarchicalKey[pointer(id)] = pointer(id);
  }
  return { itemKeyByPointer, pointerByHierarchicalKey };
}

function nodeType(
  name: string,
  seedInputName: string,
  options: { max?: number; withControl?: boolean; output?: string[] } = {},
): NodeTypes[string] {
  const required: Record<string, unknown> = {
    [seedInputName]: ['INT', { default: 0, min: 0, max: options.max ?? Number.MAX_SAFE_INTEGER }],
  };
  if (options.withControl) {
    required.control_after_generate = [['fixed', 'increment', 'decrement', 'randomize']];
  }
  return {
    input: { required, optional: {} },
    input_order: { required: Object.keys(required), optional: [] },
    output: options.output ?? ['LATENT'],
    output_name: options.output ?? ['LATENT'],
    name,
    display_name: name,
    description: '',
    python_module: '',
    category: 'test',
  } as unknown as NodeTypes[string];
}

const NODE_TYPES: NodeTypes = {
  // Stock ComfyUI: seed + the auto-added control_after_generate widget.
  KSampler: nodeType('KSampler', 'seed', { withControl: true }),
  // Same, under the other conventional seed name.
  KSamplerAdvanced: nodeType('KSamplerAdvanced', 'noise_seed', { withControl: true }),
  // rgthree's Seed: no control widget at all; the value encodes the mode.
  [RGTHREE_SEED]: nodeType(RGTHREE_SEED, 'seed', { output: ['INT'] }),
  // A seed provider with no control widget that does NOT use the special-value
  // convention, so our mode store is its only mode source.
  'easy seed': nodeType('easy seed', 'seed', { output: ['INT'] }),
  // A consumer whose declared max is far below the usual 2^64.
  NarrowSampler: nodeType('NarrowSampler', 'seed', { max: 1000, withControl: true }),
};

/**
 * An rgthree Seed node exactly as that pack serializes it.
 *
 * The three trailing empty strings are the node's three buttons ("Randomize
 * Each Time" / "New Fixed Random" / "Use Last Queued Seed"). They are declared
 * `serialize: false`, but the slots still land in `widgets_values` as empty
 * strings — verified against saved workflows. That detail matters: the broken
 * heuristic keyed off exactly this "empty trailing widgets" shape, so a
 * fixture with a bare `[seed]` would pass even against the bug.
 */
function rgthreeSeedNode(seed: number, id = 1, trailing = ['', '', '']): WorkflowNode {
  return makeNode(id, {
    type: RGTHREE_SEED,
    // rgthree sets randomMin/randomMax in its constructor, so EVERY Seed node
    // carries them. A heuristic that read them as "this node randomizes" is the
    // bug the regression block below pins.
    properties: { randomMax: 1125899906842624, randomMin: 0 },
    outputs: [{ name: 'SEED', type: 'INT', links: null }],
    widgets_values: [seed, ...trailing],
  });
}

async function queueAndReadSeeds(): Promise<Record<string, Record<string, unknown>>> {
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
  expect(call).toBeDefined();
  const init = (call as unknown as [RequestInfo | URL, RequestInit | undefined])[1];
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    prompt?: Record<string, { inputs?: Record<string, unknown> }>;
  };
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(body.prompt ?? {})) {
    out[id] = node.inputs ?? {};
  }
  return out;
}

/** Queue `times` times in a row and collect the seed sent for `nodeId` each time. */
async function queueRepeatedly(
  times: number,
  nodeId = 1,
  inputName = 'seed',
): Promise<unknown[]> {
  const seeds: unknown[] = [];
  for (let i = 0; i < times; i++) {
    const prompt = await queueAndReadSeeds();
    seeds.push(prompt[String(nodeId)]?.[inputName]);
  }
  return seeds;
}

function loadWorkflow(nodes: WorkflowNode[], seedState?: {
  seedModes?: Record<number, 'fixed' | 'randomize' | 'increment' | 'decrement'>;
  seedLastValues?: Record<number, number | null>;
}) {
  useSeedStore.setState({
    seedModes: seedState?.seedModes ?? {},
    seedLastValues: seedState?.seedLastValues ?? {},
  });
  useWorkflowStore.setState({
    workflow: makeWorkflow(nodes),
    nodeTypes: NODE_TYPES,
    ...registry(nodes.map((n) => n.id)),
  });
}

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null,
    originalWorkflow: null,
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

// ═══════════════════════════════════════════════════════════════════════════
// Shape 1: a real control_after_generate widget drives the mode.
// ═══════════════════════════════════════════════════════════════════════════

describe('stock ComfyUI seed + control_after_generate', () => {
  const ksampler = (seed: number, control: string) =>
    makeNode(1, { type: 'KSampler', widgets_values: [seed, control] });

  it('sends the authored seed unchanged on "fixed", every time', async () => {
    loadWorkflow([ksampler(42, 'fixed')]);
    expect(await queueRepeatedly(3)).toEqual([42, 42, 42]);
  });

  it('sends a different seed each run on "randomize"', async () => {
    loadWorkflow([ksampler(42, 'randomize')]);
    const seeds = await queueRepeatedly(3);
    expect(new Set(seeds).size).toBe(3);
    expect(seeds).not.toContain(42);
  });

  it('steps up by one each run on "increment"', async () => {
    loadWorkflow([ksampler(10, 'increment')]);
    expect(await queueRepeatedly(3)).toEqual([11, 12, 13]);
  });

  it('steps down by one each run on "decrement"', async () => {
    loadWorkflow([ksampler(10, 'decrement')]);
    expect(await queueRepeatedly(3)).toEqual([9, 8, 7]);
  });

  it('lets the control widget beat a stale persisted mode', async () => {
    // The mode store survives in localStorage across workflow loads, so a real
    // control widget has to win or a workflow authored as "fixed" would drift.
    loadWorkflow([ksampler(42, 'fixed')], { seedModes: { 1: 'randomize' } });
    expect(await queueRepeatedly(2)).toEqual([42, 42]);
  });

  it('advances the widget in place, so the workflow records what ran', async () => {
    loadWorkflow([ksampler(10, 'increment')]);
    await queueRepeatedly(1);
    const node = useWorkflowStore.getState().workflow!.nodes[0];
    expect((node.widgets_values as unknown[])[0]).toBe(11);
  });
});

describe('noise_seed (KSamplerAdvanced)', () => {
  it('is recognised under its own input name', async () => {
    loadWorkflow([makeNode(1, { type: 'KSamplerAdvanced', widgets_values: [7, 'fixed'] })]);
    expect(await queueRepeatedly(2, 1, 'noise_seed')).toEqual([7, 7]);
  });

  it('randomizes under its own input name', async () => {
    loadWorkflow([makeNode(1, { type: 'KSamplerAdvanced', widgets_values: [7, 'randomize'] })]);
    const seeds = await queueRepeatedly(3, 1, 'noise_seed');
    expect(new Set(seeds).size).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Shape 2: the seed VALUE is the mode (rgthree's Seed).
// ═══════════════════════════════════════════════════════════════════════════

describe('Seed (rgthree): the value encodes the mode', () => {
  it('treats -1 as "randomize each time"', async () => {
    loadWorkflow([rgthreeSeedNode(-1)]);
    const seeds = await queueRepeatedly(3);
    expect(new Set(seeds).size).toBe(3);
    // The sentinel must never reach the backend: rgthree's python logs a
    // warning and generates its own seed, which then is not reproducible.
    expect(seeds).not.toContain(-1);
    for (const seed of seeds) expect(seed).toBeGreaterThanOrEqual(0);
  });

  it('increments from the last used seed on -2', async () => {
    loadWorkflow([rgthreeSeedNode(-2)], { seedLastValues: { 1: 100 } });
    expect(await queueRepeatedly(3)).toEqual([101, 102, 103]);
  });

  it('decrements from the last used seed on -3', async () => {
    loadWorkflow([rgthreeSeedNode(-3)], { seedLastValues: { 1: 100 } });
    expect(await queueRepeatedly(3)).toEqual([99, 98, 97]);
  });

  it('never leaves the sentinel in the widget it saves', async () => {
    // The -1 has to survive in the workflow (it IS the "always randomize"
    // setting), while the prompt gets a concrete value.
    loadWorkflow([rgthreeSeedNode(-1)]);
    const [sent] = await queueRepeatedly(1);
    const node = useWorkflowStore.getState().workflow!.nodes[0];
    expect((node.widgets_values as unknown[])[0]).toBe(-1);
    expect(sent).not.toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The regression this suite was written for.
// ═══════════════════════════════════════════════════════════════════════════

describe('Seed (rgthree): a concrete seed is FIXED (regression)', () => {
  /*
   * "🎲 New Fixed Random" writes a concrete number into the seed widget. That
   * number is the fixed seed — rgthree's own getSeedToUse() returns any
   * non-special value verbatim.
   *
   * We used to infer `randomize` for it, because inferSeedMode had a heuristic
   * reading "SEED INT output + empty trailing widgets + randomMin/randomMax
   * properties" as randomize — and every rgthree Seed matches all three. The
   * pinned seed was silently re-rolled on every run, which surfaced as a fresh
   * "Use last queued seed (N)" appearing after each queue.
   */

  it('infers "fixed" for a concrete seed', () => {
    const node = rgthreeSeedNode(123456789);
    expect(inferSeedMode(makeWorkflow([node]), NODE_TYPES, node)).toBe('fixed');
  });

  it('still infers "randomize" for the -1 sentinel', () => {
    const node = rgthreeSeedNode(-1);
    expect(inferSeedMode(makeWorkflow([node]), NODE_TYPES, node)).toBe('randomize');
  });

  it('infers increment/decrement for -2 and -3', () => {
    for (const [value, mode] of [[-2, 'increment'], [-3, 'decrement']] as const) {
      const node = rgthreeSeedNode(value);
      expect(inferSeedMode(makeWorkflow([node]), NODE_TYPES, node)).toBe(mode);
    }
  });

  it('sends the same concrete seed on every run', async () => {
    loadWorkflow([rgthreeSeedNode(123456789)]);
    expect(await queueRepeatedly(4)).toEqual([123456789, 123456789, 123456789, 123456789]);
  });

  it('holds for both serialized shapes of the node', async () => {
    // Older saves carry only the seed; current ones carry the three empty
    // button slots after it. Both have to read as fixed.
    for (const trailing of [[], ['', '', '']]) {
      const node = rgthreeSeedNode(4242, 1, trailing);
      expect(inferSeedMode(makeWorkflow([node]), NODE_TYPES, node)).toBe('fixed');
      loadWorkflow([node]);
      expect(await queueRepeatedly(2)).toEqual([4242, 4242]);
    }
  });

  it('ignores a stale "randomize" left in the persisted mode store', async () => {
    // Typing a number straight into the seed field never touches the mode
    // store, so whatever was there — from an earlier "Randomize each time", or
    // from a workflow loaded under the old heuristic — is still sitting in
    // localStorage. The widget value has to win.
    loadWorkflow([rgthreeSeedNode(555)], { seedModes: { 1: 'randomize' } });
    expect(await queueRepeatedly(3)).toEqual([555, 555, 555]);
  });

  it('ignores a stale "increment" too', async () => {
    loadWorkflow([rgthreeSeedNode(555)], {
      seedModes: { 1: 'increment' },
      seedLastValues: { 1: 900 },
    });
    expect(await queueRepeatedly(2)).toEqual([555, 555]);
  });

  it('does not record a last-queued seed for a fixed value', async () => {
    // The "Use last queued seed (N)" button is only meaningful when the seed
    // that ran DIFFERS from the one in the widget. A fixed seed leaves it
    // empty, exactly as rgthree keeps its own button disabled.
    loadWorkflow([rgthreeSeedNode(555)]);
    await queueRepeatedly(3);
    expect(useSeedStore.getState().seedLastValues[1] ?? null).toBeNull();
  });

  it('does record a last-queued seed when -1 resolved to one', async () => {
    loadWorkflow([rgthreeSeedNode(-1)]);
    const [sent] = await queueRepeatedly(1);
    expect(useSeedStore.getState().seedLastValues[1]).toBe(sent);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The UI round-trip that makes the rule above safe.
// ═══════════════════════════════════════════════════════════════════════════

describe('changing an rgthree Seed’s mode from the UI', () => {
  /*
   * Because queueing now takes the widget value as the last word for this node
   * type, the mode buttons only work if they WRITE that value. `setSeedMode`
   * does so when handed a context (NodeCard.handleSetSeedMode supplies one).
   * If that context is ever dropped, the buttons become no-ops — hence these.
   */

  function setMode(nodeId: number, mode: 'fixed' | 'randomize' | 'increment' | 'decrement') {
    const workflow = useWorkflowStore.getState().workflow!;
    useSeedStore.getState().setSeedMode(nodeId, mode, {
      workflow,
      nodeTypes: NODE_TYPES,
      updateNodeWidgets: (_id, updates) =>
        useWorkflowStore.getState().updateNodeWidgets(pointer(nodeId), updates),
    });
  }

  function seedWidget(nodeId = 1): unknown {
    const node = useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === nodeId)!;
    return (node.widgets_values as unknown[])[0];
  }

  it('"Randomize each time" writes the -1 sentinel into the widget', async () => {
    loadWorkflow([rgthreeSeedNode(555)]);
    setMode(1, 'randomize');

    expect(seedWidget()).toBe(-1);
    const seeds = await queueRepeatedly(3);
    expect(new Set(seeds).size).toBe(3);
    expect(seeds).not.toContain(-1);
  });

  it('"Increment"/"Decrement" write their sentinels too', () => {
    for (const [mode, sentinel] of [['increment', -2], ['decrement', -3]] as const) {
      loadWorkflow([rgthreeSeedNode(555)]);
      setMode(1, mode);
      expect(seedWidget()).toBe(sentinel);
    }
  });

  it('switching back to fixed replaces the sentinel with a concrete seed', async () => {
    loadWorkflow([rgthreeSeedNode(-1)], { seedLastValues: { 1: 4242 } });
    setMode(1, 'fixed');

    // Prefers the last seed that actually ran, so "fixed" pins what you just saw.
    expect(seedWidget()).toBe(4242);
    expect(await queueRepeatedly(2)).toEqual([4242, 4242]);
  });

  it('generates a concrete seed for fixed when nothing has run yet', async () => {
    loadWorkflow([rgthreeSeedNode(-1)]);
    setMode(1, 'fixed');

    const pinned = seedWidget();
    expect(typeof pinned).toBe('number');
    expect(pinned).not.toBe(-1);
    expect(await queueRepeatedly(2)).toEqual([pinned, pinned]);
  });

  it('leaves a concrete seed alone when fixed is re-selected', () => {
    loadWorkflow([rgthreeSeedNode(777)]);
    setMode(1, 'fixed');
    expect(seedWidget()).toBe(777);
  });

  it('encodes a promoted instance mode without treating its next widget as a control', () => {
    const placeholder = makeNode(99, {
      type: 'subgraph-placeholder',
      widgets_values: ['prefix', 321, 'unrelated model name'],
    });
    const workflow = makeWorkflow([placeholder]);
    const updateNodeWidgets = vi.fn();

    useSeedStore.getState().setSeedMode(99, 'randomize', {
      workflow,
      nodeTypes: NODE_TYPES,
      node: placeholder,
      seedWidgetIndex: 1,
      controlWidgetIndex: null,
      updateNodeWidgets,
    });

    expect(updateNodeWidgets).toHaveBeenCalledWith(99, { 1: -1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Shape 3: no control widget, no special-value convention — our mode store.
// ═══════════════════════════════════════════════════════════════════════════

describe('a bare seed widget with no control_after_generate', () => {
  const bare = (seed: number) =>
    makeNode(1, {
      type: 'easy seed',
      outputs: [{ name: 'seed', type: 'INT', links: null }],
      widgets_values: [seed],
    });

  it('defaults to fixed with no mode recorded', async () => {
    loadWorkflow([bare(321)]);
    expect(await queueRepeatedly(2)).toEqual([321, 321]);
  });

  it('honours an explicit randomize from the mode store', async () => {
    // Unlike rgthree's Seed, this node type has no value convention, so the
    // store IS its only mode source and must still be respected.
    loadWorkflow([bare(321)], { seedModes: { 1: 'randomize' } });
    const seeds = await queueRepeatedly(3);
    expect(new Set(seeds).size).toBe(3);
  });

  it('honours an explicit increment from the mode store', async () => {
    loadWorkflow([bare(50)], { seedModes: { 1: 'increment' } });
    expect(await queueRepeatedly(3)).toEqual([51, 52, 53]);
  });

  it('honours an explicit decrement from the mode store', async () => {
    loadWorkflow([bare(50)], { seedModes: { 1: 'decrement' } });
    expect(await queueRepeatedly(3)).toEqual([49, 48, 47]);
  });

  it('leaves the saved widget value alone when randomizing', async () => {
    // No control widget means no "advance in place" — the override is
    // ephemeral, so the authored value survives a queue.
    loadWorkflow([bare(321)], { seedModes: { 1: 'randomize' } });
    await queueRepeatedly(1);
    expect((useWorkflowStore.getState().workflow!.nodes[0].widgets_values as unknown[])[0])
      .toBe(321);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-cutting: bounds, multiple nodes, bypass.
// ═══════════════════════════════════════════════════════════════════════════

describe('seed bounds', () => {
  it('keeps a generated seed inside the node’s declared max', async () => {
    // Over-max seeds make ComfyUI reject that node's whole branch at
    // validation, which shows up as a silently missing output.
    loadWorkflow([makeNode(1, { type: 'NarrowSampler', widgets_values: [0, 'randomize'] })]);
    for (const seed of await queueRepeatedly(5)) {
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(1000);
    }
  });
});

describe('several seed nodes in one workflow', () => {
  it('advances each independently and does not cross-contaminate', async () => {
    loadWorkflow([
      makeNode(1, { type: 'KSampler', widgets_values: [10, 'increment'] }),
      makeNode(2, { type: 'KSampler', widgets_values: [900, 'fixed'] }),
      rgthreeSeedNode(777, 3),
    ]);

    const first = await queueAndReadSeeds();
    const second = await queueAndReadSeeds();

    expect([first['1'].seed, second['1'].seed]).toEqual([11, 12]);
    expect([first['2'].seed, second['2'].seed]).toEqual([900, 900]);
    expect([first['3'].seed, second['3'].seed]).toEqual([777, 777]);
  });

  it('gives two randomizing nodes different seeds in the same run', async () => {
    loadWorkflow([
      makeNode(1, { type: 'KSampler', widgets_values: [0, 'randomize'] }),
      makeNode(2, { type: 'KSampler', widgets_values: [0, 'randomize'] }),
    ]);
    const prompt = await queueAndReadSeeds();
    expect(prompt['1'].seed).not.toBe(prompt['2'].seed);
  });
});

describe('bypassed seed nodes', () => {
  it('drops a bypassed node from the prompt rather than seeding it', async () => {
    loadWorkflow([
      makeNode(1, { type: 'KSampler', widgets_values: [10, 'randomize'], mode: 4 }),
      makeNode(2, { type: 'KSampler', widgets_values: [20, 'fixed'] }),
    ]);
    const prompt = await queueAndReadSeeds();
    expect(prompt['1']).toBeUndefined();
    expect(prompt['2'].seed).toBe(20);
  });
});
