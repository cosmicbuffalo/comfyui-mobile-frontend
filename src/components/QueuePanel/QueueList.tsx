import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { HistoryOutputImage, Workflow } from '@/api/types';
import type { ItemStatus, UnifiedItem, ViewerImage } from './types';
import { QueueCard } from './QueueCard';
import { InboxIcon } from '@/components/icons';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import {
  captureQueueScrollAnchor,
  captureQueueScrollAnchorForItem,
  isQueueTouchMomentumScroll,
  restoreQueueScrollAnchor,
  shouldCaptureQueueScrollAnchor,
  type QueueScrollAnchor,
} from '@/utils/queueScrollAnchor';

// Stable reference for cards with no live outputs, so a fresh `[]` per render
// doesn't defeat QueueCard's memoization.
const EMPTY_RUNNING_IMAGES: HistoryOutputImage[] = [];

// Post-lift momentum (a flick) keeps firing scroll events frame-by-frame. We
// treat the list as still coasting while real scroll events keep arriving this
// recently; once they stop for longer than this, momentum is done and scroll
// compensation resumes. Long enough to bridge the gap between decelerating
// momentum frames (~16ms apart), short enough that a rested list re-stabilizes
// almost immediately. Purely time-based, so it can never get "stuck on".
const MOMENTUM_QUIET_MS = 100;

interface QueueListProps {
  listRef: React.RefObject<HTMLDivElement | null>;
  unifiedList: UnifiedItem[];
  visibleCount: number;
  hasLoadedOnce: boolean;
  effectiveExecutingId: string | null;
  progress: number;
  overallProgress?: number | null;
  executingNodeLabel?: string | null;
  onImageClick?: (images: Array<ViewerImage>, index: number, enableFollowQueue?: boolean) => void;
  viewerImages: Array<ViewerImage>;
  promptOutputs: Record<string, HistoryOutputImage[]>;
  onOpenMenu: (payload: {
    top: number;
    right: number;
    imageSrc: string;
    imageSources: string[];
    status: ItemStatus;
    workflow?: Workflow;
    promptId?: string;
    hasVideoOutputs?: boolean;
    hasImageOutputs?: boolean;
    canReenqueue?: boolean;
  }) => void;
  downloaded: Record<string, boolean>;
  firstDoneItemId: string | null;
  onScroll: () => void;
  loadingMore?: boolean;
}

