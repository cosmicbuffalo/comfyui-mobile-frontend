import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NodeTypes, Workflow } from '@/api/types';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';
import { useBookmarksStore } from '../useBookmarks';
import { createEmptyMobileLayout } from '@/utils/mobileLayout';
import { queueAndGetEmbeddedWorkflow } from './helpers/queueAndGetEmbeddedWorkflow';

function loadFixtureWorkflow(): Workflow {
  const fixturePath = resolve(
    process.cwd(),
    'src/hooks/__tests__/fixtures/complex_i2v_example_workflow.json',
  );
  return JSON.parse(readFileSync(fixturePath, 'utf-8')) as Workflow;
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
    currentWorkflowKey: null,
    savedWorkflowStates: {},
    executingNodeId: null,
    executingNodePath: null,
    executingPromptId: null,
    nodeOutputs: {},
    nodeTextOutputs: {},
    promptOutputs: {},
  });
  useBookmarksStore.setState({ bookmarkedItems: [] });
  useWorkflowErrorsStore.setState({
    error: null,
    nodeErrors: {},
    errorCycleIndex: 0,
    errorsDismissed: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('embed workflow metadata', () => {
  it('keeps unsaved widgets_values changes synced into queued extra_pnginfo workflow', async () => {
    const workflow = loadFixtureWorkflow();
    useWorkflowStore.getState().setNodeTypes({} as NodeTypes);
    useWorkflowStore.getState().loadWorkflow(workflow, 'complex_i2v_example_workflow.json', { fresh: true });

    // Use a canonical root node (id 960, LoadImage) which has an array widgets_values.
    // In the canonical model, workflow.nodes contains only root-level nodes.
    const loadedNode = useWorkflowStore.getState().workflow?.nodes.find((node) => node.id === 960);
    expect(loadedNode).toBeDefined();
    expect(loadedNode?.itemKey).toBeDefined();

    const updatedValue = 'updated-node-960-image.png';
    useWorkflowStore
      .getState()
      .updateNodeWidget(String(loadedNode?.itemKey), 0, updatedValue);

    const embedded = await queueAndGetEmbeddedWorkflow();
    // In canonical model, root node 960 is directly in embedded.nodes
    const embeddedNode = embedded.nodes.find((node) => node.id === 960);
    expect(embeddedNode).toBeDefined();
    expect(Array.isArray(embeddedNode?.widgets_values)).toBe(true);
    expect((embeddedNode?.widgets_values as string[])[0]).toBe(updatedValue);
  });
});
