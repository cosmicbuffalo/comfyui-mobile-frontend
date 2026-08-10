import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import {
  appendOasisPreviewResults,
  ensureOasisPreviewIoIds,
  findOasisPreviewTargets,
  getRevealFrontendPreviewUpdate,
  resolveNodeFrontendMediaPreview,
} from '@/utils/nodeFrontendPreviews';

function node(type: string, widgets_values: WorkflowNode['widgets_values']): WorkflowNode {
  return {
    id: 7,
    itemKey: 'root/node:7',
    type,
    pos: [0, 0],
    size: [320, 240],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values,
  };
}

function workflow(current: WorkflowNode): Workflow {
  return {
    nodes: [current],
    links: [],
    groups: [],
    config: {},
    version: 1,
    last_node_id: current.id,
    last_link_id: 0,
  };
}

describe('resolveNodeFrontendMediaPreview', () => {
  it.each([
    ['VHS_LoadVideo', 'input', 'clip.mp4', 'video/mp4'],
    ['VHS_LoadVideoFFmpeg', 'input', 'clip.mov', 'video/mov'],
    ['VHS_LoadVideoPath', 'path', '/media/clip.mkv', 'video/mkv'],
    ['VHS_LoadVideoFFmpegPath', 'path', '/media/clip.mp4', 'video/mp4'],
  ])('mirrors the %s desktop input preview', (type, sourceType, filename, format) => {
    const current = node(type, {
      video: filename,
      force_rate: 12,
      start_time: 1.5,
      videopreview: {
        hidden: false,
        paused: false,
        params: { filename: 'stale.mp4', type: sourceType, format },
      },
    });
    const preview = resolveNodeFrontendMediaPreview(workflow(current), null, current);
    expect(preview).toMatchObject({ mediaType: 'video', source: 'vhs-widget', loop: true });
    const url = new URL(preview!.src, 'http://localhost');
    expect(url.pathname).toBe('/vhs/viewvideo');
    expect(url.searchParams.get('filename')).toBe(filename);
    expect(url.searchParams.get('type')).toBe(sourceType);
    expect(url.searchParams.get('format')).toBe(format);
    expect(url.searchParams.get('force_rate')).toBe('12');
    expect(url.searchParams.get('start_time')).toBe('1.5');
    expect(url.searchParams.get('force_size')).toBe('600x?');
    expect(url.searchParams.get('deadline')).toBe('realtime');
  });

  it.each([
    ['VHS_LoadImages', 'input', 'frames/uploaded'],
    ['VHS_LoadImagesPath', 'path', '/media/frames'],
  ])('renders %s image sequences through VHS as animated video', (type, sourceType, directory) => {
    const current = node(type, {
      directory,
      image_load_cap: 20,
      videopreview: { hidden: false, paused: true, params: {} },
    });
    const preview = resolveNodeFrontendMediaPreview(workflow(current), null, current)!;
    const url = new URL(preview.src, 'http://localhost');
    expect(url.pathname).toBe('/vhs/viewvideo');
    expect(url.searchParams.get('format')).toBe('folder');
    expect(url.searchParams.get('type')).toBe(sourceType);
    expect(url.searchParams.get('image_load_cap')).toBe('20');
    expect(preview.autoPlay).toBe(false);
  });

  it('supports VHS LoadImagePath and persisted VideoCombine previews', () => {
    const pathNode = node('VHS_LoadImagePath', {
      image: '/media/animated.webp',
      videopreview: { hidden: false, paused: false, params: {} },
    });
    const pathPreview = resolveNodeFrontendMediaPreview(workflow(pathNode), null, pathNode)!;
    expect(pathPreview.src).toContain('/vhs/viewvideo?');
    expect(new URL(pathPreview.src, 'http://localhost').searchParams.get('format'))
      .toBe('video/webp');

    const combine = node('VHS_VideoCombine', {
      videopreview: {
        hidden: false,
        paused: true,
        params: {
          filename: 'combined.mp4',
          subfolder: 'video',
          type: 'output',
          format: 'video/h264-mp4',
        },
      },
    });
    const restored = resolveNodeFrontendMediaPreview(workflow(combine), null, combine)!;
    expect(restored.src).toContain('/mobile/api/video/playable?filename=combined.mp4');
    expect(restored.poster).toContain('/mobile/api/thumbnail?filename=combined.mp4');
    expect(restored.autoPlay).toBe(false);
  });

  it('honors the VHS hidden-preview state', () => {
    const current = node('VHS_LoadVideoFFmpegPath', {
      video: '/media/clip.mp4',
      videopreview: { hidden: true, params: { filename: '/media/clip.mp4' } },
    });
    expect(resolveNodeFrontendMediaPreview(workflow(current), null, current)).toBeNull();
    expect(getRevealFrontendPreviewUpdate(workflow(current), null, current)).toEqual({
      widgetName: 'videopreview',
      value: { hidden: false, params: { filename: '/media/clip.mp4' } },
    });
  });

  it('recomputes stale loader formats and preserves VHS animated-input behavior', () => {
    const changedToVideo = node('VHS_LoadVideo', {
      video: 'fresh.mp4',
      videopreview: { params: { filename: 'old.gif', type: 'input', format: 'image/gif' } },
    });
    const changedUrl = new URL(
      resolveNodeFrontendMediaPreview(workflow(changedToVideo), null, changedToVideo)!.src,
      'http://localhost',
    );
    expect(changedUrl.pathname).toBe('/vhs/viewvideo');
    expect(changedUrl.searchParams.get('format')).toBe('video/mp4');

    const gif = node('VHS_LoadVideoFFmpeg', {
      video: 'animated.gif', force_rate: 6,
      videopreview: { paused: false, params: {} },
    });
    const gifPreview = resolveNodeFrontendMediaPreview(workflow(gif), null, gif)!;
    expect(gifPreview.mediaType).toBe('video');
    expect(new URL(gifPreview.src, 'http://localhost').pathname).toBe('/vhs/viewvideo');

    for (const extension of ['webp', 'avif']) {
      const image = node('VHS_LoadVideo', {
        video: `animated.${extension}`,
        videopreview: { params: {} },
      });
      const imagePreview = resolveNodeFrontendMediaPreview(workflow(image), null, image)!;
      expect(imagePreview.mediaType).toBe('image');
      expect(new URL(imagePreview.src, 'http://localhost').pathname).toBe('/view');
    }
  });

  it('preserves VHS custom dimensions in the node-sized advanced preview', () => {
    const current = node('VHS_LoadVideoFFmpegPath', {
      video: '/media/portrait.mp4', custom_width: 400, custom_height: 800,
      frame_load_cap: 12, skip_first_frames: 2, select_every_nth: 3,
      videopreview: { params: {} },
    });
    const url = new URL(
      resolveNodeFrontendMediaPreview(workflow(current), null, current)!.src,
      'http://localhost',
    );
    expect(url.searchParams.get('force_size')).toBe('600x1200');
    expect(url.searchParams.get('frame_load_cap')).toBe('12');
    expect(url.searchParams.get('skip_first_frames')).toBe('2');
    expect(url.searchParams.get('select_every_nth')).toBe('3');
  });

  it('restores the active Oasis scene passively with its playback preferences', () => {
    const current = node('VideoOasisPreview', {
      video_oasis_ui: JSON.stringify({
        io_id: 'oasis-7',
        uiState: { playMode: 'loop', speed: 1.5 },
        preview: {
          activeIdx: 1,
          history: [
            { filename: 'old.mp4', subfolder: '', type: 'temp' },
            { filename: 'active.webm', subfolder: 'oasis', type: 'temp' },
          ],
        },
      }),
    });
    expect(resolveNodeFrontendMediaPreview(workflow(current), null, current)).toMatchObject({
      source: 'oasis-widget',
      autoPlay: false,
      loop: true,
      playbackRate: 1.5,
    });
    expect(resolveNodeFrontendMediaPreview(workflow(current), null, current)?.src)
      .toContain('filename=active.webm');
  });

  it.each([
    ['off', false],
    ['loop', true],
    ['cycle', false],
  ] as const)('preserves Oasis %s playback semantics', (playMode, loop) => {
    const current = node('VideoOasisPreview', {
      video_oasis_ui: JSON.stringify({
        io_id: 'oasis-modes',
        uiState: { playMode },
        preview: {
          history: [{ filename: 'clip.mp4', subfolder: '', type: 'temp' }],
          activeIdx: 0,
        },
      }),
    });
    expect(resolveNodeFrontendMediaPreview(workflow(current), null, current))
      .toMatchObject({ playMode, loop });
  });

  it('previews the built-in LoadVideo input through the mobile playable gateway', () => {
    const current = node('LoadVideo', ['input/stock clip.mp4']);
    current.inputs = [{ name: 'file', type: 'COMBO', link: null, widget: { name: 'file' } }];
    const nodeTypes = {
      LoadVideo: {
        input: { required: { file: [['input/stock clip.mp4'], {}] } },
        output: ['VIDEO'],
        output_node: false,
        name: 'LoadVideo',
        display_name: 'Load Video',
        description: '',
        python_module: 'comfy_extras.nodes_video',
        category: 'video',
      },
    } as unknown as NodeTypes;
    expect(resolveNodeFrontendMediaPreview(workflow(current), nodeTypes, current)?.src)
      .toContain('/mobile/api/video/playable?filename=stock%20clip.mp4&subfolder=input');
  });
});

