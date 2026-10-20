import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileItem } from '@/api/client';

const renderModelThumbnail = vi.fn();
vi.mock('@/components/ThreeView/renderModelThumbnail', () => ({ renderModelThumbnail }));

let observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
beforeEach(() => {
  vi.resetModules();
  localStorage.removeItem('generation-settings-storage');
  renderModelThumbnail.mockReset();
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(callback); }
    observe() {}
    disconnect() {}
  });
  let next = 0;
  URL.createObjectURL = () => `blob:thumb-${++next}`;
  URL.revokeObjectURL = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const model = (overrides: Partial<FileItem> = {}): FileItem => ({
  id: 'output/mesh.glb', name: 'mesh.glb', type: 'model', fullUrl: '/view?filename=mesh.glb', size: 1024, cacheToken: 't1', ...overrides,
});

async function mountCard(file: FileItem) {
  const { useModelThumbnail, setModelThumbnailsActive } = await import('../modelThumbnails');
  const seen: Array<string | null> = [];
  function Card() {
    const ref = useRef<HTMLDivElement>(null);
    seen.push(useModelThumbnail(file, ref));
    return <div ref={ref} />;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const watched = observers.length;
  await act(async () => root.render(<Card />));
  const settle = (check: () => void) => vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    check();
  });
  await settle(() => expect(observers.length).toBe(watched + 1));
  const observe = observers[watched];
  const onScreen = (isIntersecting = true) => act(async () => observe([{ isIntersecting }]));
  return { seen, root, settle, onScreen, setModelThumbnailsActive };
}

it('renders an on-screen 3D file once Outputs is active and shows the result', async () => {
  renderModelThumbnail.mockResolvedValue(new Blob(['png']));
  const { seen, root, settle, setModelThumbnailsActive } = await mountCard(model());
  expect(seen.at(-1)).toBeNull();
  await act(async () => observers.forEach(observe => observe([{ isIntersecting: true }])));
  expect(renderModelThumbnail).not.toHaveBeenCalled();
  setModelThumbnailsActive(true);
  await settle(() => expect(seen.at(-1)).toBe('blob:thumb-1'));
  expect(renderModelThumbnail).toHaveBeenCalledOnce();
  setModelThumbnailsActive(false);
  act(() => root.unmount());
});

it('leaves oversized files to the viewer and does not retry a failed render', async () => {
  const big = await mountCard(model({ id: 'output/big.glb', size: 50 * 1024 * 1024 }));
  big.setModelThumbnailsActive(true);
  await big.onScreen();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(renderModelThumbnail).not.toHaveBeenCalled();
  act(() => big.root.unmount());

  renderModelThumbnail.mockRejectedValue(new Error('bad file'));
  const broken = await mountCard(model({ id: 'output/broken.glb' }));
  await act(async () => observers.forEach(observe => observe([{ isIntersecting: true }])));
  await broken.settle(() => expect(renderModelThumbnail).toHaveBeenCalledOnce());
  await act(async () => observers.forEach(observe => observe([{ isIntersecting: true }])));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(renderModelThumbnail).toHaveBeenCalledOnce();
  expect(broken.seen.at(-1)).toBeNull();
  broken.setModelThumbnailsActive(false);
  act(() => broken.root.unmount());
});

it('renders a replaced file again and never caches a snapshot without the file identity', async () => {
  renderModelThumbnail.mockResolvedValue(new Blob(['new']));
  const { saveModelThumbnail, hasModelThumbnail } = await import('../modelThumbnails');
  // A queue or node viewer item has no listing token: its snapshot isn't kept.
  saveModelThumbnail({ id: 'output/mesh.glb' }, new Blob(['viewer']));
  expect(hasModelThumbnail({ id: 'output/mesh.glb', cacheToken: 't1' })).toBe(false);
  saveModelThumbnail({ id: 'output/mesh.glb', cacheToken: 't1' }, new Blob(['old']));
  expect(hasModelThumbnail({ id: 'output/mesh.glb', cacheToken: 't1' })).toBe(true);
  // Same path, new file: the old picture no longer applies.
  const card = await mountCard(model({ cacheToken: 't2' }));
  expect(card.seen.at(-1)).toBeNull();
  card.setModelThumbnailsActive(true);
  await act(async () => observers.forEach(observe => observe([{ isIntersecting: true }])));
  await card.settle(() => expect(renderModelThumbnail).toHaveBeenCalledOnce());
  await card.settle(() => expect(card.seen.at(-1)).toMatch(/^blob:thumb-/));
  card.setModelThumbnailsActive(false);
  act(() => card.root.unmount());
});

it('waits for a hidden page before rendering in the background', async () => {
  renderModelThumbnail.mockResolvedValue(new Blob(['png']));
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const card = await mountCard(model({ id: 'output/later.glb' }));
  card.setModelThumbnailsActive(true);
  await act(async () => observers.forEach(observe => observe([{ isIntersecting: true }])));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(renderModelThumbnail).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  await card.settle(() => expect(renderModelThumbnail).toHaveBeenCalledOnce());
  card.setModelThumbnailsActive(false);
  hidden.mockRestore();
  act(() => card.root.unmount());
});

