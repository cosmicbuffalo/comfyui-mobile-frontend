import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { getEmbeddedQueueWorkflowLabel } from '@/utils/queueWorkflowLabel';
import { useSeedStore } from '../useSeed';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

/**
 * "Enqueue with variations": one queued run per chosen value of ONE combo
 * widget, with everything else held exactly as it stands.
 *
 * The promise the feature makes is a comparison, and a comparison is only
 * valid if nothing else moved. Two things could quietly break that and still
 * produce perfectly good images:
 *
 *   1. A seed set to randomize advancing between the runs, which would make
 *      every output differ for two reasons instead of one.
 *   2. The variation leaking back into the session's workflow, so the widget
 *      the user was comparing ends up on whichever value happened to go last.
 *
 * Both are asserted below against what actually reaches /api/prompt.
 */

const SAMPLERS = ['euler', 'dpmpp_2m', 'ddim'];
// Stock ComfyUI does NOT declare control_after_generate: the frontend inserts
// that widget after the seed, so it occupies a widgets_values slot with no
// matching input. Declaring it here would double-count the slot and shift
// every widget index after the seed.
const INPUTS = ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'];

const NODE_TYPES: NodeTypes = {
  KSampler: {
    input: {
      required: {
        seed: ['INT', { default: 0, min: 0, max: Number.MAX_SAFE_INTEGER, control_after_generate: true }],
        steps: ['INT', { default: 20 }],
        cfg: ['FLOAT', { default: 8 }],
        sampler_name: [SAMPLERS],
        scheduler: [['normal', 'karras']],
        denoise: ['FLOAT', { default: 1 }],
      },
      optional: {},
    },
    input_order: { required: INPUTS, optional: [] },
    output: ['LATENT'],
    output_name: ['LATENT'],
    name: 'KSampler',
    display_name: 'KSampler',
    description: '',
    python_module: '',
    category: 'test',
  } as unknown as NodeTypes[string],
};

function pointer(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function ksampler(seed: number, control: string, sampler = 'euler'): WorkflowNode {
  return {
    id: 1,
    itemKey: pointer(1),
    type: 'KSampler',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [seed, control, 20, 8, sampler, 'normal', 1],
  } as unknown as WorkflowNode;
}

function loadWorkflow(node: WorkflowNode) {
  useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
  useWorkflowStore.setState({
    workflow: {
      last_node_id: node.id,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    } as unknown as Workflow,
    nodeTypes: NODE_TYPES,
    currentFilename: 'compare.json',
    itemKeyByPointer: { [pointer(node.id)]: pointer(node.id) },
    pointerByHierarchicalKey: { [pointer(node.id)]: pointer(node.id) },
  });
}

interface QueuedRun {
  inputs: Record<string, unknown>;
  label: string | null;
  embeddedWidgets: unknown[];
}

/** Queue a variation run and read back every prompt it submitted, in order. */
async function runVariations(values: unknown[]): Promise<QueuedRun[]> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/queue')) {
      return { ok: true, json: async () => ({ queue_running: [], queue_pending: [] }) };
    }
    return { ok: true, json: async () => ({ prompt_id: `p-${Math.random()}`, number: 1 }) };
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  const queued = await useWorkflowStore.getState().queueWorkflow(
    values.length,
    undefined,
    false,
    false,
    { nodeId: 1, subgraphId: null, widgetIndex: 4, widgetName: 'sampler_name', values },
  );
  expect(queued).toBe(true);

  return fetchMock.mock.calls
    .filter(([input]) => String(input).includes('/api/prompt'))
    .map((call) => {
      const init = (call as unknown as [RequestInfo | URL, RequestInit | undefined])[1];
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        prompt?: Record<string, { inputs?: Record<string, unknown> }>;
        extra_data?: Record<string, unknown>;
      };
      const embedded = (body.extra_data?.extra_pnginfo as { workflow?: Workflow } | undefined)
        ?.workflow;
      return {
        inputs: body.prompt?.['1']?.inputs ?? {},
        label: getEmbeddedQueueWorkflowLabel(body.extra_data),
        embeddedWidgets: (embedded?.nodes?.[0]?.widgets_values as unknown[]) ?? [],
      };
    });
}

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null,
    originalWorkflow: null,
    nodeTypes: null,
    currentFilename: null,
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

