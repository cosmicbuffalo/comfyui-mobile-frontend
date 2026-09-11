import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useSeedStore } from '../useSeed';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

/**
 * The whole seed-restoration loop, end to end, against the real queue.
 *
 * `seedRestore`'s own unit tests feed it hand-written prompt graphs. That
 * proves the matching logic and nothing about whether the two halves an output
 * image carries actually fit together — the embedded workflow and the API
 * prompt are produced by `queueWorkflow`, and every id scheme, class-type
 * spelling and widget index in them comes from code these tests never touch.
 *
 * So each case here queues for real, takes BOTH halves out of the request body
 * exactly as ComfyUI writes them into the file, and loads them back through
 * `loadWorkflow`. What the store ends up holding is what the node card draws.
 *
 * The three shapes are the three routes a seed can take, and they resolve in
 * three different places:
 *   - a seed node at root, whose prompt id is its own;
 *   - one inside a subgraph definition, whose prompt id is hierarchical;
 *   - one promoted onto a placeholder's boundary, which has no prompt id at
 *     all — the placeholder expands away, so its value has to be found through
 *     the node that ran inside it.
 */

const RGTHREE_SEED = 'Seed (rgthree)';
const pointer = (nodeId: number, subgraphId: string | null = null) =>
  makeLocationPointer({ type: 'node', nodeId, subgraphId });

function nodeType(
  name: string,
  seedInputName: string,
  options: { withControl?: boolean; output?: string[] } = {},
): NodeTypes[string] {
  const required: Record<string, unknown> = {
    [seedInputName]: ['INT', { default: 0, min: 0, max: Number.MAX_SAFE_INTEGER }],
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
  [RGTHREE_SEED]: nodeType(RGTHREE_SEED, 'seed', { output: ['INT'] }),
  RandomNoiseLike: nodeType('RandomNoiseLike', 'noise_seed', { output: ['NOISE'] }),
};

/** An rgthree Seed node as that pack serializes it, sentinel and all. */
function rgthreeSeedNode(id: number, subgraphId: string | null = null): WorkflowNode {
  return {
    id,
    itemKey: pointer(id, subgraphId),
    type: RGTHREE_SEED,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [{ name: 'SEED', type: 'INT', links: null }],
    properties: { randomMax: 1125899906842624, randomMin: 0 },
    // -1 is "randomize each time"; the three trailing slots are its buttons.
    widgets_values: [-1, '', '', ''],
  } as unknown as WorkflowNode;
}

function rootWorkflow(): Workflow {
  return {
    last_node_id: 1,
    last_link_id: 0,
    nodes: [rgthreeSeedNode(1)],
    links: [],
    groups: [],
    config: {},
    version: 1,
  } as unknown as Workflow;
}

function seedInsideSubgraphWorkflow(): Workflow {
  return {
    last_node_id: 105,
    last_link_id: 0,
    nodes: [{
      id: 105,
      itemKey: pointer(105),
      type: 'sg-seeded',
      pos: [0, 0],
      size: [200, 100],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [],
      properties: {},
      widgets_values: [],
    }],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [{
        id: 'sg-seeded',
        name: 'Seeded subgraph',
        nodes: [rgthreeSeedNode(7, 'sg-seeded')],
        links: [],
        inputs: [],
        outputs: [],
      }],
    },
  } as unknown as Workflow;
}

/** A placeholder promoting an inner `noise_seed` onto its boundary. */
function promotedSeedWorkflow(): Workflow {
  return {
    last_node_id: 105,
    last_link_id: 207,
    nodes: [{
      id: 105,
      itemKey: pointer(105),
      type: 'sg-video',
      pos: [0, 0],
      size: [200, 100],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [{ name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: null }],
      outputs: [{ name: 'NOISE', type: 'NOISE', links: [] }],
      properties: {},
      widgets_values: [-1],
    }],
    links: [],
    groups: [],
    config: {},
    version: 0.4,
    definitions: {
      subgraphs: [{
        id: 'sg-video',
        name: 'Video subgraph',
        nodes: [{
          id: 15,
          itemKey: pointer(15, 'sg-video'),
          type: 'RandomNoiseLike',
          pos: [0, 0],
          size: [100, 100],
          flags: {},
          order: 0,
          mode: 0,
          inputs: [{ name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: 207 }],
          outputs: [{ name: 'NOISE', type: 'NOISE', links: [] }],
          properties: {},
          widgets_values: [0],
        }],
        links: [{ id: 207, origin_id: -10, origin_slot: 0, target_id: 15, target_slot: 0, type: 'INT' }],
        inputs: [{ name: 'noise_seed', type: 'INT', linkIds: [207] }],
        outputs: [],
      }],
    },
  } as unknown as Workflow;
}

