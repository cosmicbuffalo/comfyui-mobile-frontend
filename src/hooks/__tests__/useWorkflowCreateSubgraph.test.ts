import { beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowUndoStore } from '../useWorkflowUndo';

const key = (nodeId: number) => makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
const groupKey = (groupId: number) => makeLocationPointer({ type: 'group', groupId, subgraphId: null });

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
    last_link_id: 2,
    nodes: [
      node(1, 'Loader', { outputs: [{ name: 'CLIP', type: 'CLIP', links: [1] }] }),
      node(2, 'Encode', {
        inputs: [{ name: 'clip', type: 'CLIP', link: 1 }],
        outputs: [{ name: 'COND', type: 'COND', links: [2] }],
      }),
      node(3, 'Sampler', { inputs: [{ name: 'positive', type: 'COND', link: 2 }] }),
    ],
    links: [
      [1, 1, 0, 2, 0, 'CLIP'],
      [2, 2, 0, 3, 0, 'COND'],
    ],
    groups: [],
    config: {},
  } as unknown as Workflow;
}

describe('createSubgraphFromItems', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      activeSessionId: 'create-subgraph-test',
      workflowLoadedAt: Date.now(),
      mobileLayout: createEmptyMobileLayout(),
      scopeStack: [{ type: 'root' }],
      hiddenItems: {},
      collapsedItems: {},
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });
  });

  it('wraps the selection and reports what the boundary became', () => {
    const created = useWorkflowStore.getState().createSubgraphFromItems([key(2)], 'Encoder');

    expect(created).toMatchObject({ inputCount: 1, outputCount: 1 });
    const workflow = useWorkflowStore.getState().workflow!;
    expect(workflow.definitions?.subgraphs?.[0]?.name).toBe('Encoder');
    expect(workflow.nodes.some((n) => n.id === 2)).toBe(false);
  });

  it('hands back a key the panel can jump to', () => {
    const created = useWorkflowStore.getState().createSubgraphFromItems([key(2)], 'Encoder');

    // Annotated during the same commit, so the caller can reveal the new card
    // rather than leaving the user to find what replaced their selection.
    expect(created?.placeholderItemKey).toBeTruthy();
    const workflow = useWorkflowStore.getState().workflow!;
    expect(
      workflow.nodes.find((n) => n.itemKey === created!.placeholderItemKey)?.type,
    ).toBe(created!.subgraphId);
  });

  it('ignores keys from another scope rather than pulling their nodes out of it', () => {
    const foreign = makeLocationPointer({ type: 'node', nodeId: 2, subgraphId: 'sg-x' });
    expect(
      useWorkflowStore.getState().createSubgraphFromItems([foreign], 'Nope'),
    ).toBeNull();
    expect(useWorkflowStore.getState().workflow!.definitions?.subgraphs ?? []).toHaveLength(0);
  });

  it('undoes and redoes multiple create-subgraph actions one complete step at a time', () => {
    const snapshot = () => {
      const state = useWorkflowStore.getState();
      return structuredClone({
        workflow: state.workflow,
        mobileLayout: state.mobileLayout,
        itemKeyByPointer: state.itemKeyByPointer,
        pointerByHierarchicalKey: state.pointerByHierarchicalKey,
      });
    };
    const initial = snapshot();

    useWorkflowStore.getState().createSubgraphFromItems([key(2)], 'Encoder');
    const afterFirst = snapshot();
    useWorkflowStore.getState().createSubgraphFromItems([key(1)], 'Loader');
    const afterSecond = snapshot();

    const history = () => useWorkflowUndoStore.getState().histories['create-subgraph-test'];
    expect(history().undo).toHaveLength(2);
    expect(history().undo.map((entry) => entry.actionLabel)).toEqual([
      'Create subgraph',
      'Create subgraph',
    ]);
    expect(afterSecond.workflow?.definitions?.subgraphs?.map((subgraph) => subgraph.name)).toEqual([
      'Encoder',
      'Loader',
    ]);

    useWorkflowUndoStore.getState().undo();
    expect(snapshot()).toEqual(afterFirst);
    expect(useWorkflowUndoStore.getState().feedback).toMatchObject({
      direction: 'undo',
      actionLabel: 'Create subgraph',
    });
    useWorkflowUndoStore.getState().undo();
    expect(snapshot()).toEqual(initial);
    expect(history().redo).toHaveLength(2);

    useWorkflowUndoStore.getState().redo();
    expect(snapshot()).toEqual(afterFirst);
    expect(useWorkflowUndoStore.getState().feedback).toMatchObject({
      direction: 'redo',
      actionLabel: 'Create subgraph',
    });
    useWorkflowUndoStore.getState().redo();
    expect(snapshot()).toEqual(afterSecond);
    expect(history().redo).toHaveLength(0);
  });
});

