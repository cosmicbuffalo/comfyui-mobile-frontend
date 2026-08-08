import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueueStore } from '@/hooks/useQueue';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, getQueue: vi.fn(async () => ({ queue_running: [], queue_pending: [] })) };
});

beforeEach(() => {
  useQueueStore.setState({
    queueItemExpanded: {},
    queueItemUserToggled: {},
    queueItemHideImages: {},
    previewVisibility: {},
  });
});

describe('pruneQueueItemUiState', () => {
  it('prunes all four persisted per-prompt maps, not just two', () => {
    useQueueStore.setState({
      queueItemExpanded: { keep: true, gone: true },
      queueItemUserToggled: { keep: true, gone: true },
      queueItemHideImages: { keep: true, gone: true },
      previewVisibility: { keep: true, gone: true },
    });

    useQueueStore.getState().pruneQueueItemUiState(['keep']);

    const s = useQueueStore.getState();
    expect(Object.keys(s.queueItemExpanded)).toEqual(['keep']);
    expect(Object.keys(s.queueItemUserToggled)).toEqual(['keep']);
    expect(Object.keys(s.queueItemHideImages)).toEqual(['keep']);
    expect(Object.keys(s.previewVisibility)).toEqual(['keep']);
  });

});

const MAX = 500;

describe('per-card UI state growth', () => {
  it('caps each map on write, without waiting for a full history load', () => {
    // Pruning unknown ids only runs once the FULL history is loaded, which for
    // anyone past one page effectively never happens — so the cap on the write
    // path is what actually keeps the persisted blob from growing per
    // generation, and it has to hold on its own.
    const { setQueueItemExpanded, setPreviewVisibility } = useQueueStore.getState();
    for (let i = 0; i < MAX + 50; i += 1) {
      setQueueItemExpanded(`prompt-${i}`, true);
      setPreviewVisibility(`prompt-${i}`, true);
    }

    const { queueItemExpanded, previewVisibility } = useQueueStore.getState();
    expect(Object.keys(queueItemExpanded)).toHaveLength(MAX);
    expect(Object.keys(previewVisibility)).toHaveLength(MAX);
    expect(queueItemExpanded['prompt-0']).toBeUndefined();
    expect(queueItemExpanded[`prompt-${MAX + 49}`]).toBe(true);
  });

  it('trims an oversized map rehydrated from an older build on the next write', () => {
    useQueueStore.setState({
      queueItemExpanded: Object.fromEntries(
        Array.from({ length: 900 }, (_, i) => [`prompt-${i}`, true]),
      ),
    });

    useQueueStore.getState().setQueueItemExpanded('fresh', true);

    const kept = Object.keys(useQueueStore.getState().queueItemExpanded);
    expect(kept).toHaveLength(MAX);
    expect(kept).toContain('fresh');
    expect(kept).not.toContain('prompt-0');
  });

  it('evicts by write recency, not by when the key first appeared', () => {
    // A plain spread leaves an existing key in its original slot, so re-writing
    // it would not protect it — the card the user keeps toggling would be the
    // first thing evicted.
    const { setQueueItemExpanded } = useQueueStore.getState();
    setQueueItemExpanded('sticky', true);
    for (let i = 0; i < MAX - 1; i += 1) setQueueItemExpanded(`filler-${i}`, true);

    setQueueItemExpanded('sticky', false); // touched again, now the newest
    for (let i = 0; i < 10; i += 1) setQueueItemExpanded(`late-${i}`, true);

    const { queueItemExpanded } = useQueueStore.getState();
    expect(Object.keys(queueItemExpanded)).toHaveLength(MAX);
    expect(queueItemExpanded.sticky).toBe(false);
    expect(queueItemExpanded['filler-0']).toBeUndefined();
  });
});
