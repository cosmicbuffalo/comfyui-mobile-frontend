import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore, MAX_WORKFLOW_SESSIONS, reconcileRehydratedSessions } from '../useWorkflow';
import { useSeedStore } from '../useSeed';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';
import { useQueueStore } from '../useQueue';

const anyNodeTypes: NodeTypes = {
  Any: {
    input: { required: {} },
    output: [],
    output_name: [],
    name: 'Any',
    display_name: 'Any',
    description: '',
    python_module: '',
    category: 'test',
  },
};

function rootKey(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function makeNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: rootKey(id),
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
  };
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
    currentFilename: null,
    currentWorkflowKey: null,
    savedWorkflowStates: {},
    nodeOutputs: {},
    nodeTextOutputs: {},
    promptOutputs: {},
    runCount: 1,
    infiniteLoop: false,
    infiniteLoopAwaitingRun: false,
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    infiniteLoopSessionId: null,
    promptToSession: {},
    isLoadingBySession: {},
    lastPromptSignatureBySession: {},
    closeForNewWorkflowRequest: null,
  });
  useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
  useWorkflowErrorsStore.setState({
    error: null,
    nodeErrors: {},
    errorCycleIndex: 0,
    errorsDismissed: false,
    sessionErrors: {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('multi-workflow sessions', () => {
  it('opening a second workflow creates a second tab and parks the first', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId;
    expect(firstId).not.toBeNull();
    expect(useWorkflowStore.getState().sessions).toHaveLength(1);

    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    const state = useWorkflowStore.getState();
    expect(state.sessions).toHaveLength(2);
    expect(state.activeSessionId).not.toBe(firstId);
    // First session is parked; active is the second workflow.
    expect(state.parkedSessions[firstId!]).toBeTruthy();
    expect(state.workflow?.nodes.some((n) => n.id === 2)).toBe(true);
    expect(state.currentFilename).toBe('b.json');
  });

  it('switching tabs restores the parked workflow and run count losslessly', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    useWorkflowStore.getState().setRunCount(5);

    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    const secondId = useWorkflowStore.getState().activeSessionId!;
    expect(secondId).not.toBe(firstId);

    useWorkflowStore.getState().switchToSession(firstId);
    const back = useWorkflowStore.getState();
    expect(back.activeSessionId).toBe(firstId);
    expect(back.currentFilename).toBe('a.json');
    expect(back.workflow?.nodes.some((n) => n.id === 1)).toBe(true);
    expect(back.runCount).toBe(5);
    // The session we switched away from is now parked.
    expect(back.parkedSessions[secondId]).toBeTruthy();
    expect(back.parkedSessions[firstId]).toBeUndefined();
  });

  it('keeps a background tab error off the foreground, then surfaces it on entering the tab', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    const secondId = useWorkflowStore.getState().activeSessionId!;
    expect(secondId).not.toBe(firstId);

    // A run error for the parked first tab is stashed per-session — it must not
    // hijack the active tab's banner.
    useWorkflowErrorsStore.getState().setSessionError(firstId, 'boom on a.json');
    expect(useWorkflowErrorsStore.getState().error).toBeNull();
    expect(useWorkflowErrorsStore.getState().sessionErrors[firstId]).toBe('boom on a.json');

    // Entering that tab promotes the error to the banner and clears the marker.
    useWorkflowStore.getState().switchToSession(firstId);
    expect(useWorkflowErrorsStore.getState().error).toBe('boom on a.json');
    expect(useWorkflowErrorsStore.getState().sessionErrors[firstId]).toBeUndefined();
  });

  it('clears a tab error marker when the tab is closed', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');

    useWorkflowErrorsStore.getState().setSessionError(firstId, 'boom on a.json');
    useWorkflowStore.getState().closeSession(firstId);
    expect(useWorkflowErrorsStore.getState().sessionErrors[firstId]).toBeUndefined();
  });

  it('keeps follow queue mode global when opening and switching workflow tabs', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    useWorkflowStore.getState().setFollowQueue(true);

    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    const secondId = useWorkflowStore.getState().activeSessionId!;

    expect(useWorkflowStore.getState().followQueue).toBe(true);
    useWorkflowStore.getState().switchToSession(firstId);
    expect(useWorkflowStore.getState().followQueue).toBe(true);
    useWorkflowStore.getState().switchToSession(secondId);
    expect(useWorkflowStore.getState().followQueue).toBe(true);
  });

  it('enforces a single infinite-loop owner across tabs', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    useWorkflowStore.getState().setInfiniteLoop(true);
    expect(useWorkflowStore.getState().infiniteLoopSessionId).toBe(firstId);

    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    const secondId = useWorkflowStore.getState().activeSessionId!;
    // Switching/opening does not move infinite mode off the first session.
    expect(useWorkflowStore.getState().infiniteLoopSessionId).toBe(firstId);
    // The active session's flat flag reflects that it is NOT the looping one.
    expect(useWorkflowStore.getState().infiniteLoop).toBe(false);

    // Enabling on the now-active session moves ownership.
    useWorkflowStore.getState().setInfiniteLoop(true);
    expect(useWorkflowStore.getState().infiniteLoopSessionId).toBe(secondId);
  });

  it('keeps an armed-but-never-run loop awaiting Run across tab opens, switches, and reloads', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    // Arm infinite mode without pressing Run.
    useWorkflowStore.getState().setInfiniteLoop(true);
    expect(useWorkflowStore.getState().infiniteLoopAwaitingRun).toBe(true);

    // Opening another workflow in a new tab must not clear the owner's guard —
    // the websocket idle-resume driver would otherwise auto-start a generation
    // the user never began.
    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    expect(useWorkflowStore.getState().infiniteLoopSessionId).toBe(firstId);
    expect(useWorkflowStore.getState().infiniteLoopAwaitingRun).toBe(true);

    // Neither must switching tabs.
    useWorkflowStore.getState().switchToSession(firstId);
    expect(useWorkflowStore.getState().infiniteLoopAwaitingRun).toBe(true);

    // The guard survives a reload: it is persisted alongside the loop owner.
    const persisted = useWorkflowStore.persist.getOptions().partialize!(
      useWorkflowStore.getState(),
    ) as { infiniteLoopSessionId: string | null; infiniteLoopAwaitingRun: boolean };
    expect(persisted.infiniteLoopSessionId).toBe(firstId);
    expect(persisted.infiniteLoopAwaitingRun).toBe(true);

    // Disarming clears it.
    useWorkflowStore.getState().setInfiniteLoop(false);
    expect(useWorkflowStore.getState().infiniteLoopAwaitingRun).toBe(false);
  });

  it('prompts to choose a tab to close when exceeding the session cap', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    // Fill up to the cap.
    for (let i = 1; i < MAX_WORKFLOW_SESSIONS; i++) {
      store.loadWorkflow(makeWorkflow([makeNode(i + 1)]), `w${i}.json`);
    }
    expect(useWorkflowStore.getState().sessions).toHaveLength(MAX_WORKFLOW_SESSIONS);

    // One past the cap is deferred behind a choose-to-close request.
    store.loadWorkflow(makeWorkflow([makeNode(99)]), 'overflow.json');
    expect(useWorkflowStore.getState().sessions).toHaveLength(MAX_WORKFLOW_SESSIONS);
    expect(useWorkflowStore.getState().closeForNewWorkflowRequest).toBeTruthy();

    // Resolving it closes the chosen tab and opens the pending workflow.
    useWorkflowStore.getState().resolveCloseForNewWorkflow(firstId);
    const state = useWorkflowStore.getState();
    expect(state.closeForNewWorkflowRequest).toBeNull();
    expect(state.sessions).toHaveLength(MAX_WORKFLOW_SESSIONS);
    expect(state.currentFilename).toBe('overflow.json');
    expect(state.sessions.some((s) => s.id === firstId)).toBe(false);
  });

  it('closing the active tab activates a neighbour; closing the last empties', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    const secondId = useWorkflowStore.getState().activeSessionId!;

    useWorkflowStore.getState().closeSession(secondId);
    const afterClose = useWorkflowStore.getState();
    expect(afterClose.sessions).toHaveLength(1);
    expect(afterClose.activeSessionId).toBe(firstId);
    expect(afterClose.currentFilename).toBe('a.json');

    useWorkflowStore.getState().closeSession(firstId);
    const empty = useWorkflowStore.getState();
    expect(empty.sessions).toHaveLength(0);
    expect(empty.activeSessionId).toBeNull();
    expect(empty.workflow).toBeNull();
  });

  it('reload in place (replaceActive) does not open a new tab', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    store.loadWorkflow(makeWorkflow([makeNode(1, { widgets_values: [42] })]), 'a.json', {
      replaceActive: true,
    });
    const state = useWorkflowStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(firstId);
  });

  it('clears parked prompt outputs but retains prompt routing for a completed background prompt', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');

    useWorkflowStore.setState((state) => ({
      promptToSession: { ...state.promptToSession, promptA: firstId },
    }));
    useWorkflowStore
      .getState()
      .addPromptOutputs('promptA', [{ filename: 'a.png', subfolder: '', type: 'output' }], firstId);

    expect(useWorkflowStore.getState().parkedSessions[firstId].promptOutputs.promptA).toHaveLength(1);

    useWorkflowStore.getState().clearPromptOutputs('promptA', firstId);

    const state = useWorkflowStore.getState();
    expect(state.parkedSessions[firstId].promptOutputs.promptA).toBeUndefined();
    // Routing is intentionally retained (bounded by the cap / pruned on close)
    // so a late straggler message still routes to its owning session.
    expect(state.promptToSession.promptA).toBe(firstId);

    // Closing the owning session prunes its routing entries.
    useWorkflowStore.getState().closeSession(firstId);
    expect(useWorkflowStore.getState().promptToSession.promptA).toBeUndefined();
  });

  it('keeps a tombstone routing entry for a still-live prompt when its tab is closed', () => {
    const store = useWorkflowStore.getState();
    store.loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const firstId = useWorkflowStore.getState().activeSessionId!;
    store.loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    const secondId = useWorkflowStore.getState().activeSessionId!;

    // firstId (now parked) owns two prompts: one still running on the backend
    // and one already finished.
    useWorkflowStore.setState((state) => ({
      promptToSession: {
        ...state.promptToSession,
        livePrompt: firstId,
        donePrompt: firstId,
      },
    }));
    useQueueStore.setState({
      running: [{ prompt_id: 'livePrompt' } as never],
      pending: [],
    });

    // Close the tab while its prompt is still executing on the backend.
    useWorkflowStore.getState().closeSession(firstId);

    const state = useWorkflowStore.getState();
    expect(state.sessions.some((s) => s.id === firstId)).toBe(false);
    expect(state.activeSessionId).toBe(secondId);
    // The live prompt keeps a tombstone mapping to the (now gone) session so a
    // late executed/error frame is flagged orphaned and DROPPED — never routed
    // onto the now-active tab. The finished prompt's mapping is pruned.
    expect(state.promptToSession.livePrompt).toBe(firstId);
    expect(state.promptToSession.donePrompt).toBeUndefined();

    // Don't leak queue state into sibling tests.
    useQueueStore.setState({ running: [], pending: [] });
  });

  it('stops infinite mode when an infinite re-enqueue would resubmit an identical prompt', async () => {
    const promptCalls: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/prompt')) promptCalls.push(input);
      if (url.includes('/api/queue')) {
        return { ok: true, json: async () => ({ queue_running: [], queue_pending: [] }) };
      }
      return { ok: true, json: async () => ({ prompt_id: `p-${promptCalls.length}`, number: 1 }) };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    useWorkflowStore.setState({ nodeTypes: anyNodeTypes });
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([makeNode(1)]), 'fixed.json');
    const sid = useWorkflowStore.getState().activeSessionId!;
    useWorkflowStore.getState().setInfiniteLoop(true);

    // First enqueue (the manual run that starts the loop) submits and records
    // the prompt signature.
    await useWorkflowStore.getState().queueWorkflow(1, sid);
    expect(promptCalls).toHaveLength(1);
    expect(useWorkflowStore.getState().infiniteLoopSessionId).toBe(sid);

    // The infinite re-enqueue would build an identical prompt (no seed to vary)
    // → it must NOT submit again, and must exit infinite mode with an error.
    await useWorkflowStore.getState().queueWorkflow(1, sid, true);
    expect(promptCalls).toHaveLength(1);
    expect(useWorkflowStore.getState().infiniteLoopSessionId).toBeNull();
    expect(useWorkflowStore.getState().infiniteLoop).toBe(false);
    expect(useWorkflowErrorsStore.getState().error).toMatch(/identical prompt/i);
  });

  it('switching tabs mid-enqueue does not overwrite the newly active tab', async () => {
    // Regression: queueWorkflow captures isActive/sid once, then writes the
    // seed-bumped workflow AFTER awaiting /api/prompt. If the user switches tabs
    // during that round-trip, a stale isActive must NOT route the write into the
    // tab that just became active.
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([makeNode(1)]), 'a.json');
    const sessionA = useWorkflowStore.getState().activeSessionId!;
    useWorkflowStore.getState().loadWorkflow(makeWorkflow([makeNode(2)]), 'b.json');
    const sessionB = useWorkflowStore.getState().activeSessionId!;
    // Make A active again (B parked), then enqueue twice for A.
    useWorkflowStore.getState().switchToSession(sessionA);
    expect(useWorkflowStore.getState().activeSessionId).toBe(sessionA);

    let promptCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/queue')) {
        return { ok: true, json: async () => ({ queue_running: [], queue_pending: [] }) };
      }
      if (url.includes('/api/prompt') && init?.method === 'POST') {
        promptCalls++;
        // User taps tab B during the first /api/prompt round-trip.
        if (promptCalls === 1) {
          useWorkflowStore.getState().switchToSession(sessionB);
        }
        return { ok: true, json: async () => ({ prompt_id: `p${promptCalls}`, number: promptCalls }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    useWorkflowStore.setState({ nodeTypes: anyNodeTypes });
    await useWorkflowStore.getState().queueWorkflow(2, sessionA);

    const state = useWorkflowStore.getState();
    // B became active mid-flight; its flat workflow must still be B's graph,
    // never A's (which the second iteration's write would have leaked in).
    expect(state.activeSessionId).toBe(sessionB);
    expect(state.workflow?.nodes.map((n) => n.id)).toEqual([2]);
    // A's edits land in its own parked snapshot.
    expect(state.parkedSessions[sessionA]?.workflow?.nodes.map((n) => n.id)).toEqual([1]);
  });
});

