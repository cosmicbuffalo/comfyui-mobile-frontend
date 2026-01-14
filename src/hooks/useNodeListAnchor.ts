import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

interface UseNodeListAnchorParams {
  active: boolean;
  parentRef: React.RefObject<HTMLDivElement | null>;
  innerRef: React.RefObject<HTMLDivElement | null>;
  virtualItemsRef: React.MutableRefObject<Array<{ index: number; start: number }>>;
  virtualItems: Array<{ index: number; start: number }>;
  virtualizer: { scrollToIndex: (index: number, opts: { align: 'start' | 'center' | 'end' | 'auto' }) => void };
}

export function useNodeListAnchor({
  active,
  parentRef,
  innerRef,
  virtualItemsRef,
  virtualItems,
  virtualizer
}: UseNodeListAnchorParams) {
  const anchorIndexRef = useRef<number | null>(null);
  const anchorOffsetRef = useRef<number>(0);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAdjustingScrollRef = useRef(false);
  const skipAnchorRef = useRef(false);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;

    const handleScroll = () => {
      if (isAdjustingScrollRef.current) {
        isAdjustingScrollRef.current = false;
        return;
      }

      if (!active) return;

      isUserScrollingRef.current = true;
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 150);

      const items = virtualItemsRef.current;
      if (!items.length) return;
      const firstItem = items[0];
      anchorIndexRef.current = firstItem.index;

      const containerRect = parent.getBoundingClientRect();
      const anchorEl = innerRef.current?.querySelector<HTMLDivElement>(`[data-index="${firstItem.index}"]`);
      if (anchorEl) {
        const anchorRect = anchorEl.getBoundingClientRect();
        anchorOffsetRef.current = anchorRect.top - containerRect.top;
      } else {
        anchorOffsetRef.current = firstItem.start - parent.scrollTop;
      }
    };

    parent.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      parent.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [active, parentRef, innerRef, virtualItemsRef]);

  useEffect(() => {
    if (!active) return;
    const handleScrollTop = () => {
      if (!parentRef.current) return;
      isAdjustingScrollRef.current = true;
      anchorIndexRef.current = null;
      skipAnchorRef.current = true;
      virtualizer.scrollToIndex(0, { align: 'start' });
    };
    window.addEventListener('workflow-scroll-to-top', handleScrollTop);
    return () => {
      window.removeEventListener('workflow-scroll-to-top', handleScrollTop);
    };
  }, [active, parentRef, virtualizer]);

  useLayoutEffect(() => {
    if (!active || isUserScrollingRef.current) return;
    const parent = parentRef.current;
    if (!parent) return;
    if (skipAnchorRef.current) {
      skipAnchorRef.current = false;
      return;
    }
    const anchorIndex = anchorIndexRef.current;
    if (anchorIndex === null) return;

    const anchorItem = virtualItems.find((item) => item.index === anchorIndex);
    if (!anchorItem) return;

    const containerRect = parent.getBoundingClientRect();
    const anchorEl = innerRef.current?.querySelector<HTMLDivElement>(`[data-index="${anchorIndex}"]`);
    let desiredScrollTop = anchorItem.start - anchorOffsetRef.current;
    if (anchorEl) {
      const anchorRect = anchorEl.getBoundingClientRect();
      const currentOffset = anchorRect.top - containerRect.top;
      desiredScrollTop = parent.scrollTop + (currentOffset - anchorOffsetRef.current);
    }

    if (Math.abs(parent.scrollTop - desiredScrollTop) > 1) {
      isAdjustingScrollRef.current = true;
      parent.scrollTop = desiredScrollTop;
    }
  }, [active, parentRef, innerRef, virtualItems]);

  const resetAnchor = useCallback(() => {
    anchorIndexRef.current = null;
    anchorOffsetRef.current = 0;
    skipAnchorRef.current = true;
  }, []);

  return { resetAnchor };
}
