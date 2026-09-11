import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

/**
 * When the /api/prompt POST dies at the network layer (weak cellular link,
 * VPN path migration), the browser rejects the fetch with a TypeError whose
 * message is browser-specific and unhelpful — Safari's is literally
 * "Load failed". The enqueue catch must replace that with an actionable
 * connection message, while still passing through real server-side errors
 * (an HTTP error response's message) untouched.
 */

function pointer(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function makeNode(id: number): WorkflowNode {
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
  };
}

const NODE_TYPES: NodeTypes = {
  Any: {
    input: { required: {}, optional: {} },
    input_order: { required: [], optional: [] },
    output: ['LATENT'],
    output_name: ['LATENT'],
    name: 'Any',
    display_name: 'Any',
    description: '',
    python_module: '',
    category: 'test',
  } as unknown as NodeTypes[string],
};

function loadWorkflow(nodes: WorkflowNode[]) {
  const itemKeyByPointer: Record<string, string> = {};
  const pointerByHierarchicalKey: Record<string, string> = {};
  for (const node of nodes) {
    itemKeyByPointer[pointer(node.id)] = pointer(node.id);
    pointerByHierarchicalKey[pointer(node.id)] = pointer(node.id);
  }
  useWorkflowStore.setState({
    workflow: {
      last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
      last_link_id: 0,
      nodes,
      links: [],
      groups: [],
      config: {},
      version: 1,
    } as unknown as Workflow,
    nodeTypes: NODE_TYPES,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  });
}

/** Queue once with /api/prompt rejecting with `promptError`; return the result. */
async function queueWithFailingPrompt(promptError: Error): Promise<boolean> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/prompt')) throw promptError;
    if (url.includes('/api/queue')) {
      return { ok: true, json: async () => ({ queue_running: [], queue_pending: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return useWorkflowStore.getState().queueWorkflow(1);
}

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null,
    originalWorkflow: null,
    nodeTypes: null,
    hiddenItems: {},
    collapsedItems: {},
    mobileLayout: createEmptyMobileLayout(),
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    scopeStack: [{ type: 'root' }],
    currentWorkflowKey: null,
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    promptToSession: {},
    isLoadingBySession: {},
  });
  useWorkflowErrorsStore.setState({
    error: null, errorKind: null, nodeErrors: {}, errorCycleIndex: 0, errorsDismissed: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('queue prompt network failures', () => {
  it('replaces the browser network-error message with an actionable one', async () => {
    loadWorkflow([makeNode(1)]);
    // Safari's exact message for a fetch killed by a dropped connection.
    const ok = await queueWithFailingPrompt(new TypeError('Load failed'));
    expect(ok).toBe(false);
    expect(useWorkflowErrorsStore.getState().error).toBe(
      'Could not reach the server — check your connection and try again.',
    );
  });

  it("recognizes Chrome's and Firefox's network-error messages too", async () => {
    for (const message of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
    ]) {
      loadWorkflow([makeNode(1)]);
      await queueWithFailingPrompt(new TypeError(message));
      expect(useWorkflowErrorsStore.getState().error).toBe(
        'Could not reach the server — check your connection and try again.',
      );
    }
  });

  it('passes a non-network error message through untouched', async () => {
    loadWorkflow([makeNode(1)]);
    const ok = await queueWithFailingPrompt(new Error('CUDA out of memory'));
    expect(ok).toBe(false);
    expect(useWorkflowErrorsStore.getState().error).toBe('CUDA out of memory');
  });

  it('does not mislabel an unrelated TypeError as a connection problem', async () => {
    loadWorkflow([makeNode(1)]);
    await queueWithFailingPrompt(new TypeError("undefined is not a function"));
    expect(useWorkflowErrorsStore.getState().error).toBe('undefined is not a function');
  });
});