describe('moveItemsIntoSubgraph', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      scopeStack: [{ type: 'root' }],
      hiddenItems: {},
      collapsedItems: {},
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
  });

  /** Wrap the encoder, then report the placeholder's key to move things into. */
  function wrapEncoder(): string {
    const created = useWorkflowStore.getState().createSubgraphFromItems([key(2)], 'Encoder');
    return created!.placeholderItemKey!;
  }

  it('reports what the boundary gained and lost', () => {
    const placeholderKey = wrapEncoder();
    // The loader was feeding the placeholder; inside, it feeds the encoder
    // directly, so the input slot it was crossing has nothing left to carry.
    const result = useWorkflowStore.getState().moveItemsIntoSubgraph([key(1)], placeholderKey);

    expect(result).toMatchObject({ removedInputs: 1, addedInputs: 0 });
  });

  it('takes the node out of the scope it was in', () => {
    const placeholderKey = wrapEncoder();
    useWorkflowStore.getState().moveItemsIntoSubgraph([key(1)], placeholderKey);
    const workflow = useWorkflowStore.getState().workflow!;

    expect(workflow.nodes.some((n) => n.id === 1)).toBe(false);
    const def = workflow.definitions!.subgraphs![0];
    expect(def.nodes!.some((n) => n.type === 'Loader')).toBe(true);
  });

  it('moves a group box, its nodes, and nested group structure together', () => {
    const placeholderKey = wrapEncoder();
    const workflow = useWorkflowStore.getState().workflow!;
    workflow.nodes = workflow.nodes.map((entry) =>
      entry.type === 'Loader' ? { ...entry, pos: [500, 500] } : entry,
    );
    workflow.groups = [
      {
        id: 10,
        itemKey: groupKey(10),
        title: 'Outer',
        color: '#ffffff',
        bounding: [450, 450, 300, 240],
      },
      {
        id: 11,
        itemKey: groupKey(11),
        title: 'Inner',
        color: '#ffffff',
        bounding: [470, 470, 260, 200],
      },
    ];
    useWorkflowStore.setState({ workflow: { ...workflow } });

    const result = useWorkflowStore.getState().moveItemsIntoSubgraph(
      [groupKey(10)],
      placeholderKey,
    );
    const movedWorkflow = useWorkflowStore.getState().workflow!;
    const def = movedWorkflow.definitions!.subgraphs![0];

    expect(result).not.toBeNull();
    expect(movedWorkflow.groups).toEqual([]);
    expect(movedWorkflow.nodes.some((entry) => entry.type === 'Loader')).toBe(false);
    expect(def.nodes!.some((entry) => entry.type === 'Loader')).toBe(true);
    expect(def.groups?.map((group) => group.title)).toEqual(['Outer', 'Inner']);
    expect(def.groups?.every((group) => group.itemKey?.includes(`/subgraph:${def.id}/group:`))).toBe(true);
  });

  it('refuses a destination that is not a subgraph', () => {
    wrapEncoder();
    const before = useWorkflowStore.getState().workflow;

    // key(3) is a plain node. Reporting nothing rather than inventing a
    // definition around it is what keeps a mis-aimed move from eating nodes.
    expect(useWorkflowStore.getState().moveItemsIntoSubgraph([key(1)], key(3))).toBeNull();
    expect(useWorkflowStore.getState().workflow).toBe(before);
  });

  it('ignores keys from another scope', () => {
    const placeholderKey = wrapEncoder();
    const innerKey = makeLocationPointer({
      type: 'node',
      nodeId: 2,
      subgraphId: useWorkflowStore.getState().workflow!.definitions!.subgraphs![0].id,
    });
    const before = useWorkflowStore.getState().workflow!.definitions!.subgraphs![0].nodes!.length;

    useWorkflowStore.getState().moveItemsIntoSubgraph([innerKey], placeholderKey);

    // Nothing moved: the key names a node already inside, not one in this scope.
    expect(
      useWorkflowStore.getState().workflow!.definitions!.subgraphs![0].nodes!.length,
    ).toBe(before);
  });

  it('re-seats the placeholder from the definition it just changed', () => {
    const placeholderKey = wrapEncoder();
    useWorkflowStore.getState().moveItemsIntoSubgraph([key(1)], placeholderKey);
    const workflow = useWorkflowStore.getState().workflow!;
    const placeholder = workflow.nodes.find((n) => n.itemKey === placeholderKey)!;
    const def = workflow.definitions!.subgraphs![0];

    // Slot lists that disagree with the definition are what strand links.
    expect(placeholder.inputs).toHaveLength((def.inputs ?? []).length);
    expect(placeholder.outputs).toHaveLength((def.outputs ?? []).length);
  });

  it('keeps a replacement input connected through the selected instance', () => {
    const created = useWorkflowStore.getState().createSubgraphFromItems([key(3)], 'Sampler')!;

    const result = useWorkflowStore.getState().moveItemsIntoSubgraph(
      [key(2)],
      created.placeholderItemKey!,
    );
    const workflow = useWorkflowStore.getState().workflow!;
    const placeholder = workflow.nodes.find(
      (entry) => entry.itemKey === created.placeholderItemKey,
    )!;
    const def = workflow.definitions!.subgraphs!.find(
      (subgraph) => subgraph.id === created.subgraphId,
    )!;
    const encode = def.nodes!.find((entry) => entry.type === 'Encode')!;
    const parentLink = workflow.links.find(
      (link) => link[1] === 1 && link[3] === placeholder.id,
    )!;
    const boundaryLink = def.links.find(
      (link) => link.origin_id === -10 && link.target_id === encode.id,
    )!;

    // `positive` disappeared at index 0 and `clip` replaced it at index 0.
    // The store's normalization pass used to mistake the new link for the old
    // slot's connection and discard it.
    expect(result).toMatchObject({ removedInputs: 1, addedInputs: 1 });
    expect(placeholder.inputs?.map((input) => input.name)).toEqual(['clip']);
    expect(placeholder.inputs![0].link).toBe(parentLink[0]);
    expect(encode.inputs![0].link).toBe(boundaryLink.id);
  });

  it('is one undo step', () => {
    const placeholderKey = wrapEncoder();
    const before = useWorkflowStore.getState().workflow;
    useWorkflowStore.getState().moveItemsIntoSubgraph([key(1)], placeholderKey);
    expect(useWorkflowStore.getState().workflow).not.toBe(before);
  });
});
