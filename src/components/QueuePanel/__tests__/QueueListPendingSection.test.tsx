import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedItem } from '../types';

const mocks = vi.hoisted(() => ({
  queueState: { queueOutputLayout: 'tabbed' as string },
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (s: typeof mocks.queueState) => unknown) => selector(mocks.queueState),
}));
// The section header is the unit under test; a stub card keeps the store/media
// machinery of a real QueueCard out of it.
vi.mock('../QueueCard', () => ({
  QueueCard: ({ item }: { item: UnifiedItem }) => (
    <div data-testid="stub-card" data-card-status={item.status}>{item.id}</div>
  ),
}));

import { QueueList } from '../QueueList';

function pendingItem(id: string, number: number): UnifiedItem {
  return {
    id,
    status: 'pending',
    data: { number, prompt_id: id, prompt: {}, extra: {}, outputs_to_execute: [] },
  };
}

const doneItem: UnifiedItem = {
  id: 'done-1',
  status: 'done',
  timestamp: 1,
  data: {
    prompt_id: 'done-1',
    timestamp: 1,
    outputs: { images: [] },
    prompt: {},
    success: true,
  } as never,
};

describe('QueueList pending section', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = (props: {
    items: UnifiedItem[];
    pendingCount: number;
    pendingCollapsed: boolean;
    onToggle?: () => void;
  }) =>
    act(async () => {
      root.render(
        <QueueList
          listRef={createRef<HTMLDivElement>()}
          unifiedList={props.items}
          visibleCount={props.items.length}
          pendingCount={props.pendingCount}
          pendingCollapsed={props.pendingCollapsed}
          onTogglePendingCollapsed={props.onToggle ?? (() => {})}
          hasLoadedOnce
          effectiveExecutingId={null}
          progress={0}
          viewerImages={[]}
          promptOutputs={{}}
          onOpenMenu={() => {}}
          firstDoneItemId="done-1"
          queueVideoPlaybackEnabled={false}
          activeQueueVideoOwnerId={null}
          onRequestQueueVideoPlayback={() => {}}
          onRequestAutoQueueVideoPlayback={() => {}}
          onReleaseQueueVideoPlayback={() => {}}
          onScroll={() => {}}
        />,
      );
      await Promise.resolve();
    });

  const header = () => container.querySelector<HTMLButtonElement>('.queue-pending-section-header');

  it('labels the header with the full pending count', async () => {
    await render({
      items: [pendingItem('p1', 3), pendingItem('p2', 2), doneItem],
      pendingCount: 2,
      pendingCollapsed: false,
    });

    expect(header()?.textContent).toContain('2 Pending');
    expect(container.querySelectorAll('[data-testid="stub-card"]').length).toBe(3);
  });

  it('counts pending items that are not rendered while the section is folded', async () => {
    // The header count comes from the queue, not the rendered slice: folding
    // must not make it read "0 Pending".
    await render({
      items: [doneItem],
      pendingCount: 12,
      pendingCollapsed: true,
    });

    expect(header()?.textContent).toContain('12 Pending');
    expect(header()?.getAttribute('aria-expanded')).toBe('false');
    const cards = container.querySelectorAll('[data-testid="stub-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].getAttribute('data-card-status')).toBe('done');
  });

  it('keeps the header reachable when every remaining item is folded away', async () => {
    // Nothing but pending in the queue, all folded — without this the empty
    // state would take over and there would be no way to unfold.
    await render({ items: [], pendingCount: 4, pendingCollapsed: true });

    expect(header()?.textContent).toContain('4 Pending');
    expect(container.textContent).not.toContain('Queue is empty');
  });

  it('toggles on click', async () => {
    const onToggle = vi.fn();
    await render({
      items: [pendingItem('p1', 1)],
      pendingCount: 1,
      pendingCollapsed: false,
      onToggle,
    });

    await act(async () => {
      header()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders no header when nothing is pending', async () => {
    await render({ items: [doneItem], pendingCount: 0, pendingCollapsed: false });

    expect(header()).toBeNull();
  });
});