export function QueueList({
  listRef,
  unifiedList,
  visibleCount,
  hasLoadedOnce,
  effectiveExecutingId,
  progress,
  overallProgress,
  executingNodeLabel,
  onImageClick,
  viewerImages,
  promptOutputs,
  onOpenMenu,
  downloaded,
  firstDoneItemId,
  onScroll,
  loadingMore = false
}: QueueListProps) {
  const scrollAnchorRef = useRef<QueueScrollAnchor | null>(null);
  const userScrollIntentRef = useRef(false);
  const userScrollIntentTimeoutRef = useRef<number | null>(null);
  // True while a finger is touching the list. A finger-down drag drives scroll
  // position directly, so compensation is safe then; only post-lift momentum is
  // fragile to a scrollTop write (it cancels the native fling).
  const fingerDownRef = useRef(false);
  // True after a touch gesture starts. Desktop wheel / mouse / keyboard input
  // clears it so recent desktop scroll events are never mistaken for a fling.
  const touchGestureActiveRef = useRef(false);
  // Timestamp (performance.now) of the last *real* scroll event — i.e. one not
  // caused by our own compensation write. Used to detect post-lift momentum.
  const lastScrollAtRef = useRef(0);
  // The scrollTop value right after a compensation write, so the scroll event it
  // triggers is recognized as ours and not mistaken for user/momentum scrolling.
  const compensatedScrollTopRef = useRef<number | null>(null);
  const visibleItemIds = useMemo(
    () => unifiedList.slice(0, visibleCount).map((item) => item.id).join('\0'),
    [unifiedList, visibleCount],
  );

  // Post-lift momentum = finger is up AND real scroll events are still arriving.
  // At rest the timestamp goes stale and this returns false, so compensation
  // always resumes — it cannot get wedged "on". A finger-down drag is never
  // momentum, so the held item stays pinned under it.
  // Stable identities so the persistent ResizeObserver below can be created once
  // (both only read refs, so they never need to change).
  const isMomentumScroll = useCallback(
    () => isQueueTouchMomentumScroll(
      touchGestureActiveRef.current,
      fingerDownRef.current,
      performance.now() - lastScrollAtRef.current,
      MOMENTUM_QUIET_MS,
    ),
    [],
  );

  const compensate = useCallback((container: HTMLDivElement) => {
    if (restoreQueueScrollAnchor(container, scrollAnchorRef.current)) {
      compensatedScrollTopRef.current = container.scrollTop;
    }
  }, []);

  useLayoutEffect(() => {
    const container = listRef.current;
    if (!container) return;
    // A scrollTop write here would cancel a native fling, so defer only while
    // momentum is actually coasting; at rest and during a finger drag, pin.
    if (isMomentumScroll()) return;
    compensate(container);
  });

  // A single ResizeObserver kept across renders (created lazily). Disconnected
  // only on unmount.
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedItemsRef = useRef<Set<Element>>(new Set());
  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    observedItemsRef.current.clear();
  }, []);

  // When the rendered set changes: incrementally observe newly-added item
  // elements and unobserve removed ones (instead of tearing down and
  // re-observing everything), and re-anchor if the anchored item was removed
  // (delete / TTL prune) so compensation survives.
  useEffect(() => {
    const container = listRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    if (!observerRef.current) {
      observerRef.current = new ResizeObserver(() => {
        // Runs after layout, before paint: compensate so image loads / card
        // animations don't paint a shifted frame. Skip while a flick coasts.
        if (isMomentumScroll()) return;
        const el = listRef.current;
        if (el) compensate(el);
      });
    }
    const observer = observerRef.current;

    const anchorId = scrollAnchorRef.current?.itemId;
    let anchorStillPresent = false;
    const next = new Set<Element>();
    container
      .querySelectorAll<HTMLElement>('[data-queue-item-id]')
      .forEach((item) => {
        next.add(item);
        if (!observedItemsRef.current.has(item)) observer.observe(item);
      });
    for (const item of observedItemsRef.current) {
      if (!next.has(item)) observer.unobserve(item);
    }
    observedItemsRef.current = next;

    // anchorId may be a fine-grained scroll-anchor id (`${promptId}::header`,
    // `${promptId}::media::…`) rather than a card id, so look the anchored
    // element up by comparing dataset values directly. (A quoted attribute
    // selector built with CSS.escape would backslash-escape `::` and never
    // match, defeating the fine-grained pinning.)
    if (anchorId) {
      for (const el of container.querySelectorAll<HTMLElement>('[data-scroll-anchor-id]')) {
        if (el.dataset.scrollAnchorId === anchorId) {
          anchorStillPresent = true;
          break;
        }
      }
    }

    if (anchorId && !anchorStillPresent && container.scrollTop > 1) {
      scrollAnchorRef.current = captureQueueScrollAnchor(container);
    }
  }, [listRef, visibleItemIds, isMomentumScroll, compensate]);

  useEffect(() => () => {
    if (userScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(userScrollIntentTimeoutRef.current);
    }
  }, []);

  const markUserScrollIntent = () => {
    userScrollIntentRef.current = true;
    if (userScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(userScrollIntentTimeoutRef.current);
    }
    userScrollIntentTimeoutRef.current = window.setTimeout(() => {
      userScrollIntentRef.current = false;
      userScrollIntentTimeoutRef.current = null;
    }, 180);
  };

  const handleTouchStart = () => {
    touchGestureActiveRef.current = true;
    fingerDownRef.current = true;
  };

  const handleTouchEnd = () => {
    fingerDownRef.current = false;
  };

  const handleScroll = () => {
    const container = listRef.current;
    let isOwnCompensation = false;
    if (container) {
      const compensated = compensatedScrollTopRef.current;
      isOwnCompensation =
        compensated !== null && Math.abs(container.scrollTop - compensated) < 0.5;
      // Only real (user / momentum) scrolls advance the momentum clock; our own
      // compensation writes must not, or a single at-rest fixup would masquerade
      // as momentum and suppress the next one.
      if (!isOwnCompensation) {
        lastScrollAtRef.current = performance.now();
      }

      if (container.scrollTop <= 1) {
        scrollAnchorRef.current = null;
        compensatedScrollTopRef.current = null;
      } else if (isMomentumScroll()) {
        // Flick coasting: never touch the anchor or scrollTop here — a write
        // cancels the native momentum and strands the list mid-toss.
      } else if (isOwnCompensation) {
        // Our compensation scrolled the list; the anchor is already correct.
      } else {
        // A real, settled scroll (or a finger-down drag). Compensate any
        // involuntary shift at the current position *before* re-baselining, so
        // the fresh anchor can't bake in a shift that hasn't been corrected yet.
        // restore is scroll-relative, so this subtracts the user's own scrolling
        // and never fights the drag.
        compensate(container);
        if (shouldCaptureQueueScrollAnchor(container.scrollTop, userScrollIntentRef.current)) {
          // Re-point to the item now at the top of the viewport so the anchor
          // tracks what the user is looking at as they scroll.
          scrollAnchorRef.current = captureQueueScrollAnchor(container);
          compensatedScrollTopRef.current = null;
        } else if (!scrollAnchorRef.current) {
          // No user intent yet but we're scrolled down (e.g. restored position):
          // establish a baseline so resizes have something to stabilize against.
          scrollAnchorRef.current = captureQueueScrollAnchor(container);
        }
      }
    }
    // Our own compensation writes fire a scroll event too; only genuine user
    // scrolling should drive visibleCount growth.
    if (!isOwnCompensation) onScroll();
  };

  const handleScrollKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'PageUp' ||
      event.key === 'PageDown' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === ' '
    ) {
      touchGestureActiveRef.current = false;
      markUserScrollIntent();
    }
  };

  const handleWheel = () => {
    touchGestureActiveRef.current = false;
    markUserScrollIntent();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      touchGestureActiveRef.current = false;
    }
    markUserScrollIntent();
  };

  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = listRef.current;
    const target = event.target;
    if (!container || !(target instanceof Element)) return;
    if (!target.closest('[data-queue-fold-anchor]')) return;
    // Pin the row being folded (its prompt-preview chunk) so it stays put as the
    // content below it expands/collapses, rather than the whole card's top.
    const anchorEl =
      target.closest<HTMLElement>('[data-scroll-anchor-id]') ??
      target.closest<HTMLElement>('[data-queue-item-id]');
    if (!anchorEl) return;
    scrollAnchorRef.current = captureQueueScrollAnchorForItem(container, anchorEl);
  };

  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain scroll-container"
      data-queue-list="true"
      onScroll={handleScroll}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={markUserScrollIntent}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onPointerDown={handlePointerDown}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMove={(event) => {
        if (event.buttons !== 0) markUserScrollIntent();
      }}
      onKeyDown={handleScrollKeyDown}
      style={{ overflowAnchor: 'none' }}
    >
      {unifiedList.length === 0 && !hasLoadedOnce && (
        <div className="flex items-center justify-center min-h-[calc(100vh-180px)] text-slate-400">
          <div className="text-center">
            <LoadingSpinner size="lg" color="gray" className="mx-auto mb-4" />
            <p className="text-lg">Loading...</p>
          </div>
        </div>
      )}
      {unifiedList.length === 0 && hasLoadedOnce && (
        <div className="flex items-center justify-center min-h-[calc(100vh-180px)] text-slate-400">
          <div className="text-center p-8">
            <div className="flex items-center justify-center mb-4">
              <InboxIcon className="w-10 h-10 text-slate-600" />
            </div>
            <p className="text-lg font-medium">Queue is empty</p>
            <p className="text-sm mt-2">
              Run a workflow to see items here
            </p>
          </div>
        </div>
      )}

      {unifiedList.slice(0, visibleCount).map((item) => {
        // Only the running card consumes the per-tick progress props; passing
        // stable constants to every other card lets React.memo skip them so the
        // whole list doesn't reconcile on each progress message.
        const isRunningCard = item.id === effectiveExecutingId;
        return (
          <div key={item.id} data-queue-item-id={item.id} data-scroll-anchor-id={item.id}>
            <QueueCard
              item={item}
              isActuallyRunning={isRunningCard}
              progress={isRunningCard ? progress : 0}
              overallProgress={isRunningCard ? overallProgress : null}
              executingNodeLabel={isRunningCard ? executingNodeLabel : null}
              onImageClick={onImageClick}
              viewerImages={viewerImages}
              runningImages={promptOutputs[item.id] ?? EMPTY_RUNNING_IMAGES}
              onOpenMenu={onOpenMenu}
              downloaded={downloaded}
              isTopDoneItem={item.id === firstDoneItemId}
            />
          </div>
        );
      })}
      {loadingMore && (
        <div className="flex justify-center py-4">
          <LoadingSpinner size="md" color="gray" />
        </div>
      )}
      <div className="h-20" />
    </div>
  );
}
