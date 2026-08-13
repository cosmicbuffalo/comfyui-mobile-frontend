import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DenoVideoCompare } from '@/components/WorkflowPanel/NodeCard/DenoVideoCompare';
import type { NodeComparerOutput } from '@/hooks/useWorkflow';
import { useImageViewerStore } from '@/hooks/useImageViewer';

function output(): NodeComparerOutput {
  const frames = (side: 'a' | 'b') => Array.from({ length: 4 }, (_, index) => ({
    filename: `${side}_${String(index).padStart(6, '0')}.webp`,
    subfolder: 'deno_vcmp_test',
    type: 'temp',
  }));
  return {
    a: frames('a'),
    b: frames('b'),
    video: {
      mode: 'Slider', splitPosition: 0.4, toggleImage: 'B', swapped: false,
      fps: 4, sourceFps: 4, duration: 1, frameCount: 4,
      subfolder: 'deno_vcmp_test', haveA: true, haveB: true,
      aSourceWidth: 640, aSourceHeight: 360, aSourceCount: 4,
      bSourceWidth: 640, bSourceHeight: 360, bSourceCount: 4,
      audioA: null, audioB: null,
    },
  };
}

function outputWithAudio(subfolder: string, filename: string): NodeComparerOutput {
  const next = output();
  const withSubfolder = (entry: NodeComparerOutput['a'][number]) => ({
    ...entry,
    subfolder,
  });
  return {
    ...next,
    a: next.a.map(withSubfolder),
    b: next.b.map(withSubfolder),
    video: {
      ...next.video!,
      subfolder,
      audioA: {
        filename,
        channels: 1,
        samples: 4,
        sample_rate: 4,
        dtype: 'f32le',
        layout: 'planar',
      },
    },
  };
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('DenoVideoCompare', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useImageViewerStore.getState().setViewerState({ viewerOpen: false });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useImageViewerStore.getState().setViewerState({ viewerOpen: false });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders synchronized frames and exposes every desktop comparison mode', async () => {
    await act(async () => root.render(<DenoVideoCompare output={output()} displayName="Deno compare" />));
    expect(container.querySelector('[data-deno-video-compare]')).not.toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(Array.from(container.querySelectorAll('img')).some((img) => (
      img.getAttribute('src')?.includes('a_000000.webp')
    ))).toBe(true);

    const buttons = Array.from(container.querySelectorAll('button'));
    const difference = buttons.find((button) => button.textContent === '差异')!;
    await act(async () => difference.click());
    expect(difference.getAttribute('aria-pressed')).toBe('true');
    expect((container.querySelectorAll('img')[1] as HTMLElement).style.mixBlendMode).toBe('difference');

    const sideBySide = buttons.find((button) => button.textContent === '并排')!;
    await act(async () => sideBySide.click());
    expect(container.querySelector('.deno-compare-side-by-side')).not.toBeNull();

    const toggle = buttons.find((button) => button.textContent === '切换')!;
    await act(async () => toggle.click());
    const stageButton = container.querySelector('button[aria-label^="正在显示视频"]')! as HTMLButtonElement;
    expect(stageButton.getAttribute('aria-label')).toContain('B');
    await act(async () => stageButton.click());
    expect(container.querySelector('button[aria-label^="正在显示视频"]')?.getAttribute('aria-label'))
      .toContain('A');
  });

  it('supports timeline scrubbing, frame stepping, speed, loop, and transport controls', async () => {
    await act(async () => root.render(<DenoVideoCompare output={output()} displayName="Deno compare" />));
    const timeline = container.querySelector<HTMLInputElement>('input[aria-label="视频对比时间轴"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(timeline, '0.75');
      timeline.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(Array.from(container.querySelectorAll('img')).some((img) => (
      img.getAttribute('src')?.includes('_000003.webp')
    ))).toBe(true);

    const pause = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === '暂停')!;
    await act(async () => pause.click());
    expect(container.textContent).toContain('播放');
    expect(container.querySelector('select[aria-label="播放速度"]')).not.toBeNull();
    expect(container.textContent).toContain('4 帧');
    expect(container.textContent).toContain('640×360');
  });

  it('reports mode, split, swap, and toggle changes using Deno widget names', async () => {
    const onWidgetChange = vi.fn();
    await act(async () => root.render(
      <DenoVideoCompare
        output={output()}
        displayName="Deno compare"
        onWidgetChange={onWidgetChange}
      />,
    ));

    const compare = container.querySelector('[data-deno-video-compare]')!;
    const buttons = Array.from(compare.querySelectorAll('button'));
    const split = compare.querySelector<HTMLInputElement>('input[aria-label="对比分割位置"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(split, '73');
      split.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => buttons.find((button) => button.textContent === '差异')!.click());

    await act(async () => buttons.find((button) => button.textContent === '交换 A/B')!.click());
    await act(async () => buttons.find((button) => button.textContent === '切换')!.click());
    await act(async () => (
      compare.querySelector('button[aria-label^="正在显示视频"]') as HTMLButtonElement
    ).click());

    expect(onWidgetChange.mock.calls).toEqual([
      ['split_position', 0.73],
      ['mode', 'Difference'],
      ['swap', true],
      ['mode', 'Toggle'],
      ['toggle_image', 'A'],
    ]);
  });

  it('invalidates a pending audio fetch when execution output is replaced', async () => {
    const starts: Array<[number, number]> = [];
    const createBuffer = vi.fn(() => ({
      duration: 1,
      copyToChannel: vi.fn(),
    }));
    const createBufferSource = vi.fn(() => ({
      buffer: null,
      playbackRate: { value: 1 },
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      stop: vi.fn(),
      start: vi.fn((when: number, offset: number) => starts.push([when, offset])),
    }));
    class FakeAudioContext {
      destination = {};
      createBuffer = createBuffer;
      createBufferSource = createBufferSource;
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    type PendingFetch = {
      url: string;
      signal: AbortSignal | undefined;
      resolve: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    };
    const pending: PendingFetch[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (
      new Promise((resolve) => pending.push({
        url,
        signal: init?.signal ?? undefined,
        resolve,
      }))
    )));

    await act(async () => root.render(
      <DenoVideoCompare
        output={outputWithAudio('deno_vcmp_old', 'old_audio.f32')}
        displayName="Deno compare"
      />,
    ));
    const audioSelect = container.querySelector<HTMLSelectElement>('select[aria-label="对比音频"]')!;
    await act(async () => setSelectValue(audioSelect, 'A'));
    expect(pending).toHaveLength(1);
    expect(pending[0].url).toContain('old_audio.f32');

    await act(async () => root.render(
      <DenoVideoCompare
        output={outputWithAudio('deno_vcmp_new', 'new_audio.f32')}
        displayName="Deno compare"
      />,
    ));
    expect(pending).toHaveLength(2);
    expect(pending[0].signal?.aborted).toBe(true);
    expect(pending[1].url).toContain('new_audio.f32');

    const staleArrayBuffer = vi.fn().mockResolvedValue(
      new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer,
    );
    await act(async () => {
      pending[0].resolve({ ok: true, arrayBuffer: staleArrayBuffer });
      await Promise.resolve();
    });
    expect(staleArrayBuffer).not.toHaveBeenCalled();
    expect(createBuffer).not.toHaveBeenCalled();
    expect(starts).toEqual([]);

    await act(async () => {
      pending[1].resolve({
        ok: true,
        arrayBuffer: async () => new Float32Array([0.5, 0.6, 0.7, 0.8]).buffer,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createBuffer).toHaveBeenCalledTimes(1);
    expect(createBufferSource).toHaveBeenCalledTimes(1);
    expect(starts).toHaveLength(1);
  });

  it('cannot revive a pending audio load after the user mutes it', async () => {
    const start = vi.fn();
    class FakeAudioContext {
      destination = {};
      createBuffer = vi.fn(() => ({ duration: 1, copyToChannel: vi.fn() }));
      createBufferSource = vi.fn(() => ({
        buffer: null,
        playbackRate: { value: 1 },
        loop: false,
        connect: vi.fn(), disconnect: vi.fn(), stop: vi.fn(), start,
      }));
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    let resolveFetch!: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));

    await act(async () => root.render(
      <DenoVideoCompare output={outputWithAudio('deno_vcmp_muted', 'audio.f32')} displayName="Deno compare" />,
    ));
    const audioSelect = container.querySelector<HTMLSelectElement>('select[aria-label="对比音频"]')!;
    await act(async () => setSelectValue(audioSelect, 'A'));
    await act(async () => setSelectValue(audioSelect, 'off'));
    await act(async () => {
      resolveFetch({
        ok: true,
        arrayBuffer: async () => new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(start).not.toHaveBeenCalled();
  });
});
