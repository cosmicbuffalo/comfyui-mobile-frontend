import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, queuePrompt: vi.fn(async () => ({ prompt_id: 'p' })) };
});

function nodeKey(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function makeImageOutputNode(
  type: 'PreviewImage' | 'SaveImage',
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    id: 1,
    itemKey: nodeKey(1),
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: { 'Node name for S&R': type },
    widgets_values: type === 'SaveImage' ? ['ComfyUI'] : undefined,
    ...overrides,
  } as WorkflowNode;
}

function seed(node: WorkflowNode) {
  const workflow: Workflow = {
    last_node_id: 1,
    last_link_id: 0,
    nodes: [node],
    links: [],
    groups: [],
    config: {},
    version: 1,
  } as unknown as Workflow;
  useWorkflowStore.setState({
    workflow,
    originalWorkflow: JSON.parse(JSON.stringify(workflow)),
    mobileLayout: createEmptyMobileLayout(),
    scopeStack: [{ type: 'root' }],
  });
}

function currentNode(): WorkflowNode {
  return useWorkflowStore.getState().workflow!.nodes[0];
}

describe('convertImageOutputNode', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ workflow: null, scopeStack: [{ type: 'root' }] });
  });

  it('drops the filename prefix when converting Save → Preview', () => {
    // PreviewImage takes no widgets; a leftover prefix would ride into the
    // queued prompt as a value the node doesn't accept.
    seed(makeImageOutputNode('SaveImage', { widgets_values: ['ComfyUI'] }));

    useWorkflowStore.getState().convertImageOutputNode(nodeKey(1), 'PreviewImage');

    expect(currentNode().type).toBe('PreviewImage');
    expect(currentNode().widgets_values).toBeUndefined();
  });

  it('gives a converted SaveImage the built-in default prefix', () => {
    seed(makeImageOutputNode('PreviewImage'));

    useWorkflowStore.getState().convertImageOutputNode(nodeKey(1), 'SaveImage');

    expect(currentNode().type).toBe('SaveImage');
    expect(currentNode().widgets_values).toEqual(['ComfyUI']);
  });

  it('round-trips a custom prefix through Preview and back', () => {
    seed(makeImageOutputNode('SaveImage', { widgets_values: ['my_project/run'] }));
    const store = () => useWorkflowStore.getState();

    store().convertImageOutputNode(nodeKey(1), 'PreviewImage');
    expect(currentNode().widgets_values).toBeUndefined();
    expect(currentNode().properties['mobile.filenamePrefix']).toBe('my_project/run');

    store().convertImageOutputNode(nodeKey(1), 'SaveImage');
    expect(currentNode().widgets_values).toEqual(['my_project/run']);
    // The stash is consumed, not left behind to resurrect later.
    expect(currentNode().properties['mobile.filenamePrefix']).toBeUndefined();
  });

  it('does not stash the default prefix', () => {
    seed(makeImageOutputNode('SaveImage', { widgets_values: ['ComfyUI'] }));

    useWorkflowStore.getState().convertImageOutputNode(nodeKey(1), 'PreviewImage');

    expect(currentNode().properties['mobile.filenamePrefix']).toBeUndefined();
  });

  it('moves a default S&R name with the type but leaves a custom one alone', () => {
    seed(makeImageOutputNode('SaveImage'));
    useWorkflowStore.getState().convertImageOutputNode(nodeKey(1), 'PreviewImage');
    expect(currentNode().properties['Node name for S&R']).toBe('PreviewImage');

    // A custom S&R name is the user's own %token% — renaming it would break
    // their text substitutions elsewhere in the graph.
    seed(makeImageOutputNode('SaveImage', {
      properties: { 'Node name for S&R': 'FinalRender' },
    }));
    useWorkflowStore.getState().convertImageOutputNode(nodeKey(1), 'PreviewImage');
    expect(currentNode().properties['Node name for S&R']).toBe('FinalRender');
  });

  it('ignores nodes that are not image-output nodes', () => {
    seed(makeImageOutputNode('SaveImage', { type: 'KSampler', widgets_values: [42] }));

    useWorkflowStore.getState().convertImageOutputNode(nodeKey(1), 'PreviewImage');

    expect(currentNode().type).toBe('KSampler');
    expect(currentNode().widgets_values).toEqual([42]);
  });

  it('is a no-op when the node is already the target type', () => {
    seed(makeImageOutputNode('SaveImage', { widgets_values: ['keep_me'] }));
    const before = useWorkflowStore.getState().workflow;

    useWorkflowStore.getState().convertImageOutputNode(nodeKey(1), 'SaveImage');

    expect(useWorkflowStore.getState().workflow).toBe(before);
  });
});