it('forgets a deleted file and keeps only on-screen thumbnails beyond the memory cap', async () => {
  const revoked: string[] = [];
  URL.revokeObjectURL = url => { revoked.push(url); };
  const { saveModelThumbnail, hasModelThumbnail, forgetModelThumbnails } = await import('../modelThumbnails');
  const card = await mountCard(model({ id: 'output/kept.glb' }));
  await card.onScreen();
  saveModelThumbnail({ id: 'output/kept.glb', cacheToken: 't1' }, new Blob(['kept']));
  for (let index = 0; index < 200; index++) saveModelThumbnail({ id: `output/${index}.glb`, cacheToken: 't1' }, new Blob([String(index)]));
  expect(hasModelThumbnail({ id: 'output/kept.glb', cacheToken: 't1' })).toBe(true);
  expect(hasModelThumbnail({ id: 'output/0.glb', cacheToken: 't1' })).toBe(false);
  expect(hasModelThumbnail({ id: 'output/199.glb', cacheToken: 't1' })).toBe(true);
  expect(revoked).toHaveLength(51);

  forgetModelThumbnails(['output/kept.glb']);
  expect(hasModelThumbnail({ id: 'output/kept.glb', cacheToken: 't1' })).toBe(false);
  expect(revoked).toHaveLength(52);
  act(() => card.root.unmount());
});

it('renders a replacement version after the previous one failed', async () => {
  renderModelThumbnail.mockRejectedValueOnce(new Error('temporary 404')).mockResolvedValue(new Blob(['fixed']));
  const old = await mountCard(model());
  old.setModelThumbnailsActive(true);
  await old.onScreen();
  await old.settle(() => expect(renderModelThumbnail).toHaveBeenCalledOnce());
  act(() => old.root.unmount());

  const next = await mountCard(model({ cacheToken: 't2' }));
  await next.onScreen();
  await next.settle(() => expect(next.seen.at(-1)).toMatch(/^blob:thumb-/));
  expect(renderModelThumbnail).toHaveBeenCalledTimes(2);
  next.setModelThumbnailsActive(false);
  act(() => next.root.unmount());
});

it('releases mounted cards that are off screen once a long gallery passes the memory cap', async () => {
  const revoked: string[] = [];
  URL.revokeObjectURL = url => { revoked.push(url); };
  const { saveModelThumbnail } = await import('../modelThumbnails');
  // Outputs keeps earlier cards mounted as its render window grows.
  const cards: Awaited<ReturnType<typeof mountCard>>[] = [];
  for (let index = 0; index < 160; index++) {
    const card = await mountCard(model({ id: `output/${index}.glb` }));
    act(() => saveModelThumbnail({ id: `output/${index}.glb`, cacheToken: 't1' }, new Blob([String(index)])));
    cards.push(card);
  }
  expect(revoked).toHaveLength(10);
  // An evicted card falls back to its placeholder instead of a revoked URL.
  expect(cards[0].seen.at(-1)).toBeNull();
  expect(cards[159].seen.at(-1)).toMatch(/^blob:thumb-/);
  act(() => cards.forEach(card => card.root.unmount()));
});

it('skips automatic 3D thumbnails in low resource mode and resumes when disabled', async () => {
  renderModelThumbnail.mockResolvedValue(new Blob(['png']));
  const card = await mountCard(model());
  const { useGenerationSettingsStore: settings } = await import('@/hooks/useGenerationSettings');
  await card.onScreen();
  await act(async () => settings.getState().setLowResourceMode(true));
  card.setModelThumbnailsActive(true);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(renderModelThumbnail).not.toHaveBeenCalled();
  expect(card.seen.at(-1)).toBeNull();
  await act(async () => settings.getState().setLowResourceMode(false));
  card.setModelThumbnailsActive(true);
  await act(async () => observers.at(-1)!([{ isIntersecting: true }]));
  await card.settle(() => expect(card.seen.at(-1)).toMatch(/^blob:thumb-/));
  expect(renderModelThumbnail).toHaveBeenCalledOnce();
  card.setModelThumbnailsActive(false);
  act(() => card.root.unmount());
});

it('cancels an in-flight render on preset activation without poisoning retries', async () => {
  let signal: AbortSignal | undefined;
  renderModelThumbnail.mockImplementationOnce((_src, _name, _timeout, nextSignal: AbortSignal) => {
    signal = nextSignal;
    return new Promise((_resolve, reject) => nextSignal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
  }).mockResolvedValue(new Blob(['retry']));
  const card = await mountCard(model());
  const { useGenerationSettingsStore: settings } = await import('@/hooks/useGenerationSettings');
  card.setModelThumbnailsActive(true);
  await card.onScreen();
  await card.settle(() => expect(renderModelThumbnail).toHaveBeenCalledOnce());
  await act(async () => settings.getState().setLowResourceMode(true));
  expect(signal?.aborted).toBe(true);
  expect(card.seen.at(-1)).toBeNull();
  await act(async () => settings.getState().setLowResourceMode(false));
  card.setModelThumbnailsActive(true);
  await act(async () => observers.at(-1)!([{ isIntersecting: true }]));
  await card.settle(() => expect(card.seen.at(-1)).toMatch(/^blob:thumb-/));
  expect(renderModelThumbnail).toHaveBeenCalledTimes(2);
  card.setModelThumbnailsActive(false);
  act(() => card.root.unmount());
});
