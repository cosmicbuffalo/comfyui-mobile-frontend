import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import { useBookmarksStore } from "@/hooks/useBookmarks";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { getGroupKey, scopedNodeKey, type ItemRef } from "@/utils/mobileLayout";
import { findLayoutPath } from "@/utils/layoutTraversal";
import { requireHierarchicalKey } from "@/utils/itemKeys";

type BookmarksState = ReturnType<typeof useBookmarksStore.getState>;
type WorkflowStoreState = ReturnType<typeof useWorkflowStore.getState>;

interface BookmarkBarDeps {
  mobileLayout: WorkflowStoreState["mobileLayout"];
  nodeItemKeyByScopedKey: Map<string, string>;
  subgraphItemKeyById: Map<string, string>;
  currentScopeSubgraphTrail: string[];
  currentScopeWorkflow: WorkflowStoreState["workflow"];
  setItemCollapsed: WorkflowStoreState["setItemCollapsed"];
  scrollToNode: WorkflowStoreState["scrollToNode"];
  revealNodeWithParents: WorkflowStoreState["revealNodeWithParents"];
  setItemHidden: WorkflowStoreState["setItemHidden"];
  navigateToSubgraphTrail: WorkflowStoreState["navigateToSubgraphTrail"];
  itemKeyByPointer: WorkflowStoreState["itemKeyByPointer"];
  bookmarkedItems: BookmarksState["bookmarkedItems"];
  bookmarkBarSide: BookmarksState["bookmarkBarSide"];
  bookmarkBarTop: BookmarksState["bookmarkBarTop"];
  setBookmarkBarPosition: BookmarksState["setBookmarkBarPosition"];
  wrapperRef: RefObject<HTMLDivElement | null>;
  previousTopBarHeightRef: RefObject<number | null>;
  topBarHeight: number;
}