function install(workflow: Workflow, keys: Array<[number, string | null]>) {
  const registry: Record<string, string> = {};
  for (const [id, sg] of keys) registry[pointer(id, sg)] = pointer(id, sg);
  useWorkflowStore.setState({
    workflow,
    nodeTypes: NODE_TYPES,
    itemKeyByPointer: { ...registry },
    pointerByHierarchicalKey: { ...registry },
  });
}

/** Queue once and return the two halves an output image is written with. */
async function queueAndCapture(): Promise<{ prompt: unknown; workflow: Workflow }> {
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
  const body = JSON.parse(String(init?.body ?? '{}'));
  return { prompt: body.prompt, workflow: body.extra_data?.extra_pnginfo?.workflow };
}

/** Reopen the image: the embedded workflow, restored against the run's prompt. */
function reopen(workflow: Workflow, prompt: unknown): Workflow {
  useWorkflowStore.setState({ nodeTypes: NODE_TYPES });
  useWorkflowStore.getState().loadWorkflow(workflow, 'output.png', {
    executedPrompt: prompt,
    replaceActive: true,
  });
  return useWorkflowStore.getState().workflow!;
}

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

describe('the seed an output was made with survives being reopened', () => {
  it('restores an rgthree Seed at root', async () => {
    install(rootWorkflow(), [[1, null]]);
    const { prompt, workflow } = await queueAndCapture();

    // The sentinel is what gets SAVED — that is the point of it, and why the
    // seed has to come from the prompt instead.
    const seedThatRan = (prompt as Record<string, { inputs: { seed: number } }>)['1'].inputs.seed;
    expect(workflow.nodes[0].widgets_values).toEqual([-1, '', '', '']);
    expect(seedThatRan).not.toBe(-1);

    const reopened = reopen(workflow, prompt);
    expect(reopened.nodes[0].widgets_values).toEqual([seedThatRan, '', '', '']);
  });

  it('restores a seed inside a subgraph definition, whose prompt id is hierarchical', async () => {
    install(seedInsideSubgraphWorkflow(), [[105, null], [7, 'sg-seeded']]);
    const { prompt, workflow } = await queueAndCapture();

    const entries = Object.entries(prompt as Record<string, { inputs: { seed: number } }>);
    expect(entries.map(([key]) => key)).toEqual(['105:7']);
    const seedThatRan = entries[0][1].inputs.seed;

    const reopened = reopen(workflow, prompt);
    expect(reopened.definitions?.subgraphs?.[0].nodes[0].widgets_values)
      .toEqual([seedThatRan, '', '', '']);
  });

  it('restores a seed promoted onto a placeholder, which never reaches the prompt itself', async () => {
    // The placeholder expands away, so there is no prompt entry under its id —
    // and the value the card shows lives on the placeholder, not in the shared
    // definition. Both halves of that are why this case needs its own route.
    install(promotedSeedWorkflow(), [[105, null], [15, 'sg-video']]);
    const { prompt, workflow } = await queueAndCapture();

    const entries = Object.entries(prompt as Record<string, { inputs: { noise_seed: number } }>);
    expect(entries.map(([key]) => key)).toEqual(['105:15']);
    const seedThatRan = entries[0][1].inputs.noise_seed;
    expect(workflow.nodes[0].widgets_values).toEqual([-1]);

    const reopened = reopen(workflow, prompt);
    expect(reopened.nodes[0].widgets_values).toEqual([seedThatRan]);
  });

  it('advances a concrete placeholder seed to the value the run executed with', async () => {
    // A reopened output holds a concrete seed on the placeholder, and choosing
    // "randomize" keeps it concrete (the mode lives in the seed store). The
    // card must then follow each run: the executed seed is written back into
    // the placeholder's slot, exactly as stock's control_after_generate
    // advances a widget — not shown once at load time and never again.
    const workflow = promotedSeedWorkflow();
    (workflow.nodes[0].widgets_values as unknown[])[0] = 321;
    install(workflow, [[105, null], [15, 'sg-video']]);
    useSeedStore.setState({ seedModes: { 105: 'randomize' } });

    const { prompt, workflow: embedded } = await queueAndCapture();
    const executed = (prompt as Record<string, { inputs: { noise_seed: number } }>)['105:15']
      .inputs.noise_seed;
    expect(typeof executed).toBe('number');
    expect(executed).not.toBe(321);
    // The live card and the workflow embedded in the output both carry it.
    expect(useWorkflowStore.getState().workflow!.nodes[0].widgets_values).toEqual([executed]);
    expect(embedded.nodes[0].widgets_values).toEqual([executed]);
  });
});