describe('reconcileRehydratedSessions', () => {
  type RehydratedState = Parameters<typeof reconcileRehydratedSessions>[0];

  function makeState(partial: Partial<RehydratedState>): RehydratedState {
    return {
      sessions: [],
      parkedSessions: {},
      activeSessionId: null,
      workflow: null,
      infiniteLoopSessionId: null,
      ...partial,
    } as unknown as RehydratedState;
  }

  it('drops a ghost tab that has no parked snapshot and is not active', () => {
    const state = makeState({
      sessions: [{ id: 'a' }, { id: 'ghost' }],
      activeSessionId: 'a',
      workflow: makeWorkflow([makeNode(1)]),
      parkedSessions: {},
    });
    reconcileRehydratedSessions(state);
    expect(state.sessions.map((s) => s.id)).toEqual(['a']);
    expect(state.activeSessionId).toBe('a');
  });

  it('re-adds a tab for the active workflow when its id is missing from sessions', () => {
    const snap = { workflow: makeWorkflow([makeNode(2)]) } as never;
    const state = makeState({
      sessions: [{ id: 'b' }],
      activeSessionId: 'a',
      workflow: makeWorkflow([makeNode(1)]),
      parkedSessions: { b: snap },
    });
    reconcileRehydratedSessions(state);
    expect(state.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(state.activeSessionId).toBe('a');
    expect(state.parkedSessions.b).toBeDefined();
  });

  it('promotes a parked tab when activeSessionId dangles and no workflow anchors it', () => {
    const snapWorkflow = makeWorkflow([makeNode(7)]);
    const snap = { workflow: snapWorkflow } as never;
    const state = makeState({
      sessions: [{ id: 'b' }],
      activeSessionId: 'missing',
      workflow: null,
      parkedSessions: { b: snap },
    });
    reconcileRehydratedSessions(state);
    expect(state.activeSessionId).toBe('b');
    expect(state.sessions.map((s) => s.id)).toEqual(['b']);
    // The promoted tab is no longer parked, and its workflow became the active one.
    expect(state.parkedSessions.b).toBeUndefined();
    expect(state.workflow?.nodes.map((n) => n.id)).toEqual([7]);
  });

  it('salvages a parked snapshot for the active id when its flat fields are empty', () => {
    // Corrupt input: the active id has a parked snapshot AND empty flat fields
    // (the active session's content normally lives only in the flat fields).
    const snap = { workflow: makeWorkflow([makeNode(9)]) } as never;
    const state = makeState({
      sessions: [{ id: 'a' }],
      activeSessionId: 'a',
      workflow: null,
      parkedSessions: { a: snap },
    });
    reconcileRehydratedSessions(state);
    expect(state.activeSessionId).toBe('a');
    expect(state.sessions.map((s) => s.id)).toEqual(['a']);
    // The snapshot was promoted into the flat fields rather than dropped, so the
    // active tab is not left blank, and it's no longer parked.
    expect(state.workflow?.nodes.map((n) => n.id)).toEqual([9]);
    expect(state.parkedSessions.a).toBeUndefined();
  });

  it('clears to an empty state when nothing is recoverable', () => {
    const state = makeState({
      sessions: [{ id: 'x' }],
      activeSessionId: 'missing',
      workflow: null,
      parkedSessions: {},
    });
    reconcileRehydratedSessions(state);
    expect(state.sessions).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect(state.workflow).toBeNull();
  });

  it('clears loop ownership when the looping tab no longer exists', () => {
    const state = makeState({
      sessions: [{ id: 'a' }],
      activeSessionId: 'a',
      workflow: makeWorkflow([makeNode(1)]),
      parkedSessions: {},
      infiniteLoopSessionId: 'gone',
    });
    reconcileRehydratedSessions(state);
    expect(state.infiniteLoopSessionId).toBeNull();
  });

  it('leaves a healthy multi-tab state untouched', () => {
    const snap = { workflow: makeWorkflow([makeNode(2)]) } as never;
    const state = makeState({
      sessions: [{ id: 'a' }, { id: 'b' }],
      activeSessionId: 'a',
      workflow: makeWorkflow([makeNode(1)]),
      parkedSessions: { b: snap },
      infiniteLoopSessionId: 'a',
    });
    reconcileRehydratedSessions(state);
    expect(state.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(state.activeSessionId).toBe('a');
    expect(state.parkedSessions.b).toBeDefined();
    expect(state.infiniteLoopSessionId).toBe('a');
  });
});