export function useBookmarkBar(deps: BookmarkBarDeps) {
  const {
    mobileLayout,
    nodeItemKeyByScopedKey,
    subgraphItemKeyById,
    currentScopeSubgraphTrail,
    currentScopeWorkflow,
    setItemCollapsed,
    scrollToNode,
    revealNodeWithParents,
    setItemHidden,
    navigateToSubgraphTrail,
    itemKeyByPointer,
    bookmarkedItems,
    bookmarkBarSide,
    bookmarkBarTop,
    setBookmarkBarPosition,
    wrapperRef,
    previousTopBarHeightRef,
    topBarHeight,
  } = deps;

  const [bookmarkCycleIndex, setBookmarkCycleIndex] = useState(0);
  const [pendingBookmarkEntry, setPendingBookmarkEntry] =
    useState<BookmarkEntry | null>(null);
  const [isBookmarkRepositioning, setIsBookmarkRepositioning] = useState(false);
  const [isBookmarkDragging, setIsBookmarkDragging] = useState(false);
  const [bookmarkDragPosition, setBookmarkDragPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const bookmarkBarRef = useRef<HTMLDivElement>(null);

  const bookmarkLongPressRef = useRef<number | null>(null);
  const bookmarkLongPressTriggeredRef = useRef(false);
  const bookmarkPointerRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    pointerId: number;
    isButtonPress: boolean;
  } | null>(null);
  const bookmarkDragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  type BookmarkEntry =
    | { itemKey: string; type: "node"; nodeId: number; subgraphId: string | null; text: string }
    | { itemKey: string; type: "group"; groupId: number; subgraphId: string | null; groupKey: string; text: string }
    | { itemKey: string; type: "subgraph"; subgraphId: string; text: string };

  const bookmarkEntryByHierarchicalKey = useMemo(() => {
    const byHierarchicalKey = new Map<string, BookmarkEntry>();
    const visitedGroups = new Set<string>();
    const visitedSubgraphs = new Set<string>();
    const visit = (refs: ItemRef[], currentSubgraphId: string | null) => {
      refs.forEach((ref) => {
        if (ref.type === "node") {
          const itemKey = requireHierarchicalKey(
            nodeItemKeyByScopedKey.get(scopedNodeKey(ref.id, currentSubgraphId)),
            `layout node ref ${ref.id}`,
          );
          byHierarchicalKey.set(itemKey, {
            itemKey,
            type: "node",
            nodeId: ref.id,
            subgraphId: currentSubgraphId,
            text: String(ref.id),
          });
          return;
        }
        if (ref.type === "group") {
          const itemKey = getGroupKey(ref.id, ref.subgraphId);
          if (itemKey) {
            byHierarchicalKey.set(itemKey, {
              itemKey,
              type: "group",
              groupId: ref.id,
              subgraphId: currentSubgraphId,
              groupKey: getGroupKey(ref.id, ref.subgraphId),
              text: `G${ref.id}`,
            });
          }
          if (visitedGroups.has(getGroupKey(ref.id, ref.subgraphId))) return;
          visitedGroups.add(getGroupKey(ref.id, ref.subgraphId));
          visit(mobileLayout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
          return;
        }
        if (ref.type === "subgraph") {
          const itemKey = requireHierarchicalKey(
            subgraphItemKeyById.get(ref.id),
            `layout subgraph ref ${ref.id}`,
          );
          byHierarchicalKey.set(itemKey, {
            itemKey,
            type: "subgraph",
            subgraphId: ref.id,
            text: "SG",
          });
          if (visitedSubgraphs.has(ref.id)) return;
          visitedSubgraphs.add(ref.id);
          visit(mobileLayout.subgraphs[ref.id] ?? [], ref.id);
        }
      });
    };
    visit(mobileLayout.root, null);
    return byHierarchicalKey;
  }, [mobileLayout, nodeItemKeyByScopedKey, subgraphItemKeyById]);

  const bookmarkEntries = useMemo<BookmarkEntry[]>(
    () =>
      bookmarkedItems
        .map((itemKey) => bookmarkEntryByHierarchicalKey.get(itemKey))
        .filter((entry): entry is BookmarkEntry => entry != null),
    [bookmarkEntryByHierarchicalKey, bookmarkedItems],
  );

  const findPathToBookmarkedHierarchicalKey = useCallback(
    (itemKey: string): { groupKeys: string[]; subgraphIds: string[] } | null => {
      const path = findLayoutPath(mobileLayout, ({ ref, currentSubgraphId }) => {
        if (ref.type === "node") {
          return (
            requireHierarchicalKey(
              nodeItemKeyByScopedKey.get(scopedNodeKey(ref.id, currentSubgraphId)),
              `layout node ref ${ref.id}`,
            ) === itemKey
          );
        }
        if (ref.type === "group") {
          return getGroupKey(ref.id, ref.subgraphId) === itemKey;
        }
        if (ref.type === "subgraph") {
          return (
            requireHierarchicalKey(
              subgraphItemKeyById.get(ref.id),
              `layout subgraph ref ${ref.id}`,
            ) === itemKey
          );
        }
        return false;
      });
      if (!path) return null;
      return {
        groupKeys: path.groupKeys,
        subgraphIds: path.subgraphIds,
      };
    },
    [mobileLayout, nodeItemKeyByScopedKey, subgraphItemKeyById],
  );

  const jumpToBookmarkedNode = useCallback(
    (itemKey: string, nodeId: number, label?: string) => {
      revealNodeWithParents(itemKey);
      scrollToNode(itemKey, label);
      window.dispatchEvent(
        new CustomEvent("workflow-scroll-to-node", {
          detail: { nodeId, label },
        }),
      );
    },
    [revealNodeWithParents, scrollToNode],
  );

  const jumpToBookmarkedGroup = useCallback(
    (
      itemKey: string,
      groupHierarchicalKey: string,
      groupId: number,
      subgraphId: string | null,
    ) => {
      const path = findPathToBookmarkedHierarchicalKey(itemKey);
      if (path) {
        for (const id of path.subgraphIds) {
          const subgraphItemKey =
            subgraphItemKeyById.get(id) ?? null;
          if (!subgraphItemKey) continue;
          setItemHidden(subgraphItemKey, false);
          setItemCollapsed(subgraphItemKey, false);
        }
        for (const key of path.groupKeys) {
          const groupItemKey = itemKeyByPointer[key];
          if (!groupItemKey) continue;
          setItemHidden(groupItemKey, false);
          setItemCollapsed(groupItemKey, false);
        }
      }
      if (subgraphId) {
        const subgraphItemKey =
          subgraphItemKeyById.get(subgraphId) ?? null;
        if (subgraphItemKey) {
          setItemHidden(subgraphItemKey, false);
          setItemCollapsed(subgraphItemKey, false);
        }
      }
      setItemHidden(itemKey, false);
      setItemCollapsed(itemKey, false);

      const scope = subgraphId ?? "root";
      const headerSelector = `[data-group-id="${groupId}"][data-subgraph-id="${scope}"]`;
      const wrapperSelector = `[data-reposition-item="group-${groupHierarchicalKey}"]`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const headerEl = document.querySelector(headerSelector);
          const wrapperEl = document.querySelector(wrapperSelector);
          const scrollTarget = headerEl ?? wrapperEl;
          scrollTarget?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    },
    [
      findPathToBookmarkedHierarchicalKey,
      setItemCollapsed,
      setItemHidden,
      itemKeyByPointer,
      subgraphItemKeyById,
    ],
  );

  const jumpToBookmarkedSubgraph = useCallback(
    (itemKey: string, subgraphId: string) => {
      const path = findPathToBookmarkedHierarchicalKey(itemKey);
      if (path) {
        for (const id of path.subgraphIds) {
          const subgraphItemKey =
            subgraphItemKeyById.get(id) ?? null;
          if (!subgraphItemKey) continue;
          setItemHidden(subgraphItemKey, false);
          setItemCollapsed(subgraphItemKey, false);
        }
        for (const key of path.groupKeys) {
          const groupItemKey = itemKeyByPointer[key];
          if (!groupItemKey) continue;
          setItemHidden(groupItemKey, false);
          setItemCollapsed(groupItemKey, false);
        }
      }
      setItemHidden(itemKey, false);
      setItemCollapsed(itemKey, false);

      // Subgraph placeholders render as node items in the panel, so scroll
      // to the placeholder node's wrapper (bookmarks are definition-keyed;
      // with several instances the first placeholder is the jump target).
      const placeholderNode = currentScopeWorkflow?.nodes.find(
        (n) => n.type === subgraphId,
      );
      if (!placeholderNode) return;
      const wrapperSelector = `[data-reposition-item="node-${placeholderNode.id}"]`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document
            .querySelector(wrapperSelector)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    },
    [
      findPathToBookmarkedHierarchicalKey,
      setItemCollapsed,
      setItemHidden,
      itemKeyByPointer,
      subgraphItemKeyById,
      currentScopeWorkflow,
    ],
  );

  const activateBookmarkEntry = useCallback(
    (entry: BookmarkEntry) => {
      if (entry.type === "node") {
        jumpToBookmarkedNode(entry.itemKey, entry.nodeId);
        return;
      }
      if (entry.type === "group") {
        jumpToBookmarkedGroup(
          entry.itemKey,
          entry.groupKey,
          entry.groupId,
          entry.subgraphId,
        );
        return;
      }
      jumpToBookmarkedSubgraph(entry.itemKey, entry.subgraphId);
    },
    [
      jumpToBookmarkedGroup,
      jumpToBookmarkedNode,
      jumpToBookmarkedSubgraph,
    ],
  );

  const navigateToBookmarkEntry = useCallback(
    (entry: BookmarkEntry) => {
      const path = findPathToBookmarkedHierarchicalKey(entry.itemKey);
      const targetSubgraphTrail = path?.subgraphIds ?? [];
      const alreadyInScope =
        targetSubgraphTrail.length === currentScopeSubgraphTrail.length &&
        targetSubgraphTrail.every(
          (subgraphId, index) => currentScopeSubgraphTrail[index] === subgraphId,
        );
      if (alreadyInScope) {
        setPendingBookmarkEntry(null);
        activateBookmarkEntry(entry);
        return;
      }
      if (!navigateToSubgraphTrail(targetSubgraphTrail)) return;
      setPendingBookmarkEntry(entry);
    },
    [
      activateBookmarkEntry,
      currentScopeSubgraphTrail,
      findPathToBookmarkedHierarchicalKey,
      navigateToSubgraphTrail,
    ],
  );

  useEffect(() => {
    if (!pendingBookmarkEntry) return;
    const path = findPathToBookmarkedHierarchicalKey(pendingBookmarkEntry.itemKey);
    const targetSubgraphTrail = path?.subgraphIds ?? [];
    const inTargetScope =
      targetSubgraphTrail.length === currentScopeSubgraphTrail.length &&
      targetSubgraphTrail.every(
        (subgraphId, index) => currentScopeSubgraphTrail[index] === subgraphId,
      );
    if (!inTargetScope) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        activateBookmarkEntry(pendingBookmarkEntry);
        setPendingBookmarkEntry(null);
      });
    });
  }, [
    activateBookmarkEntry,
    currentScopeSubgraphTrail,
    findPathToBookmarkedHierarchicalKey,
    pendingBookmarkEntry,
  ]);

  const stopBookmarkRepositioning = useCallback(() => {
    bookmarkLongPressTriggeredRef.current = false;
    setIsBookmarkRepositioning(false);
    setIsBookmarkDragging(false);
    setBookmarkDragPosition(null);
  }, []);

  const handleBookmarkButtonClick = useCallback(
    (entry: BookmarkEntry, index: number) => () => {
      if (bookmarkLongPressTriggeredRef.current) {
        bookmarkLongPressTriggeredRef.current = false;
        return;
      }
      if (isBookmarkRepositioning) {
        stopBookmarkRepositioning();
        return;
      }
      setBookmarkCycleIndex(index);
      navigateToBookmarkEntry(entry);
    },
    [
      isBookmarkRepositioning,
      navigateToBookmarkEntry,
      stopBookmarkRepositioning,
    ],
  );

  const handleBookmarkCycleClick = useCallback(() => {
    if (isBookmarkRepositioning) {
      stopBookmarkRepositioning();
      return;
    }
    const nextIndex = (bookmarkCycleIndex + 1) % bookmarkEntries.length;
    setBookmarkCycleIndex(nextIndex);
    const entry = bookmarkEntries[nextIndex];
    if (!entry) return;
    navigateToBookmarkEntry(entry);
  }, [
    bookmarkEntries,
    bookmarkCycleIndex,
    isBookmarkRepositioning,
    navigateToBookmarkEntry,
    stopBookmarkRepositioning,
  ]);

  const clearBookmarkLongPress = useCallback(() => {
    if (bookmarkLongPressRef.current != null) {
      window.clearTimeout(bookmarkLongPressRef.current);
      bookmarkLongPressRef.current = null;
    }
  }, []);

  const getBottomBarOffset = useCallback(() => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(
      "--bottom-bar-offset",
    );
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);

  const getBookmarkBounds = useCallback(() => {
    const wrapper = wrapperRef.current;
    const bar = bookmarkBarRef.current;
    if (!wrapper || !bar) return null;
    const wrapperHeight = wrapper.getBoundingClientRect().height;
    const barHeight = bar.getBoundingClientRect().height;
    const minTop = 16;
    const bottomMargin = getBottomBarOffset() + 8;
    // While the panel is (re)mounting — e.g. swiping back to it — the wrapper may
    // not be laid out yet, so its measured height is ~0. Treating that as real
    // would collapse maxTop down to minTop and clamp a restored/persisted
    // bookmark position up to the top. Report "no bounds" until there's genuine
    // room for the bar, so callers skip clamping rather than destroying the
    // saved position (which is still rendered directly from bookmarkBarTop).
    if (wrapperHeight <= minTop + barHeight + bottomMargin) return null;
    const maxTop = Math.max(minTop, wrapperHeight - barHeight - bottomMargin);
    return { minTop, maxTop };
  }, [getBottomBarOffset, wrapperRef]);

  const clampBookmarkTop = useCallback(
    (nextTop: number) => {
      const bounds = getBookmarkBounds();
      if (!bounds) return nextTop;
      return Math.min(Math.max(nextTop, bounds.minTop), bounds.maxTop);
    },
    [getBookmarkBounds],
  );

  useEffect(() => {
    const previousTopBarHeight = previousTopBarHeightRef.current;
    previousTopBarHeightRef.current = topBarHeight;
    if (
      previousTopBarHeight == null ||
      bookmarkBarTop == null ||
      isBookmarkDragging ||
      isBookmarkRepositioning
    ) {
      return;
    }
    const delta = topBarHeight - previousTopBarHeight;
    if (delta === 0) return;
    const nextTop = clampBookmarkTop(bookmarkBarTop - delta);
    if (nextTop !== bookmarkBarTop) {
      setBookmarkBarPosition({ top: nextTop });
    }
  }, [
    bookmarkBarTop,
    clampBookmarkTop,
    isBookmarkDragging,
    isBookmarkRepositioning,
    previousTopBarHeightRef,
    setBookmarkBarPosition,
    topBarHeight,
  ]);

  const updateBookmarkDragPosition = useCallback(
    (clientX: number, clientY: number) => {
      const wrapper = wrapperRef.current;
      const offset = bookmarkDragOffsetRef.current;
      if (!wrapper || !offset) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const nextX = clientX - wrapperRect.left - offset.x;
      const nextY = clampBookmarkTop(clientY - wrapperRect.top - offset.y);
      setBookmarkDragPosition({ x: nextX, y: nextY });
    },
    [clampBookmarkTop, wrapperRef],
  );

  const startBookmarkDrag = useCallback(
    (clientX: number, clientY: number) => {
      const wrapper = wrapperRef.current;
      const bar = bookmarkBarRef.current;
      if (!wrapper || !bar) return;
      const barRect = bar.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      bookmarkDragOffsetRef.current = {
        x: clientX - barRect.left,
        y: clientY - barRect.top,
      };
      const nextX = barRect.left - wrapperRect.left;
      const nextY = clampBookmarkTop(barRect.top - wrapperRect.top);
      setBookmarkDragPosition({ x: nextX, y: nextY });
      setIsBookmarkDragging(true);
    },
    [clampBookmarkTop, wrapperRef],
  );

  const handleBookmarkPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const isButtonPress = (event.target as HTMLElement).closest("button");
      const pointerTarget = event.currentTarget;
      bookmarkPointerRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startTime: Date.now(),
        pointerId: event.pointerId,
        isButtonPress: Boolean(isButtonPress),
      };
      if (isBookmarkRepositioning) {
        event.preventDefault();
        startBookmarkDrag(event.clientX, event.clientY);
        pointerTarget.setPointerCapture(event.pointerId);
      } else if (isButtonPress) {
        bookmarkLongPressRef.current = window.setTimeout(() => {
          bookmarkLongPressTriggeredRef.current = true;
          setIsBookmarkRepositioning(true);
          startBookmarkDrag(event.clientX, event.clientY);
          pointerTarget.setPointerCapture(event.pointerId);
        }, 500);
      } else {
        event.preventDefault();
        bookmarkLongPressRef.current = window.setTimeout(() => {
          bookmarkLongPressTriggeredRef.current = true;
          setIsBookmarkRepositioning(true);
          startBookmarkDrag(event.clientX, event.clientY);
        }, 500);
        pointerTarget.setPointerCapture(event.pointerId);
      }
    },
    [isBookmarkRepositioning, startBookmarkDrag],
  );

  const handleBookmarkPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isBookmarkDragging) {
        updateBookmarkDragPosition(event.clientX, event.clientY);
        return;
      }
      const pointerState = bookmarkPointerRef.current;
      if (!pointerState) return;
      const dx = event.clientX - pointerState.startX;
      const dy = event.clientY - pointerState.startY;
      if (Math.hypot(dx, dy) > 8) {
        clearBookmarkLongPress();
      }
    },
    [clearBookmarkLongPress, isBookmarkDragging, updateBookmarkDragPosition],
  );

  const finalizeBookmarkPosition = useCallback(() => {
    const wrapper = wrapperRef.current;
    const bar = bookmarkBarRef.current;
    if (!wrapper || !bar || !bookmarkDragPosition) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const barWidth = bar.getBoundingClientRect().width;
    const centerX = bookmarkDragPosition.x + barWidth / 2;
    const nextSide = centerX < wrapperRect.width / 2 ? "left" : "right";
    const nextTop = clampBookmarkTop(bookmarkDragPosition.y);
    setBookmarkBarPosition({ side: nextSide, top: nextTop });
    setBookmarkDragPosition(null);
  }, [bookmarkDragPosition, clampBookmarkTop, setBookmarkBarPosition, wrapperRef]);

  const handleBookmarkPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      clearBookmarkLongPress();
      const pointerState = bookmarkPointerRef.current;
      bookmarkPointerRef.current = null;
      if (isBookmarkDragging) {
        finalizeBookmarkPosition();
        setIsBookmarkDragging(false);
        if (!pointerState?.isButtonPress) {
          bookmarkLongPressTriggeredRef.current = false;
        }
        return;
      }
      if (bookmarkLongPressTriggeredRef.current && !pointerState?.isButtonPress) {
        bookmarkLongPressTriggeredRef.current = false;
      }
      if (isBookmarkRepositioning || !pointerState) return;
      const dx = event.clientX - pointerState.startX;
      const dy = event.clientY - pointerState.startY;
      const dt = Date.now() - pointerState.startTime;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
        const nextSide = bookmarkBarSide === "left" ? "right" : "left";
        setBookmarkBarPosition({ side: nextSide });
      }
    },
    [
      bookmarkBarSide,
      clearBookmarkLongPress,
      finalizeBookmarkPosition,
      isBookmarkDragging,
      isBookmarkRepositioning,
      setBookmarkBarPosition,
    ],
  );

  const handleBookmarkPointerCancel = useCallback(() => {
    clearBookmarkLongPress();
    bookmarkPointerRef.current = null;
    bookmarkLongPressTriggeredRef.current = false;
    setIsBookmarkDragging(false);
    setBookmarkDragPosition(null);
  }, [clearBookmarkLongPress]);


  useEffect(() => {
    if (!bookmarkEntries.length) return;
    const frame = window.requestAnimationFrame(() => {
      const bounds = getBookmarkBounds();
      if (!bounds) return;
      const { minTop, maxTop } = bounds;
      if (bookmarkBarTop == null) {
        setBookmarkBarPosition({ top: maxTop });
      } else {
        const nextTop = Math.min(Math.max(bookmarkBarTop, minTop), maxTop);
        if (nextTop !== bookmarkBarTop) {
          setBookmarkBarPosition({ top: nextTop });
        }
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    bookmarkEntries.length,
    bookmarkBarTop,
    getBookmarkBounds,
    setBookmarkBarPosition,
  ]);

  useEffect(() => {
    if (!isBookmarkRepositioning) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const bar = bookmarkBarRef.current;
      if (!bar || !event.target) return;
      if (bar.contains(event.target as Node)) return;
      stopBookmarkRepositioning();
      clearBookmarkLongPress();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, [clearBookmarkLongPress, isBookmarkRepositioning, stopBookmarkRepositioning]);

  const bookmarkBarTopValue = bookmarkDragPosition?.y ?? bookmarkBarTop ?? 0;
  const bookmarkBarLeftValue = bookmarkDragPosition
    ? `${bookmarkDragPosition.x}px`
    : bookmarkBarSide === "left"
      ? "0.75rem"
      : undefined;
  const bookmarkBarRightValue = bookmarkDragPosition
    ? undefined
    : bookmarkBarSide === "right"
      ? "0.75rem"
      : undefined;
  const bookmarkBarStyle = {
    top: `${bookmarkBarTopValue}px`,
    left: bookmarkBarLeftValue,
    right: bookmarkBarRightValue,
    opacity: bookmarkBarTop == null && bookmarkDragPosition == null ? 0 : 1,
    touchAction: isBookmarkRepositioning ? "none" : "pan-y",
    pointerEvents:
      bookmarkBarTop == null && bookmarkDragPosition == null ? "none" : "auto",
  } as const;


  return {
    bookmarkBarRef,
    bookmarkEntries,
    isBookmarkRepositioning,
    bookmarkBarStyle,
    handleBookmarkButtonClick,
    handleBookmarkCycleClick,
    handleBookmarkPointerDown,
    handleBookmarkPointerMove,
    handleBookmarkPointerUp,
    handleBookmarkPointerCancel,
  };
}
