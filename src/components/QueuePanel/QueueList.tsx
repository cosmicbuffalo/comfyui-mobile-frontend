import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { HistoryOutputImage, Workflow } from '@/api/types';
import type { ItemStatus, UnifiedItem, ViewerImage } from './types';
import { QueueCard } from './QueueCard';
import { InboxIcon } from '@/components/icons';
import { FoldIcon } from '@/components/FoldIcon';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useQueueStore } from '@/hooks/useQueue';
import { useI18n } from '@/i18n';
import { useIsDesktop } from '@/hooks/useIsDesktop';
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

// Added to MOMENTUM_QUIET_MS to decide a coast is over rather than between two
// of its own frames. One frame's worth, so re-anchoring lands in the quiet
// immediately after the list stops.
const MOMENTUM_SETTLE_MARGIN_MS = 20;

// The Pending header is an anchorable element in its own right, so folding the
// section pins the header itself rather than letting the list jump.
const PENDING_HEADER_ANCHOR_ID = 'queue-pending-section';

interface QueueListProps {
  listRef: React.RefObject<HTMLDivElement | null>;
  unifiedList: UnifiedItem[];
  visibleCount: number;
  /** Total pending items, folded or not — the header count must not follow the
   *  rendered slice. */
  pendingCount: number;
  pendingCollapsed: boolean;
  onTogglePendingCollapsed: () => void;
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
  firstDoneItemId: string | null;
  queueVideoPlaybackEnabled: boolean;
  activeQueueVideoOwnerId: string | null;
  onRequestQueueVideoPlayback: (itemId: string) => void;
  onRequestAutoQueueVideoPlayback: (itemId: string) => void;
  onReleaseQueueVideoPlayback: (itemId: string) => void;
  onItemMediaReady?: (itemId: string) => void;
  onScroll: () => void;
  loadingMore?: boolean;
}

