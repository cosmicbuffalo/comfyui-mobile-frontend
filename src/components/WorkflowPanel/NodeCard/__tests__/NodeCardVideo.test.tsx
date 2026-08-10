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

function makeNode(): WorkflowNode {
  return {
    id: 91,
    itemKey: makeLocationPointer({ type: 'node', nodeId: 91, subgraphId: null }),
    type: 'ThirdPartyVideoPreview',
    pos: [0, 0],
    size: [240, 120],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    // Deliberately no IMAGE slot: actual execution media, not declared node
    // metadata, must decide whether the preview appears.
    outputs: [],
    properties: {},
    widgets_values: [],
  };
}

describe('NodeCard emitted video output', () => {
  let container: HTMLDivElement;
  let root: Root;
  let node: WorkflowNode;
  const preloadedImages: Array<{ onload: (() => void) | null; src: string }> = [];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    node = makeNode();

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    preloadedImages.length = 0;
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      src = '';
      constructor() {
        preloadedImages.push(this);
      }
    });

    const workflow: Workflow = {
      id: 'node-card-video-test',
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
        ThirdPartyVideoPreview: {
          input: { required: {} },
          output: [],
          output_node: false,
          name: 'ThirdPartyVideoPreview',
          display_name: 'Third-party video preview',
          description: '',
          python_module: 'third_party.preview',
          category: 'test',
        },
      },
      collapsedItems: {},
      hiddenItems: {},
      connectionHighlightModes: {},
      nodeOutputs: {
        '91': [{ filename: 'result.mp4', subfolder: 'clips', type: 'output' }],
      },
      nodeComparerOutputs: {},
      nodeTextOutputs: {},
      latentPreviews: {},
      isExecuting: false,
      executingPromptId: null,
      currentWorkflowKey: null,
    });
    useWorkflowErrorsStore.setState({
      error: null,
      nodeErrors: {},
      errorsDismissed: false,
    });
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

  it('promotes an MP4 immediately without passing it through Image preloading', async () => {
    await act(async () => {
      root.render(<NodeCard node={node} />);
    });

    expect(preloadedImages).toHaveLength(0);
    const video = container.querySelector<HTMLVideoElement>('video[data-workflow-output-video]');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toContain('/mobile/api/video/playable?filename=result.mp4');
    expect(video?.getAttribute('poster')).toContain('/mobile/api/thumbnail?filename=result.mp4');
  });

  it('retains the decoded-image gate for normal image output', async () => {
    useWorkflowStore.setState({
      nodeOutputs: {
        '91': [{ filename: 'result.png', subfolder: 'images', type: 'output' }],
      },
    });
    await act(async () => {
      root.render(<NodeCard node={node} />);
    });

    expect(preloadedImages).toHaveLength(1);
    expect(container.querySelector('img')).toBeNull();
    await act(async () => preloadedImages[0].onload?.());
    expect(container.querySelector('img')?.getAttribute('src')).toContain('filename=result.png');
  });

  it('cache-busts a Deno preview that overwrites the same filename each run', async () => {
    node = { ...node, type: 'DenoVideoPreview' };
    const current = useWorkflowStore.getState().workflow!;
    useWorkflowStore.setState({
      workflow: { ...current, nodes: [node] },
      nodeTypes: {
        ...useWorkflowStore.getState().nodeTypes,
        DenoVideoPreview: {
          input: { required: {} }, output: [], output_node: true,
          name: 'DenoVideoPreview', display_name: '(Deno) Video Preview',
          description: '', python_module: 'comfyui_deno_custom_nodes', category: 'Deno',
        },
      },
      nodeOutputs: {
        '91': [{
          filename: 'deno_preview_91.mp4', subfolder: 'deno_video_preview', type: 'temp',
          cacheToken: 'run:two', width: 640, height: 360, frame_rate: 24,
          frame_count: 48, has_audio: true,
        }],
      },
    });
    await act(async () => root.render(<NodeCard node={node} />));

    const video = container.querySelector<HTMLVideoElement>('video[data-workflow-output-video]');
    expect(video?.getAttribute('src')).toContain('cb=run%3Atwo');
    expect(video?.loop).toBe(true);
    expect(container.textContent).toContain('640×360');
    expect(container.textContent).toContain('48 frames');
    expect(container.textContent).toContain('24 fps');
    expect(container.textContent).toContain('audio');
  });

  it('persists Deno compare preview controls into the workflow widgets', async () => {
    node = {
      ...node,
      type: 'DenoVideoCompare',
      widgets_values: ['Slider', 0.4, 'B', false, 4, false],
    };
    const frames = (side: 'a' | 'b') => Array.from({ length: 4 }, (_, index) => ({
      filename: `${side}_${String(index).padStart(6, '0')}.webp`,
      subfolder: 'deno_vcmp_store',
      type: 'temp',
    }));
    const current = useWorkflowStore.getState().workflow!;
    useWorkflowStore.setState({
      workflow: { ...current, nodes: [node] },
      nodeTypes: {
        ...useWorkflowStore.getState().nodeTypes,
        DenoVideoCompare: {
          input: {
            required: {
              mode: [['Slider', 'Side by Side', 'Difference', 'Toggle'], { default: 'Slider' }],
              split_position: ['FLOAT', { default: 0.5 }],
              toggle_image: [['A', 'B'], { default: 'B' }],
              swap: ['BOOLEAN', { default: false }],
              fps: ['FLOAT', { default: 24 }],
              burn_labels: ['BOOLEAN', { default: false }],
            },
          },
          input_order: {
            required: ['mode', 'split_position', 'toggle_image', 'swap', 'fps', 'burn_labels'],
          },
          output: ['IMAGE'], output_node: true,
          name: 'DenoVideoCompare', display_name: '(Deno) Video Compare',
          description: '', python_module: 'comfyui_deno_custom_nodes', category: 'Deno',
        },
      },
      nodeComparerOutputs: {
        '91': {
          a: frames('a'),
          b: frames('b'),
          video: {
            mode: 'Slider', splitPosition: 0.4, toggleImage: 'B', swapped: false,
            fps: 4, sourceFps: 4, duration: 1, frameCount: 4,
            subfolder: 'deno_vcmp_store', haveA: true, haveB: true,
            aSourceWidth: 640, aSourceHeight: 360, aSourceCount: 4,
            bSourceWidth: 640, bSourceHeight: 360, bSourceCount: 4,
            audioA: null, audioB: null,
          },
        },
      },
      nodeOutputs: {},
    });
    await act(async () => root.render(<NodeCard node={node} />));

    const compare = container.querySelector('[data-deno-video-compare]')!;
    const compareButtons = Array.from(compare.querySelectorAll('button'));
    const split = compare.querySelector<HTMLInputElement>('input[aria-label="Comparison split"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(split, '73');
      split.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => compareButtons.find((button) => button.textContent === 'Difference')!.click());
    await act(async () => compareButtons.find((button) => button.textContent === 'Swap A/B')!.click());
    await act(async () => compareButtons.find((button) => button.textContent === 'Toggle')!.click());
    await act(async () => (
      compare.querySelector('button[aria-label^="Showing video"]') as HTMLButtonElement
    ).click());

    expect(useWorkflowStore.getState().workflow?.nodes[0].widgets_values).toEqual([
      'Toggle', 0.73, 'A', true, 4, false,
    ]);
  });

  it('renders a VHS FFmpeg Path frontend preview without an executed media payload', async () => {
    node = {
      ...node,
      type: 'VHS_LoadVideoFFmpegPath',
      widgets_values: {
        video: '/media/source clip.mp4',
        force_rate: 12,
        start_time: 0.5,
        videopreview: {
          hidden: false,
          paused: false,
          params: { filename: '/media/stale.mp4', type: 'path', format: 'video/mp4' },
        },
      },
    };
    const current = useWorkflowStore.getState().workflow!;
    useWorkflowStore.setState({
      workflow: { ...current, nodes: [node] },
      nodeTypes: {
        ...useWorkflowStore.getState().nodeTypes,
        VHS_LoadVideoFFmpegPath: {
          input: { required: {} }, output: [], output_node: false,
          name: 'VHS_LoadVideoFFmpegPath', display_name: 'Load Video FFmpeg (Path)',
          description: '', python_module: 'videohelpersuite.load_video_nodes', category: 'Video Helper Suite',
        },
      },
      nodeOutputs: {},
    });
    await act(async () => root.render(<NodeCard node={node} />));

    const video = container.querySelector<HTMLVideoElement>('video[data-workflow-output-video]');
    expect(video?.getAttribute('src')).toContain('/vhs/viewvideo?');
    expect(video?.getAttribute('src')).toContain('filename=%2Fmedia%2Fsource+clip.mp4');
    expect(video?.getAttribute('src')).toContain('force_rate=12');
    expect(preloadedImages).toHaveLength(0);
  });

  it('honors a hidden VHS VideoCombine preview even when an executed video exists', async () => {
    node = {
      ...node,
      type: 'VHS_VideoCombine',
      widgets_values: {
        videopreview: {
          hidden: true,
          paused: false,
          params: { filename: 'result.mp4', subfolder: 'clips', type: 'output', format: 'video/mp4' },
        },
      },
    };
    const current = useWorkflowStore.getState().workflow!;
    useWorkflowStore.setState({
      workflow: { ...current, nodes: [node] },
      nodeTypes: {
        ...useWorkflowStore.getState().nodeTypes,
        VHS_VideoCombine: {
          input: { required: {} }, output: [], output_node: true,
          name: 'VHS_VideoCombine', display_name: 'Video Combine',
          description: '', python_module: 'videohelpersuite.nodes', category: 'Video Helper Suite',
        },
      },
      nodeOutputs: {
        '91': [{ filename: 'result.mp4', subfolder: 'clips', type: 'output' }],
      },
    });
    await act(async () => root.render(<NodeCard node={node} />));
    expect(container.querySelector('video')).toBeNull();
    const reveal = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Show video preview')!;
    expect(reveal).toBeDefined();
    await act(async () => reveal.click());
    const revealedNode = useWorkflowStore.getState().workflow!.nodes[0];
    expect((revealedNode.widgets_values as Record<string, { hidden: boolean }>).videopreview.hidden)
      .toBe(false);
    await act(async () => root.render(<NodeCard node={revealedNode} />));
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('reveals a hidden VHS preview in an array-backed workflow widget slot', async () => {
    const hiddenPreview = {
      hidden: true,
      paused: false,
      params: { filename: 'array-result.mp4', subfolder: 'clips', type: 'output' },
    };
    node = {
      ...node,
      type: 'VHS_VideoCombine',
      widgets_values: [8, 'video/h264-mp4', hiddenPreview],
    };
    const current = useWorkflowStore.getState().workflow!;
    useWorkflowStore.setState({
      workflow: {
        ...current,
        nodes: [node],
        widget_idx_map: { '91': { frame_rate: 0, format: 1, videopreview: 2 } },
      },
      nodeTypes: {
        ...useWorkflowStore.getState().nodeTypes,
        VHS_VideoCombine: {
          input: { required: {} }, output: [], output_node: true,
          name: 'VHS_VideoCombine', display_name: 'Video Combine',
          description: '', python_module: 'videohelpersuite.nodes', category: 'Video Helper Suite',
        },
      },
      nodeOutputs: {
        '91': [{ filename: 'array-result.mp4', subfolder: 'clips', type: 'output' }],
      },
    });
    await act(async () => root.render(<NodeCard node={node} />));

    const reveal = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Show video preview')!;
    expect(reveal).toBeDefined();
    await act(async () => reveal.click());

    const revealedNode = useWorkflowStore.getState().workflow!.nodes[0];
    expect(revealedNode.widgets_values).toEqual([
      8,
      'video/h264-mp4',
      { ...hiddenPreview, hidden: false },
    ]);
    await act(async () => root.render(<NodeCard node={revealedNode} />));
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('restores a persisted Video Oasis scene through the mobile playable gateway', async () => {
    node = {
      ...node,
      type: 'VideoOasisPreview',
      widgets_values: {
        video_oasis_ui: JSON.stringify({
          io_id: 'oasis-91',
          uiState: { playMode: 'loop' },
          preview: {
            history: [{ filename: 'restored.webm', subfolder: 'oasis', type: 'temp' }],
            activeIdx: 0,
          },
        }),
      },
    };
    const current = useWorkflowStore.getState().workflow!;
    useWorkflowStore.setState({
      workflow: { ...current, nodes: [node] },
      nodeTypes: {
        ...useWorkflowStore.getState().nodeTypes,
        VideoOasisPreview: {
          input: { required: {} }, output: [], output_node: true,
          name: 'VideoOasisPreview', display_name: 'Video Oasis Preview',
          description: '', python_module: 'ComfyUI-Image-Oasis.preview_node', category: 'Video Oasis',
        },
      },
      nodeOutputs: {},
    });
    await act(async () => root.render(<NodeCard node={node} />));
    expect(container.querySelector('video')?.getAttribute('src'))
      .toContain('/mobile/api/video/playable?filename=restored.webm');
    const mode = container.querySelector<HTMLButtonElement>('button[aria-label="Playback mode: loop"]')!;
    await act(async () => mode.click());
    const saved = JSON.parse(
      (useWorkflowStore.getState().workflow!.nodes[0]
        .widgets_values as Record<string, string>).video_oasis_ui,
    );
    expect(saved.uiState.playMode).toBe('cycle');
  });
});