describe('enqueue with variations', () => {
  it('queues one run per chosen value, each carrying its own value', async () => {
    loadWorkflow(ksampler(42, 'fixed'));
    const runs = await runVariations(SAMPLERS);

    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.inputs.sampler_name)).toEqual(SAMPLERS);
  });

  it('holds a randomizing seed fixed across the batch', async () => {
    // The whole point of the feature. On a normal run this node's seed would
    // be re-rolled for every iteration; here all three runs must share one.
    loadWorkflow(ksampler(42, 'randomize'));
    const runs = await runVariations(SAMPLERS);

    expect(runs.map((run) => run.inputs.seed)).toEqual([42, 42, 42]);
  });

  it('holds an incrementing seed fixed across the batch', async () => {
    loadWorkflow(ksampler(10, 'increment'));
    const runs = await runVariations(SAMPLERS);

    expect(runs.map((run) => run.inputs.seed)).toEqual([10, 10, 10]);
  });

  it('varies nothing but the chosen widget', async () => {
    loadWorkflow(ksampler(42, 'randomize'));
    const runs = await runVariations(SAMPLERS);

    for (const run of runs) {
      expect(run.inputs.steps).toBe(20);
      expect(run.inputs.cfg).toBe(8);
      expect(run.inputs.scheduler).toBe('normal');
      expect(run.inputs.denoise).toBe(1);
    }
  });

  it('leaves the session workflow untouched, seed included', async () => {
    // A leak here is invisible until the user looks back at the widget and
    // finds it on whichever value happened to be queued last.
    loadWorkflow(ksampler(42, 'randomize'));
    await runVariations(SAMPLERS);

    const after = useWorkflowStore.getState().workflow;
    expect(after?.nodes[0].widgets_values).toEqual([42, 'randomize', 20, 8, 'euler', 'normal', 1]);
  });

  it('names the tested value in each run label, so the queue is readable', async () => {
    loadWorkflow(ksampler(42, 'fixed'));
    const runs = await runVariations(SAMPLERS);

    expect(runs.map((run) => run.label)).toEqual([
      'compare · sampler_name: euler',
      'compare · sampler_name: dpmpp_2m',
      'compare · sampler_name: ddim',
    ]);
  });

  it('embeds each run’s own value in the workflow saved with its output', async () => {
    // Otherwise every image in the comparison reloads with the same settings
    // and the batch is unreproducible.
    loadWorkflow(ksampler(42, 'fixed'));
    const runs = await runVariations(SAMPLERS);

    expect(runs.map((run) => run.embeddedWidgets[4])).toEqual(SAMPLERS);
  });

  it('queues only the chosen subset', async () => {
    loadWorkflow(ksampler(42, 'fixed'));
    const runs = await runVariations(['euler', 'ddim']);

    expect(runs.map((run) => run.inputs.sampler_name)).toEqual(['euler', 'ddim']);
  });

  it('still advances a randomizing seed on an ordinary run', async () => {
    // Guards the carve-out: the seed skip must apply ONLY to variation runs.
    loadWorkflow(ksampler(42, 'randomize'));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/queue')) {
        return { ok: true, json: async () => ({ queue_running: [], queue_pending: [] }) };
      }
      return { ok: true, json: async () => ({ prompt_id: 'p-1', number: 1 }) };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await useWorkflowStore.getState().queueWorkflow(3);

    const seeds = fetchMock.mock.calls
      .filter(([input]) => String(input).includes('/api/prompt'))
      .map((call) => {
        const init = (call as unknown as [RequestInfo | URL, RequestInit | undefined])[1];
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          prompt?: Record<string, { inputs?: Record<string, unknown> }>;
        };
        return body.prompt?.['1']?.inputs?.seed;
      });
    expect(new Set(seeds).size).toBe(3);
  });
});
