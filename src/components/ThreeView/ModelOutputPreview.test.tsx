import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import { ModelOutputPreview } from './ModelOutputPreview';

vi.mock('./ModelViewer', () => ({ default: () => <canvas data-test-viewer /> }));

beforeEach(() => {
  useGenerationSettingsStore.setState(useGenerationSettingsStore.getInitialState());
  vi.stubGlobal('IntersectionObserver', class {
    private callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) { this.callback = callback; }
    observe() { this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
});
afterEach(() => {
  useGenerationSettingsStore.setState(useGenerationSettingsStore.getInitialState());
  vi.unstubAllGlobals();
});

it('leaves inline 3D models for Expand in low resource mode and releases an existing preview', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const expand = vi.fn();
  const ready = vi.fn();
  useGenerationSettingsStore.getState().setLowResourceMode(true);
  try {
    await act(async () => root.render(<ModelOutputPreview output={{ filename: 'mesh.glb', subfolder: '', type: 'output' }} onExpand={expand} onReady={ready} />));
    expect(container.querySelector('canvas')).toBeNull();
    expect(ready).toHaveBeenCalledOnce();
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Expand');
    act(() => button!.click());
    expect(expand).toHaveBeenCalledOnce();
    await act(async () => useGenerationSettingsStore.getState().setLowResourceMode(false));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(container.querySelector('canvas')).not.toBeNull();
    });
    await act(async () => useGenerationSettingsStore.getState().setLowResourceMode(true));
    expect(container.querySelector('canvas')).toBeNull();
  } finally {
    act(() => root.unmount());
  }
});
