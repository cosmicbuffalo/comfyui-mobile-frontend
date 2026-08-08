import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useWorkflowUndoStore } from '@/hooks/useWorkflowUndo';
import { runUndoTransaction } from '@/utils/undoTransaction';
import type { Workflow, WorkflowNode } from '@/api/types';

function node(id: number): WorkflowNode {
  return {
    id,
    type: 'N',
    pos: [0, 0],
    size: [1, 1],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    itemKey: `node:${id}`,
  };
}

function wf(ids: number[]): Workflow {
  return {
    nodes: ids.map(node),
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
let loadCounter = 5000;

// A fresh load: new workflowLoadedAt -> the undo system resets that tab's history.
function loadActive(ids: number[], sessionId = 'tab-A') {
  loadCounter += 1;
  useWorkflowStore.setState({
    workflow: wf(ids),
    mobileLayout: layout() as never,
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    activeSessionId: sessionId,
    workflowLoadedAt: loadCounter,
    nodeTypes: null,
    scrollToNode: vi.fn() as never,
    revealNodeWithParents: vi.fn() as never,
  });
}

// An edit: change the workflow but keep the same tab + load timestamp.
function edit(ids: number[]) {
  useWorkflowStore.setState({ workflow: wf(ids) });
}

const ids = () => (useWorkflowStore.getState().workflow?.nodes ?? []).map((n) => n.id);
const undoLen = (s = 'tab-A') => useWorkflowUndoStore.getState().histories[s]?.undo.length ?? 0;
const redoLen = (s = 'tab-A') => useWorkflowUndoStore.getState().histories[s]?.redo.length ?? 0;

describe('useWorkflowUndo', () => {
  beforeEach(() => {
    useWorkflowUndoStore.setState({ histories: {} });
    loadActive([1]);
    useWorkflowUndoStore.setState({ histories: {} });
  });

  it('records an edit and undoes/redoes it', () => {
    edit([1, 2]);
    expect(undoLen()).toBe(1);
    expect(ids()).toEqual([1, 2]);

    useWorkflowUndoStore.getState().undo();
    expect(ids()).toEqual([1]);
    expect(undoLen()).toBe(0);
    expect(redoLen()).toBe(1);

    useWorkflowUndoStore.getState().redo();
    expect(ids()).toEqual([1, 2]);
    expect(undoLen()).toBe(1);
    expect(redoLen()).toBe(0);
  });

  it('clears redo when a new edit follows an undo', () => {
    edit([1, 2]);
    useWorkflowUndoStore.getState().undo();
    expect(redoLen()).toBe(1);
    edit([1, 3]);
    expect(redoLen()).toBe(0);
    expect(undoLen()).toBe(1);
  });

  it('caps history at 10 steps', () => {
    for (let n = 2; n <= 14; n += 1) {
      edit(Array.from({ length: n }, (_, i) => i + 1));
    }
    expect(undoLen()).toBe(10);
  });

  it('keeps a separate history per tab', () => {
    edit([1, 2]);
    expect(undoLen('tab-A')).toBe(1);

    loadActive([5], 'tab-B'); // switch tabs (not an edit)
    expect(undoLen('tab-B')).toBe(0);
    edit([5, 6]);
    expect(undoLen('tab-B')).toBe(1);
    expect(undoLen('tab-A')).toBe(1); // tab A untouched
  });

  it('ignores a no-op workflow replacement (identical content)', () => {
    edit([1]); // new object, same content
    expect(undoLen()).toBe(0);
  });

  it('records a multi-set transaction as one undo step', () => {
    // Composite action shape (pop-out): several structural set() calls.
    runUndoTransaction(() => {
      edit([1, 2]);
      edit([1, 2, 3]);
      edit([1, 2, 3, 4]);
    });
    expect(undoLen()).toBe(1);
    expect(ids()).toEqual([1, 2, 3, 4]);

    // One Undo rolls the WHOLE action back — no half-materialized states.
    useWorkflowUndoStore.getState().undo();
    expect(ids()).toEqual([1]);
    expect(undoLen()).toBe(0);

    useWorkflowUndoStore.getState().redo();
    expect(ids()).toEqual([1, 2, 3, 4]);
  });

  it('merges changed node ids across a transaction', () => {
    runUndoTransaction(() => {
      edit([1, 2]);
      edit([1, 2, 3]);
    });
    const history = useWorkflowUndoStore.getState().histories['tab-A'];
    const snapshot = history.undo[history.undo.length - 1];
    expect(new Set(snapshot.changedNodeIds)).toEqual(new Set([2, 3]));
  });

  it('edits after a transaction record separate steps again', () => {
    runUndoTransaction(() => {
      edit([1, 2]);
      edit([1, 2, 3]);
    });
    edit([1, 2, 3, 4]);
    expect(undoLen()).toBe(2);
  });
});