describe('Oasis io_id protocol', () => {
  it('mints and persists stable routing IDs for both Oasis preview nodes', () => {
    const first = node('VideoOasisPreview', { video_oasis_ui: '{}' });
    const second = { ...node('LTX23Oasis', { ltx23_oasis_ui: '{}' }), id: 8, itemKey: 'root/node:8' };
    const source = { ...workflow(first), nodes: [first, second] };
    let next = 0;
    const patched = ensureOasisPreviewIoIds(source, null, () => `mobile-${++next}`);
    expect(patched).not.toBe(source);
    expect(JSON.parse((patched.nodes[0].widgets_values as Record<string, string>).video_oasis_ui).io_id)
      .toBe('mobile-1');
    expect(JSON.parse((patched.nodes[1].widgets_values as Record<string, string>).ltx23_oasis_ui).io_id)
      .toBe('mobile-2');
    expect(ensureOasisPreviewIoIds(patched, null, () => 'should-not-change')).toBe(patched);
  });

  it('finds the exact node that owns an incoming Oasis result', () => {
    const current = node('VideoOasisPreview', {
      video_oasis_ui: JSON.stringify({ io_id: 'target-id' }),
    });
    expect(findOasisPreviewTargets(workflow(current), null, 'target-id')).toEqual([
      { node: current, itemKey: 'root/node:7' },
    ]);
    expect(findOasisPreviewTargets(workflow(current), null, 'other')).toEqual([]);
  });

  it('remints a pasted duplicate io_id instead of routing one result twice', () => {
    const first = node('VideoOasisPreview', {
      video_oasis_ui: JSON.stringify({ io_id: 'duplicated' }),
    });
    const second = {
      ...node('VideoOasisPreview', {
        video_oasis_ui: JSON.stringify({ io_id: 'duplicated' }),
      }),
      id: 8,
      itemKey: 'root/node:8',
    };
    const source = { ...workflow(first), nodes: [first, second] };
    const repaired = ensureOasisPreviewIoIds(source, null, () => 'replacement');
    const ids = repaired.nodes.map((entry) => JSON.parse(
      (entry.widgets_values as Record<string, string>).video_oasis_ui,
    ).io_id);
    expect(ids).toEqual(['duplicated', 'replacement']);
    expect(new Set(ids).size).toBe(2);
    expect(findOasisPreviewTargets(source, null, 'duplicated')).toHaveLength(1);

    const crossSession = ensureOasisPreviewIoIds(
      workflow(first),
      null,
      () => 'session-safe',
      ['duplicated'],
    );
    expect(JSON.parse(
      (crossSession.nodes[0].widgets_values as Record<string, string>).video_oasis_ui,
    ).io_id).toBe('session-safe');
  });

  it('appends live results to the serialized scene bar for save and reload', () => {
    const current = node('VideoOasisPreview', {
      video_oasis_ui: JSON.stringify({
        io_id: 'oasis-history',
        uiState: { playMode: 'cycle' },
        preview: {
          history: [{ filename: 'first.mp4', subfolder: '', type: 'temp' }],
          activeIdx: 0,
        },
      }),
    });
    const appended = appendOasisPreviewResults(
      workflow(current),
      null,
      'oasis-history',
      [
        { filename: 'second.mp4', subfolder: '', type: 'temp' },
        { filename: 'third.mp4', subfolder: '', type: 'temp' },
      ],
    );
    const saved = JSON.parse(
      (appended.workflow.nodes[0].widgets_values as Record<string, string>).video_oasis_ui,
    );
    expect(saved.preview.history.map((entry: { filename: string }) => entry.filename))
      .toEqual(['first.mp4', 'second.mp4', 'third.mp4']);
    expect(saved.preview.activeIdx).toBe(2);
    expect(resolveNodeFrontendMediaPreview(
      appended.workflow,
      null,
      appended.workflow.nodes[0],
    )).toMatchObject({ activeIndex: 2, playMode: 'cycle' });
  });
});
