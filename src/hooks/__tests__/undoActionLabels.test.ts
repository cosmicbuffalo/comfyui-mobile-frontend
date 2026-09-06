import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { UNDO_ACTION_LABELS } from '@/utils/undoActionLabels';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowUndoStore } from '../useWorkflowUndo';

/**
 * Every action that changes the workflow is either named in the toast or listed
 * here as deliberately not an undo step. The source audit below is what keeps
 * that true as actions are added: a new one that writes `workflow` and appears
 * in neither list fails this suite rather than shipping with a generic
 * "Edit workflow" toast.
 */
const NOT_UNDOABLE: Record<string, string> = {
  loadWorkflow: 'Opening a workflow is not an edit — it resets the tab history.',
  setSavedWorkflow: 'Records what is now on disk; the graph does not change.',
  clearWorkflowCache: 'Revert-to-saved, which starts a fresh history of its own.',
  ensureHierarchicalKeysAndRepair: 'Key/layout repair — invisible to the user.',
  applyControlAfterGenerate: 'Seed roll after a run; seeds are excluded from history.',
  queueWorkflow: 'Writes the seeds it queued with, which are excluded from history.',
  setMobileLayout: 'Only re-annotates layout pointers onto the nodes, which is not a '
    + 'change to the workflow — and nothing in the app calls it. Reordering commits '
    + 'through commitRepositionLayout, which does move nodes and is undoable.',
};

function actionsWritingWorkflow(): Map<string, string> {
  const dir = resolve(process.cwd(), 'src/hooks/useWorkflow');
  const found = new Map<string, string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(resolve(dir, file), 'utf8');
    const definition = /const\s+\w+\s*:\s*WorkflowState\["(\w+)"\]/g;
    const matches = [...source.matchAll(definition)];
    matches.forEach((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? source.length;
      // The canonical workflow is only ever replaced by a `workflow:` key in a
      // set() payload, so its presence in the body is the test for "edits".
      if (source.slice(start, end).includes('workflow:')) {
        found.set(match[1], `src/hooks/useWorkflow/${file}`);
      }
    });
  }
  return found;
}

const key = (nodeId: number) => makeLocationPointer({ type: 'node', nodeId, subgraphId: null });

function node(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: key(id),
    type,
    pos: [id * 10, id * 10],
    size: [200, 100],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  } as WorkflowNode;
}

function makeWorkflow(): Workflow {
  return {
    last_node_id: 3,
    last_link_id: 1,
    nodes: [
      node(1, 'Loader', { outputs: [{ name: 'CLIP', type: 'CLIP', links: [1] }] }),
      node(2, 'Encode', { inputs: [{ name: 'clip', type: 'CLIP', link: 1 }] }),
      node(3, 'Sampler', { inputs: [{ name: 'clip', type: 'CLIP', link: null }] }),
    ],
    links: [[1, 1, 0, 2, 0, 'CLIP']],
    groups: [],
    config: {},
  } as unknown as Workflow;
}

const SESSION = 'undo-labels-test';

