import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { HIDDEN_WORKFLOW_EXTRA_DATA_KEY } from '@/utils/workflowHidden';
import { useOutputsStore } from '../useOutputs';
import { useSeedStore } from '../useSeed';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

/**
 * A generation inherits hiddenness from what it CONSUMES, not only from where
 * its workflow came from.
 *
 * The flag this asserts is the one the whole hidden-output chain hangs off:
 * history reads it back out of `extra_data`, marks every output file hidden
 * server-side, and the queue and outputs panels filter on it. Getting it wrong
 * puts a picture the user hid back on screen, so it is checked against the
 * actual request body rather than an intermediate.
 */

const pointer = (nodeId: number) => makeLocationPointer({ type: 'node', nodeId, subgraphId: null });

const NODE_TYPES: NodeTypes = {
  LoadImage: {
    input: { required: { image: [['a.png', 'b.png'], { image_upload: true }] }, optional: {} },
    input_order: { required: ['image'], optional: [] },
    output: ['IMAGE'], output_name: ['IMAGE'], name: 'LoadImage',
    display_name: 'Load Image', description: '', python_module: '', category: 'image',
  } as unknown as NodeTypes[string],
};

function loadImageNode(value: string): WorkflowNode {
  return {
    id: 1,
    itemKey: pointer(1),
    type: 'LoadImage',
    pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
    inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: null }],
    properties: {},
    widgets_values: [value],
  } as unknown as WorkflowNode;
}

function install(value: string) {
  useWorkflowStore.setState({
    workflow: {
      last_node_id: 1, last_link_id: 0, nodes: [loadImageNode(value)],
      links: [], groups: [], config: {}, version: 1,
    } as unknown as Workflow,
    nodeTypes: NODE_TYPES,
    itemKeyByPointer: { [pointer(1)]: pointer(1) },
    pointerByHierarchicalKey: { [pointer(1)]: pointer(1) },
  });
}

async function queueAndReadExtraData(): Promise<Record<string, unknown>> {
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
  return JSON.parse(String(init?.body ?? '{}')).extra_data ?? {};
}

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null, originalWorkflow: null, diffBaseWorkflow: null, lastEnqueuedWorkflow: null,
    nodeTypes: null, hiddenItems: {}, collapsedItems: {}, connectionHighlightModes: {},
    mobileLayout: createEmptyMobileLayout(), itemKeyByPointer: {}, pointerByHierarchicalKey: {},
    scopeStack: [{ type: 'root' }], currentWorkflowKey: null, currentFilename: null,
    workflowSource: null, savedWorkflowStates: {}, executingNodeId: null, executingNodePath: null,
    executingPromptId: null, nodeOutputs: {}, nodeTextOutputs: {}, promptOutputs: {},
    sessions: [], activeSessionId: null, parkedSessions: {}, infiniteLoopSessionId: null,
    promptToSession: {}, isLoadingBySession: {}, closeForNewWorkflowRequest: null,
  });
  useWorkflowErrorsStore.setState({ error: null, nodeErrors: {}, errorCycleIndex: 0, errorsDismissed: false });
  useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
  useOutputsStore.setState({ hiddenIds: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useOutputsStore.setState({ hiddenIds: [] });
});

describe('a run that consumes a hidden input is itself hidden', () => {
  it('marks the run when the workflow loads a hidden image', async () => {
    useOutputsStore.setState({ hiddenIds: ['input/private/portrait.png'] });
    install('private/portrait.png');

    const extraData = await queueAndReadExtraData();

    expect(extraData[HIDDEN_WORKFLOW_EXTRA_DATA_KEY]).toBe(true);
  });

  it('marks it through a hidden FOLDER, which is the only mark stored', async () => {
    useOutputsStore.setState({ hiddenIds: ['input/private'] });
    install('private/portrait.png');

    const extraData = await queueAndReadExtraData();

    expect(extraData[HIDDEN_WORKFLOW_EXTRA_DATA_KEY]).toBe(true);
  });

  it('leaves an ordinary run unmarked', async () => {
    useOutputsStore.setState({ hiddenIds: ['input/private/portrait.png'] });
    install('holiday.png');

    const extraData = await queueAndReadExtraData();

    expect(extraData[HIDDEN_WORKFLOW_EXTRA_DATA_KEY]).toBeUndefined();
  });

  it('picks the mark up the moment it is made, without waiting for a refetch', async () => {
    // Hiding then immediately re-running is the obvious sequence, and a check
    // that only saw the server's next snapshot would miss exactly that run.
    install('private/portrait.png');
    expect((await queueAndReadExtraData())[HIDDEN_WORKFLOW_EXTRA_DATA_KEY]).toBeUndefined();

    useOutputsStore.getState().markItemHiddenLocally('input/private/portrait.png');

    expect((await queueAndReadExtraData())[HIDDEN_WORKFLOW_EXTRA_DATA_KEY]).toBe(true);
  });
});