export function QueueList({
  listRef,
  unifiedList,
  visibleCount,
  pendingCount,
  pendingCollapsed,
  onTogglePendingCollapsed,
  hasLoadedOnce,
  effectiveExecutingId,
  progress,
  overallProgress,
  executingNodeLabel,
  onImageClick,
  viewerImages,
  promptOutputs,
  onOpenMenu,
  firstDoneItemId,
  queueVideoPlaybackEnabled,
  activeQueueVideoOwnerId,
  onRequestQueueVideoPlayback,
  onRequestAutoQueueVideoPlayback,
  onReleaseQueueVideoPlayback,
  onItemMediaReady,
  onScroll,
  loadingMore = false
}: QueueListProps) {
  const { t } = useI18n();
  const queueOutputLayout = useQueueStore((s) => s.queueOutputLayout);
  const isDesktop = useIsDesktop();
  // In the desktop stacked layout the panel is full-width, so each card shrinks
  // to its own output row and re-centers instead of filling the screen.
  const fitCardsToContent = isDesktop && queueOutputLayout === 'stacked';
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
  // Set whenever compensation is skipped because a flick is coasting, and read
  // by the first pass after it stops. See `compensate`.
  const skippedForMomentumRef = useRef(false);
  const momentumSettleTimerRef = useRef<number | null>(null);
  /**
   * What the list draws: normally the current props, but the set captured when
   * a flick started while one is still coasting.
   *
   * The alternative is to let a change land mid-coast and correct for it, which
   * is what happens at every other moment — but correcting means writing
   * `scrollTop`, and that cancels the fling. Measured in Chromium: compensating
   * through a coast removes the jumps completely (`maxJerk` 132px -> 2px) at the
   * cost of about half the flick's remaining travel, and iOS is likelier to stop
   * it dead than merely shorten it. Neither is worth it when the change can
   * simply wait a few hundred milliseconds instead.
   *
   * Nothing is lost by waiting. A card completing above the reader is not
   * something they are looking at — it is the reason the list moved under them.
   * On release the held-back changes apply together, by which time compensation
   * is allowed again and absorbs them in the same frame.
   *
   * `progress` and the other per-tick props are deliberately not held back: they
   * animate inside a card without changing its height, so the panel stays alive
   * while the flick runs. Neither is `visibleCount` — the progressive reveal
   * only ever grows it, and growth mounts cards at the *bottom* of the list,
   * which cannot move a reader who is above them. Holding it back instead made
   * the release worse: the window would jump forward by everything the reveal
   * had wanted during the coast, dropping a card off the end at the same moment
   * one arrived at the front.
   */
  const liveDraw = useMemo(
    () => ({ unifiedList, promptOutputs, effectiveExecutingId, firstDoneItemId }),
    [unifiedList, promptOutputs, effectiveExecutingId, firstDoneItemId],
  );
  // Synced after commit rather than during render, so what a hold captures is
  // exactly what is on the glass at the moment the flick begins.
  const liveDrawRef = useRef(liveDraw);
  useLayoutEffect(() => { liveDrawRef.current = liveDraw; }, [liveDraw]);
  const [heldDraw, setHeldDraw] = useState<typeof liveDraw | null>(null);
  const drawn = heldDraw ?? liveDraw;

  const holdDraw = useCallback(() => {
    setHeldDraw((held) => held ?? liveDrawRef.current);
  }, []);
  const releaseDraw = useCallback(() => setHeldDraw(null), []);

  const visibleItemIds = useMemo(
    () => drawn.unifiedList.slice(0, visibleCount).map((item) => item.id).join('\0'),
    [drawn, visibleCount],
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

  // Re-point the anchor at whatever the reader is now looking at, discarding
  // whatever it used to describe.
  const reanchor = useCallback((container: HTMLDivElement) => {
    skippedForMomentumRef.current = false;
    if (container.scrollTop <= 1) return;
    scrollAnchorRef.current = captureQueueScrollAnchor(container);
    compensatedScrollTopRef.current = null;
  }, []);

  const compensate = useCallback((container: HTMLDivElement): boolean => {
    if (skippedForMomentumRef.current) {
      // A backstop for the narrow window between the coast stopping and the
      // settle timer firing: same reasoning as `scheduleMomentumSettle`, which
      // handles this in every other case and explains it.
      reanchor(container);
      return false;
    }
    if (restoreQueueScrollAnchor(container, scrollAnchorRef.current)) {
      compensatedScrollTopRef.current = container.scrollTop;
      return true;
    }
    return false;
  }, [reanchor]);

  /**
   * Re-anchor once a coasting flick has actually stopped, and let through what
   * was held back while it ran.
   *
   * Shifts that land while momentum runs are let through deliberately — a
   * `scrollTop` write would cancel the native fling — which leaves the anchor
   * describing the list as it was before any of them. Correcting that backlog
   * later would yank the list by the sum of it, in one frame, after the reader
   * has already watched it settle. Where they landed is the new truth.
   *
   * On a timer rather than on the next compensation pass, because the next pass
   * is itself usually triggered by a fresh shift: doing both in one frame means
   * the re-anchor swallows that shift instead of correcting it. The timer gets
   * there first, in the quiet after the coast, so the anchor is already honest
   * by the time anything else moves.
   */
  const scheduleMomentumSettle = useCallback(() => {
    if (momentumSettleTimerRef.current !== null) {
      window.clearTimeout(momentumSettleTimerRef.current);
    }
    momentumSettleTimerRef.current = window.setTimeout(() => {
      momentumSettleTimerRef.current = null;
      const container = listRef.current;
      // Still coasting: the next momentum scroll event re-arms this.
      if (!container || isMomentumScroll()) return;
      // Three steps, in this order and in one task.
      //
      // Re-anchor first, on what the reader is actually looking at now: the
      // flick has carried them a long way from wherever the anchor was last
      // captured, and anything that did shift during the coast (an image
      // decoding inside a card that was already mounted — not everything is
      // held back) has been seen and accepted by now.
      reanchor(container);
      // Then let the held-back changes through, synchronously, so the DOM they
      // produce exists before this task ends...
      flushSync(() => releaseDraw());
      // ...and correct for them immediately, repeatedly until the list stops
      // moving. Layout settles in more than one step here — a card arriving
      // above the reader and one dropping off the bottom of the rendered window
      // do not land together — and each `compensate` call re-measures, so one
      // pass corrects only what it can see. Left to the layout effect and the
      // ResizeObserver, the remainder lands a frame late: measured at 285px,
      // painted for exactly one frame, which is the flash the hold exists to
      // prevent. The cap is a guard against a pathological loop, not a budget.
      for (let pass = 0; pass < 4 && compensate(container); pass += 1) { /* settle */ }
    }, MOMENTUM_QUIET_MS + MOMENTUM_SETTLE_MARGIN_MS);
  }, [compensate, isMomentumScroll, listRef, reanchor, releaseDraw]);

  useEffect(() => () => {
    if (momentumSettleTimerRef.current !== null) {
      window.clearTimeout(momentumSettleTimerRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    const container = listRef.current;
    if (!container) return;
    // A scrollTop write here would cancel a native fling, so defer only while
    // momentum is actually coasting; at rest and during a finger drag, pin.
    if (isMomentumScroll()) { skippedForMomentumRef.current = true; return; }
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
        if (isMomentumScroll()) { skippedForMomentumRef.current = true; return; }
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
    // A finger on the glass ends any hold: compensation works during a drag, so
    // there is nothing to protect the reader from, and catching a coast to read
    // something should show them the current queue rather than a stale one.
    releaseDraw();
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
        skippedForMomentumRef.current = true;
        holdDraw();
        scheduleMomentumSettle();
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
      {unifiedList.length === 0 && pendingCount === 0 && !hasLoadedOnce && (
        <div className="flex items-center justify-center min-h-[calc(100vh-180px)] text-slate-400">
          <div className="text-center">
            <LoadingSpinner size="lg" color="gray" className="mx-auto mb-4" />
            <p className="text-lg">{t('Loading...')}</p>
          </div>
        </div>
      )}
      {unifiedList.length === 0 && pendingCount === 0 && hasLoadedOnce && (
        <div className="flex items-center justify-center min-h-[calc(100vh-180px)] text-slate-400">
          <div className="text-center p-8">
            <div className="flex items-center justify-center mb-4">
              <InboxIcon className="w-10 h-10 text-slate-600" />
            </div>
            <p className="text-lg font-medium">{t('Queue is empty')}</p>
            <p className="text-sm mt-2">
              {t('Run a workflow to see items here')}
            </p>
          </div>
        </div>
      )}

      {/* Cards are capped/centered here so the scroll container above can span
          the full screen width (scrollbar at the edge) without the cards
          stretching. In the wide "fit to content" layout each card self-centers,
          so this wrapper stays full width and lets them do so. */}
      {(unifiedList.length > 0 || pendingCount > 0) && (
        <div className={`w-full space-y-4 ${fitCardsToContent ? '' : 'mx-auto max-w-3xl'}`}>
          {pendingCount > 0 && (
            <button
              type="button"
              // Folding pins this header (see onPointerDownCapture above), so the
              // row stays under the finger while the section below it collapses.
              data-queue-fold-anchor
              data-scroll-anchor-id={PENDING_HEADER_ANCHOR_ID}
              onClick={onTogglePendingCollapsed}
              aria-expanded={!pendingCollapsed}
              className="queue-pending-section-header flex w-full items-center gap-2 text-left text-sm font-medium text-slate-400 hover:text-slate-100"
            >
              <FoldIcon open={!pendingCollapsed} variant="chevron" className="w-4 h-4" />
              <span>{t('{count} Pending', { count: pendingCount })}</span>
            </button>
          )}
          {drawn.unifiedList.slice(0, visibleCount).map((item) => {
            // Only the running card consumes the per-tick progress props; passing
            // stable constants to every other card lets React.memo skip them so the
            // whole list doesn't reconcile on each progress message.
            const isRunningCard = item.id === drawn.effectiveExecutingId;
            return (
              <div
                key={item.id}
                data-queue-item-id={item.id}
                data-scroll-anchor-id={item.id}
                // `rounded-xl` matches the QueueCard inside it: this wrapper is
                // what `flashQueueCard` pulses, and the pulse ring is drawn with
                // `border-radius: inherit`, so without it the ring squares off
                // the card's corners.
                className={`rounded-xl${fitCardsToContent ? ' mx-auto w-fit max-w-full' : ''}`}
              >
                <QueueCard
                  item={item}
                  isActuallyRunning={isRunningCard}
                  progress={isRunningCard ? progress : 0}
                  overallProgress={isRunningCard ? overallProgress : null}
                  executingNodeLabel={isRunningCard ? executingNodeLabel : null}
                  onImageClick={onImageClick}
                  viewerImages={viewerImages}
                  runningImages={drawn.promptOutputs[item.id] ?? EMPTY_RUNNING_IMAGES}
                  onOpenMenu={onOpenMenu}
                  isTopDoneItem={item.id === drawn.firstDoneItemId}
                  queueVideoPlaybackEnabled={queueVideoPlaybackEnabled}
                  queueVideoOwnerId={activeQueueVideoOwnerId}
                  onRequestQueueVideoPlayback={onRequestQueueVideoPlayback}
                  onRequestAutoQueueVideoPlayback={onRequestAutoQueueVideoPlayback}
                  onReleaseQueueVideoPlayback={onReleaseQueueVideoPlayback}
                  onMediaReady={onItemMediaReady}
                />
              </div>
            );
          })}
        </div>
      )}
      {loadingMore && (
        <div className="flex justify-center py-4">
          <LoadingSpinner size="md" color="gray" />
        </div>
      )}
      <div className="h-20" />
    </div>
  );
}
