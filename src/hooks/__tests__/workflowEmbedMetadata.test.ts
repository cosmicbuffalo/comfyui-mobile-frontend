import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NodeTypes, Workflow } from '@/api/types';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';
import { useBookmarksStore } from '../useBookmarks';
import { createEmptyMobileLayout } from '@/utils/mobileLayout';
import { queueAndGetEmbeddedWorkflow } from './helpers/queueAndGetEmbeddedWorkflow';

type MobileOrigin =
  | { scope: 'root'; nodeId: number }
  | { scope: 'subgraph'; subgraphId: string; nodeId: number };

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
    embedWorkflow: null,
    originalWorkflow: null,
    nodeTypes: null,
    hiddenItems: {},
    collapsedItems: {},
    connectionHighlightModes: {},
    mobileLayout: createEmptyMobileLayout(),
    stableKeyByPointer: {},
    pointerByStableKey: {},
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

    // change prompt value
    const loadedNode = useWorkflowStore.getState().workflow?.nodes.find((node) => node.id === 1020);
    expect(loadedNode).toBeDefined();
    expect(loadedNode?.stableKey).toBeDefined();

    const updatedText = 'updated-node-1020-text';
    useWorkflowStore
      .getState()
      .updateNodeWidget(String(loadedNode?.stableKey), 0, updatedText);

    const origin = (loadedNode?.properties as Record<string, unknown> | undefined)?.[
      '__mobile_origin'
    ] as MobileOrigin | undefined;

    const embedded = await queueAndGetEmbeddedWorkflow();
    const embeddedNode =
      origin?.scope === 'subgraph'
        ? embedded.definitions?.subgraphs
            ?.find((subgraph) => subgraph.id === origin.subgraphId)
            ?.nodes.find((node) => node.id === origin.nodeId)
        : embedded.nodes.find((node) => node.id === (origin?.nodeId ?? 1020));
    expect(embeddedNode).toBeDefined();
    expect(Array.isArray(embeddedNode?.widgets_values)).toBe(true);
    expect((embeddedNode?.widgets_values as unknown[])[0]).toBe(updatedText);
  });
});
