import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NodeTypes, Workflow } from '@/api/types';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';
import { useBookmarksStore } from '../useBookmarks';
import { createEmptyMobileLayout } from '@/utils/mobileLayout';
import { queueAndGetEmbeddedWorkflow } from './helpers/queueAndGetEmbeddedWorkflow';
import { queueAndGetPromptRequest } from './helpers/queueAndGetEmbeddedWorkflow';
import { useWorkflowHiddenStore } from '@/hooks/useWorkflowHidden';
import { HIDDEN_WORKFLOW_EXTRA_DATA_KEY } from '@/utils/workflowHidden';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import { QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY } from '@/utils/queueWorkflowLabel';

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
  useWorkflowHiddenStore.setState({ hidden: [], serverSynced: false, serverDirty: false });
  useWorkflowErrorsStore.setState({
    error: null,
    nodeErrors: {},
    errorCycleIndex: 0,
    errorsDismissed: false,
  });
  useGenerationSettingsStore.setState({ previewMethod: 'none' });
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

  it('keeps the queue workflow label outside embedded PNG metadata', async () => {
    const workflow = loadFixtureWorkflow();
    useWorkflowStore.getState().setNodeTypes({} as NodeTypes);
    useWorkflowStore.getState().loadWorkflow(workflow, 'examples/Portrait Studio.json', {
      fresh: true,
    });

    const request = await queueAndGetPromptRequest();

    expect(request.extra_data?.[QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY]).toBe('Portrait Studio');
    expect(request.extra_data?.extra_pnginfo).not.toHaveProperty(
      QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY,
    );
  });

  it('marks queued payloads from hidden workflows', async () => {
    const workflow = loadFixtureWorkflow();
    useWorkflowStore.getState().setNodeTypes({} as NodeTypes);
    useWorkflowHiddenStore.setState({ hidden: ['secret'] });
    useWorkflowStore.getState().loadWorkflow(workflow, 'secret/workflow.json', {
      fresh: true,
      source: { type: 'user', filename: 'secret/workflow.json' },
    });

    const request = await queueAndGetPromptRequest();

    expect(request.extra_data?.[HIDDEN_WORKFLOW_EXTRA_DATA_KEY]).toBe(true);
  });

  it('mints an Oasis io_id before prompt construction and persists the same routing id', async () => {
    const workflow: Workflow = {
      last_node_id: 7,
      last_link_id: 0,
      nodes: [{
        id: 7,
        type: 'VideoOasisPreview',
        pos: [0, 0],
        size: [320, 240],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [],
        properties: {},
        widgets_values: { video_oasis_ui: '{}' },
      }],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const oasisTypes = {
      VideoOasisPreview: {
        input: { required: {}, optional: { video_oasis_ui: ['STRING', { default: '{}' }] } },
        output: ['VIDEO'],
        output_node: true,
        name: 'VideoOasisPreview',
        display_name: 'Video Oasis Preview',
        description: '',
        python_module: 'ComfyUI-Image-Oasis.video_oasis.preview_node',
        category: 'video',
      },
    } as unknown as NodeTypes;
    useWorkflowStore.getState().setNodeTypes(oasisTypes);
    useWorkflowStore.getState().loadWorkflow(workflow, 'oasis.json', { fresh: true });

    const request = await queueAndGetPromptRequest();
    const embedded = (request.extra_data?.extra_pnginfo as { workflow?: Workflow } | undefined)?.workflow as Workflow;
    const embeddedRaw = (embedded.nodes[0].widgets_values as Record<string, string>).video_oasis_ui;
    const canonicalRaw = (useWorkflowStore.getState().workflow!.nodes[0].widgets_values as Record<string, string>).video_oasis_ui;
    const embeddedId = JSON.parse(embeddedRaw).io_id;

    expect(typeof embeddedId).toBe('string');
    expect(embeddedId.length).toBeGreaterThan(0);
    expect(JSON.parse(canonicalRaw).io_id).toBe(embeddedId);
    expect((request.prompt['7'] as { inputs: Record<string, unknown> }).inputs.video_oasis_ui)
      .toBe(embeddedRaw);
  });

  it('enables VHS animated latent metadata when mobile latent previews are enabled', async () => {
    const workflow = loadFixtureWorkflow();
    useWorkflowStore.getState().setNodeTypes({} as NodeTypes);
    useWorkflowStore.getState().loadWorkflow(workflow, 'latent-video.json', { fresh: true });
    useGenerationSettingsStore.setState({ previewMethod: 'latent2rgb' });

    const request = await queueAndGetPromptRequest();
    const embedded = (request.extra_data?.extra_pnginfo as { workflow?: Workflow } | undefined)?.workflow as Workflow;
    expect(request.extra_data?.preview_method).toBe('latent2rgb');
    expect(embedded.extra?.VHS_latentpreview).toBe(true);
    expect(embedded.extra?.VHS_latentpreviewrate).toBe(0);
  });

  it('disables imported VHS latent animation when mobile previews are off', async () => {
    const workflow = { ...loadFixtureWorkflow(), extra: { VHS_latentpreview: true } };
    useWorkflowStore.getState().setNodeTypes({} as NodeTypes);
    useWorkflowStore.getState().loadWorkflow(workflow, 'desktop-vhs.json', { fresh: true });
    useGenerationSettingsStore.setState({ previewMethod: 'none' });

    const request = await queueAndGetPromptRequest();
    const embedded = (request.extra_data?.extra_pnginfo as { workflow?: Workflow } | undefined)?.workflow as Workflow;
    expect(request.extra_data?.preview_method).toBeUndefined();
    expect(embedded.extra?.VHS_latentpreview).toBe(false);
  });
});