describe('undo action labels', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      activeSessionId: SESSION,
      parkedSessions: {},
      workflowLoadedAt: 4242,
      mobileLayout: createEmptyMobileLayout(),
      scopeStack: [{ type: 'root' }],
      hiddenItems: {},
      collapsedItems: {},
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
      nodeTypes: null,
      jumpToWorkflowItem: vi.fn() as never,
    });
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });
  });

  it('names every action that edits the workflow', () => {
    const unnamed = [...actionsWritingWorkflow()]
      .filter(([name]) => !(name in UNDO_ACTION_LABELS) && !(name in NOT_UNDOABLE))
      .map(([name, file]) => `${name}  (${file})`);

    expect(
      unnamed,
      `${unnamed.length} action(s) change the workflow without a name for the `
        + 'Undo/Redo toast. Add each to UNDO_ACTION_LABELS in '
        + 'src/utils/undoActionLabels.ts, or to NOT_UNDOABLE here with the '
        + 'reason it is not an undo step:\n' + unnamed.join('\n'),
    ).toEqual([]);
  });

  it('has no label for an action the store no longer has', () => {
    const store = useWorkflowStore.getState() as unknown as Record<string, unknown>;
    const dead = Object.keys(UNDO_ACTION_LABELS).filter(
      (name) => typeof store[name] !== 'function',
    );
    expect(dead, `stale entries in UNDO_ACTION_LABELS:\n${dead.join('\n')}`).toEqual([]);
  });

  it('puts the action it ran in the toast', () => {
    useWorkflowStore.getState().updateNodeTitle(key(1), 'Checkpoint');
    useWorkflowUndoStore.getState().undo();
    expect(useWorkflowUndoStore.getState().feedback).toMatchObject({
      direction: 'undo',
      actionLabel: 'Rename node',
    });

    useWorkflowUndoStore.getState().redo();
    expect(useWorkflowUndoStore.getState().feedback).toMatchObject({
      direction: 'redo',
      actionLabel: 'Rename node',
    });
  });

  it('names a delete, a connect and a disconnect apart from each other', () => {
    const labels = () =>
      useWorkflowUndoStore.getState().histories[SESSION]!.undo.map((s) => s.actionLabel);

    useWorkflowStore.getState().connectNodes(key(1), 0, key(3), 0, 'CLIP');
    useWorkflowStore.getState().disconnectInput(key(2), 0);
    useWorkflowStore.getState().deleteNode(key(3), false);

    expect(labels()).toEqual(['Connect', 'Disconnect', 'Delete node']);
  });

  it('records a composite action as one step, under the name of the action itself', () => {
    // deleteSelectedItems deletes each item through deleteNode. Without the
    // outer name the step would be called "Delete node" — the inner commit —
    // and three deletions would be three steps to take back.
    useWorkflowStore.getState().deleteSelectedItems([key(2), key(3)]);

    const history = useWorkflowUndoStore.getState().histories[SESSION]!;
    expect(history.undo).toHaveLength(1);
    expect(history.undo[0].actionLabel).toBe('Delete selection');

    useWorkflowUndoStore.getState().undo();
    expect(useWorkflowStore.getState().workflow!.nodes.map((n) => n.id)).toEqual([1, 2, 3]);
  });
});

describe('undo reveals what it changed', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      activeSessionId: SESSION,
      parkedSessions: {},
      workflowLoadedAt: 5252,
      mobileLayout: createEmptyMobileLayout(),
      scopeStack: [{ type: 'root' }],
      hiddenItems: {},
      collapsedItems: {},
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
      nodeTypes: null,
    });
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });
  });

  it('jumps to the node an undo brought back, so it scrolls into view and flashes', async () => {
    const jumpToWorkflowItem = vi.fn();
    useWorkflowStore.setState({ jumpToWorkflowItem: jumpToWorkflowItem as never });

    useWorkflowStore.getState().updateNodeTitle(key(2), 'Renamed');
    useWorkflowUndoStore.getState().undo();

    await new Promise((done) => setTimeout(done, 0));
    expect(jumpToWorkflowItem).toHaveBeenCalledWith(
      { kind: 'node', itemKey: key(2) },
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('jumps to the node a redo re-applies to', async () => {
    const jumpToWorkflowItem = vi.fn();
    useWorkflowStore.setState({ jumpToWorkflowItem: jumpToWorkflowItem as never });

    useWorkflowStore.getState().updateNodeTitle(key(2), 'Renamed');
    useWorkflowUndoStore.getState().undo();
    jumpToWorkflowItem.mockClear();
    useWorkflowUndoStore.getState().redo();

    await new Promise((done) => setTimeout(done, 0));
    expect(jumpToWorkflowItem).toHaveBeenCalledWith(
      { kind: 'node', itemKey: key(2) },
      expect.objectContaining({ label: 'Redo' }),
    );
  });

  it('does not scroll to a node the step just removed', async () => {
    const jumpToWorkflowItem = vi.fn();
    useWorkflowStore.setState({ jumpToWorkflowItem: jumpToWorkflowItem as never });

    // Deleting node 3 records it as the change; redoing the delete leaves
    // nothing to reveal there, so the jump is skipped rather than aimed at a
    // card that no longer renders. (The toast still names it — see
    // undoToastCoverage.test.ts.)
    useWorkflowStore.getState().deleteNode(key(3), false);
    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));
    expect(jumpToWorkflowItem).toHaveBeenCalledWith(
      { kind: 'node', itemKey: key(3) },
      expect.objectContaining({ label: 'Undo' }),
    );

    jumpToWorkflowItem.mockClear();
    useWorkflowUndoStore.getState().redo();
    await new Promise((done) => setTimeout(done, 0));
    expect(jumpToWorkflowItem).not.toHaveBeenCalled();
  });
});
