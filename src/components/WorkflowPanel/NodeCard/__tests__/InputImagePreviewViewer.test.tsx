import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { NodeCard } from '@/components/WorkflowPanel/NodeCard';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useQueueStore } from '@/hooks/useQueue';
import { useBookmarksStore } from '@/hooks/useBookmarks';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { makeLocationPointer } from '@/utils/mobileLayout';

function makeLoadImageNode(): WorkflowNode {
  return {
    id: 12,
    itemKey: makeLocationPointer({ type: 'node', nodeId: 12, subgraphId: null }),
    type: 'LoadImage',
    pos: [0, 0],
    size: [240, 120],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: ['portrait.jpeg', 'image'],
  };
}

describe('NodeCard input image preview', () => {
  let container: HTMLDivElement;
  let root: Root;
  let node: WorkflowNode;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    node = makeLoadImageNode();

    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    const workflow: Workflow = {
      id: 'input-preview-test',
      last_node_id: node.id,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    useWorkflowStore.setState({
      workflow,
      originalWorkflow: workflow,
      nodeTypes: {
        LoadImage: {
          input: {
            required: {
              image: [['landscape.png', 'portrait.jpeg'], { image_upload: true }],
              upload: ['IMAGEUPLOAD', {}],
            },
          },
          output: ['IMAGE', 'MASK'],
          output_node: false,
          name: 'LoadImage',
          display_name: 'Load Image',
          description: '',
          python_module: 'nodes',
          category: 'image',
        },
      },
      collapsedItems: {},
      hiddenItems: {},
      connectionHighlightModes: {},
      nodeOutputs: {},
      nodeComparerOutputs: {},
      nodeTextOutputs: {},
      latentPreviews: {},
      isExecuting: false,
      executingPromptId: null,
      currentWorkflowKey: null,
    });
    useWorkflowErrorsStore.setState({ error: null, nodeErrors: {}, errorsDismissed: false });
    useQueueStore.setState({ running: [], pending: [], completing: [] });
    useBookmarksStore.setState({ bookmarkedItems: [] });
    useWorkflowSelectionStore.setState({ selectionMode: false, selectedKeys: [] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the node input file itself, with Follow Queue off', async () => {
    const onImageClick = vi.fn();
    await act(async () => {
      root.render(<NodeCard node={node} onImageClick={onImageClick} />);
    });

    const img = container.querySelector<HTMLImageElement>('.output-preview img');
    expect(img?.getAttribute('src')).toContain('filename=portrait.jpeg');

    await act(async () => {
      img?.click();
    });

    expect(onImageClick).toHaveBeenCalledTimes(1);
    const [images, index, enableFollowQueue] = onImageClick.mock.calls[0];
    expect(index).toBe(0);
    // Follow Queue swaps the viewer's whole list for the newest completed run.
    // Tapping an input image must keep showing that input.
    expect(enableFollowQueue).toBe(false);
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('portrait.jpeg');
    expect(images[0].file.id).toBe('input/portrait.jpeg');
  });

  it('still follows the queue when the preview is the node output', async () => {
    node = { ...node, type: 'PreviewImage', widgets_values: [] };
    const current = useWorkflowStore.getState().workflow!;
    useWorkflowStore.setState({
      workflow: { ...current, nodes: [node] },
      nodeTypes: {
        ...useWorkflowStore.getState().nodeTypes,
        PreviewImage: {
          input: { required: {} },
          output: [],
          output_node: true,
          name: 'PreviewImage',
          display_name: 'Preview Image',
          description: '',
          python_module: 'nodes',
          category: 'image',
        },
      },
      nodeOutputs: {
        '12': [{ filename: 'run_00001_.png', subfolder: '', type: 'output' }],
      },
    });

    const onImageClick = vi.fn();
    const preloaded: Array<{ onload: (() => void) | null; src: string }> = [];
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      src = '';
      constructor() { preloaded.push(this); }
    });

    await act(async () => {
      root.render(<NodeCard node={node} onImageClick={onImageClick} />);
    });
    await act(async () => preloaded[0]?.onload?.());

    const img = container.querySelector<HTMLImageElement>('.output-preview img');
    expect(img?.getAttribute('src')).toContain('filename=run_00001_.png');
    await act(async () => {
      img?.click();
    });

    expect(onImageClick.mock.calls[0][2]).toBe(true);
  });
});
