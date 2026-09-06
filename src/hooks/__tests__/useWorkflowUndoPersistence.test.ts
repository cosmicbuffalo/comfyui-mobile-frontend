import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import {
  hydrateUndoHistoriesForTest,
  reloadUndoHistoriesForTest,
  resetUndoHistoryForTest,
  useWorkflowUndoStore,
} from '@/hooks/useWorkflowUndo';
import { flushUndoHistory } from '@/utils/undoHistoryStorage';
import type { Workflow, WorkflowNode } from '@/api/types';

// End-to-end for the one thing a unit test of the store cannot show: that the
// undo history a tab built up is still there — and still works — after the page
// has gone away and come back. `reloadUndoHistoriesForTest` is the refresh:
// the in-memory history is dropped exactly as a reload drops it, and only what
// was written to storage can bring it back.

function node(id: number, title?: string): WorkflowNode {
  return {
    id,
    type: 'N',
    title,
    pos: [0, 0],
    size: [1, 1],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    itemKey: `node:${id}`,
  } as unknown as WorkflowNode;
}

function wf(ids: number[]): Workflow {
  return {
    nodes: ids.map((id) => node(id)),
    groups: [],
    links: [],
    definitions: { subgraphs: [] },
    last_node_id: Math.max(0, ...ids),
    last_link_id: 0,
    version: 0.4,
    config: {},
  } as unknown as Workflow;
}

const layout = () => ({ root: [], groups: {}, subgraphs: {}, hiddenBlocks: {} });

let loadCounter = 9000;

function loadActive(ids: number[], sessionId = 'tab-A', loadedAt?: number) {
  loadCounter += 1;
  useWorkflowStore.setState({
    workflow: wf(ids),
    mobileLayout: layout() as never,
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    activeSessionId: sessionId,
    parkedSessions: {},
    workflowLoadedAt: loadedAt ?? loadCounter,
    nodeTypes: null,
    scrollToNode: vi.fn() as never,
    jumpToWorkflowItem: vi.fn() as never,
    revealNodeWithParents: vi.fn() as never,
  });
}

function edit(ids: number[]) {
  useWorkflowStore.setState({ workflow: wf(ids) });
}

const ids = () => (useWorkflowStore.getState().workflow?.nodes ?? []).map((n) => n.id);
const history = (session = 'tab-A') => useWorkflowUndoStore.getState().histories[session];

describe('undo history across a page reload', () => {
  beforeEach(async () => {
    await resetUndoHistoryForTest();
    loadActive([1]);
    await resetUndoHistoryForTest();
  });

  it('restores the undo stack, and undoing still rolls the workflow back', async () => {
    edit([1, 2]);
    edit([1, 2, 3]);
    expect(history()!.undo).toHaveLength(2);

    await reloadUndoHistoriesForTest();

    expect(history()!.undo).toHaveLength(2);
    useWorkflowUndoStore.getState().undo();
    expect(ids()).toEqual([1, 2]);
    useWorkflowUndoStore.getState().undo();
    expect(ids()).toEqual([1]);
  });

  it('restores the redo stack too, with the step names it was recorded under', async () => {
    edit([1, 2]);
    useWorkflowUndoStore.getState().undo();
    expect(history()!.redo).toHaveLength(1);

    await reloadUndoHistoriesForTest();

    expect(history()!.redo).toHaveLength(1);
    expect(history()!.redo[0].actionLabel).toBe('Add node');
    useWorkflowUndoStore.getState().redo();
    expect(ids()).toEqual([1, 2]);
    expect(useWorkflowUndoStore.getState().feedback?.actionLabel).toBe('Add node');
  });

  it('keeps a history for every open tab, active and parked alike', async () => {
    edit([1, 2]);
    // Park tab A and make tab B active in one go, the way switchToSession does
    // — a tab that is momentarily neither active nor parked reads as closed.
    loadCounter += 1;
    useWorkflowStore.setState({
      parkedSessions: {
        'tab-A': { workflowLoadedAt: useWorkflowStore.getState().workflowLoadedAt },
      } as never,
      activeSessionId: 'tab-B',
      workflow: wf([7]),
      workflowLoadedAt: loadCounter,
    });
    edit([7, 8]);

    await reloadUndoHistoriesForTest();

    expect(history('tab-A')!.undo).toHaveLength(1);
    expect(history('tab-B')!.undo).toHaveLength(1);
  });

  it('keeps valid history while cleaning up a stale sibling tab', async () => {
    edit([1, 2]);
    const tabALoadedAt = useWorkflowStore.getState().workflowLoadedAt;
    loadCounter += 1;
    useWorkflowStore.setState({
      parkedSessions: {
        'tab-A': { workflowLoadedAt: tabALoadedAt },
      } as never,
      activeSessionId: 'tab-B',
      workflow: wf([7]),
      workflowLoadedAt: loadCounter,
    });
    edit([7, 8]);
    flushUndoHistory();

    // Make only tab A's stored load stamp stale. Hydration should collect its
    // snapshot bodies without replacing tab B's valid index with an empty one.
    useWorkflowStore.setState({
      parkedSessions: {
        'tab-A': { workflowLoadedAt: tabALoadedAt + 1 },
      } as never,
    });

    await reloadUndoHistoriesForTest();
    expect(history('tab-A')).toBeUndefined();
    expect(history('tab-B')!.undo).toHaveLength(1);

    // The cleanup write itself must survive another page reload.
    await reloadUndoHistoriesForTest();
    expect(history('tab-B')!.undo).toHaveLength(1);
  });

  it('drops a history whose tab is no longer open', async () => {
    edit([1, 2]);
    flushUndoHistory();
    // The tab is gone: a different session is active and nothing is parked.
    loadActive([5], 'tab-Z');

    await reloadUndoHistoriesForTest();

    expect(history('tab-A')).toBeUndefined();
  });

  it('drops a history for a tab that has since loaded a different workflow', async () => {
    edit([1, 2]);
    flushUndoHistory();
    // Same tab id, new load stamp — a reload/revert/new workflow in that tab.
    loadActive([4], 'tab-A');

    await reloadUndoHistoriesForTest();

    expect(history('tab-A')).toBeUndefined();
  });

  it('leaves a live history alone when hydration lands after an edit', async () => {
    // Reading the stored history back is asynchronous, so an edit can beat it
    // in. The edit is the newer truth and must survive.
    edit([1, 2]);
    edit([1, 2, 3]);
    const live = history()!.undo;

    await hydrateUndoHistoriesForTest();

    expect(history()!.undo).toBe(live);
    expect(history()!.undo).toHaveLength(2);
  });

  it('keeps the stored history to the same depth cap as the live one', async () => {
    for (let n = 2; n <= 14; n += 1) edit(Array.from({ length: n }, (_, i) => i + 1));
    expect(history()!.undo).toHaveLength(10);

    await reloadUndoHistoriesForTest();

    expect(history()!.undo).toHaveLength(10);
    // Still the NEWEST ten: undoing walks back one edit at a time.
    useWorkflowUndoStore.getState().undo();
    expect(ids()).toHaveLength(13);
  });
});
