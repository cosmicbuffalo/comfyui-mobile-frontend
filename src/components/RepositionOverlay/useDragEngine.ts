import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MobileLayout, ItemRef, ContainerId } from "@/utils/mobileLayout";
import {
  getGroupKey,
  makeLocationPointer,
  findItemInLayout,
  moveItemInLayout,
  getContainerItems,
} from "@/utils/mobileLayout";
import type { RepositionTarget } from "@/hooks/useRepositionMode";
import {
  collectAllContainerIds,
  collectSiblingBounds,
  computeInsertPositionByThreshold,
  containerIdEquals,
  findGroupHierarchicalKeyInLayout,
  findGroupSubgraphIdInLayout,
  isWithinContainerByBoundaryRows,
  itemRefToDataKey,
} from "@/components/RepositionOverlay/repositionGeometry";
import { useEdgeAutoScroll } from "@/components/RepositionOverlay/useEdgeAutoScroll";

const DRAG_THRESHOLD = 5;
const OVERLAP_THRESHOLD_RATIO = 0.625; // 5/8 overlap trigger
const EDGE_SCROLL_ZONE_RATIO = 1 / 6;

export interface PendingDrag {
  pointerId: number;
  startX: number;
  startY: number;
  origIndex: number;
  containerId: ContainerId;
  targetKey: string;
  targetRef: ItemRef;
  target: RepositionTarget;
  allGroupKeys: string[];
  allSubgraphIds: string[];
  crossContainerEnabled: boolean;
  disallowedGroupKeys: Set<string>;
  disallowedSubgraphIds: Set<string>;
}

export interface DragVisualState {
  targetKey: string;
  sourceContainer: ContainerId;
  sourceIndex: number;
  hoverContainer: ContainerId;
  insertIndex: number;
  placeholderHeight: number;
}

interface UseDragEngineParams {
  scopeSubgraphId: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  workingLayout: MobileLayout;
  setWorkingLayout: Dispatch<SetStateAction<MobileLayout>>;
  collapsedItems: Record<string, boolean>;
  setCollapsedItems: Dispatch<SetStateAction<Record<string, boolean>>>;
  setCurrentTarget: Dispatch<SetStateAction<RepositionTarget>>;
  targetDataKey: string;
  dataKeyToTarget: (
    key: string,
  ) => { target: RepositionTarget; itemRef: ItemRef } | null;
  toStableStateKey: (pointer: string) => string;
  suppressNextTargetScrollRef: RefObject<boolean>;
}

/**
 * The reposition overlay's pointer-drag state machine: arm-on-touch, threshold
 * detection, fixed-layer dragging, cross-container hover detection + hover-to-
 * expand, insert-index computation, and commit-on-drop. Owns the edge auto-
 * scroll (useEdgeAutoScroll) since that depends on the live drag state.
 *
 * workingLayout / collapsedItems / currentTarget are owned by the component
 * (the render and data maps read them); this hook reads and updates them via
 * the passed setters.
 */
export function useDragEngine({
  scopeSubgraphId,
  scrollContainerRef,
  workingLayout,
  setWorkingLayout,
  collapsedItems,
  setCollapsedItems,
  setCurrentTarget,
  targetDataKey,
  dataKeyToTarget,
  toStableStateKey,
  suppressNextTargetScrollRef,
}: UseDragEngineParams) {
  const [isDragging, setIsDragging] = useState(false);
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);
  const [isPointerArmedForDrag, setIsPointerArmedForDrag] = useState(false);
  const [dragVisual, setDragVisual] = useState<DragVisualState | null>(null);

  const pendingDragRef = useRef<PendingDrag | null>(null);
  const dragDeltaRef = useRef(0);
  const dragXRef = useRef(0);
  const lastPointerYRef = useRef(0);
  const dragDirectionDownRef = useRef(true);
  const insertIndexRef = useRef(-1);
  const hoverContainerRef = useRef<ContainerId | null>(null);
  const dragBaseTopRef = useRef(0);
  const dragBaseLeftRef = useRef(0);
  const dragHeightRef = useRef(0);
  const lastMovedTargetRef = useRef<RepositionTarget | null>(null);

  const { startAutoScroll, stopAutoScroll } = useEdgeAutoScroll(
    scrollContainerRef,
    pendingDragRef,
    isDragging,
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const touchedItemEl = (e.target as HTMLElement).closest(
        "[data-reposition-item]",
      ) as HTMLElement | null;
      const touchedItemKey = touchedItemEl?.dataset.repositionItem ?? null;
      const handle = (e.target as HTMLElement).closest(
        "[data-reposition-handle]",
      ) as HTMLElement | null;
      const handleKey = handle?.dataset.repositionHandle ?? null;

      // Handle always selects/starts drag for that item.
      // Otherwise, touching the active target card itself starts dragging that target.
      const dragKey =
        handleKey ?? (touchedItemKey === targetDataKey ? targetDataKey : null);
      if (!dragKey) return;

      const parsed = dataKeyToTarget(dragKey);
      if (!parsed) return;

      const location = findItemInLayout(workingLayout, parsed.itemRef);
      if (!location) return;

      // Prevent browser scroll gesture so pointer events keep firing
      e.preventDefault();

      // Switch target if touching a different item's handle
      if (dragKey !== targetDataKey) {
        const target = parsed.target;
        if (target.type === "group") {
          const groupHierarchicalKey = findGroupHierarchicalKeyInLayout(
            workingLayout,
            target.id,
            target.subgraphId ?? null
          );
          if (!groupHierarchicalKey) return;
          setCollapsedItems((prev) => ({
            ...prev,
            [groupHierarchicalKey]: true,
          }));
        } else if (target.type === "subgraph") {
          const subgraphId = target.id;
          setCollapsedItems((prev) => ({
            ...prev,
            [toStableStateKey(
              makeLocationPointer({ type: "subgraph", subgraphId }),
            )]: true,
          }));
        }
        suppressNextTargetScrollRef.current = true;
        setCurrentTarget(parsed.target);
      }

      // Nodes and groups can cross containers; subgraphs reorder within their parent.
      const crossContainerEnabled =
        parsed.itemRef.type === "node" || parsed.itemRef.type === "group";
      const allContainers = crossContainerEnabled
        ? collectAllContainerIds(workingLayout)
        : { groupKeys: [], subgraphIds: [] };

      const disallowedGroupKeys = new Set<string>();
      const disallowedSubgraphIds = new Set<string>();
      if (parsed.itemRef.type === "group") {
        const walkItems = (items: ItemRef[]) => {
          for (const ref of items) {
            if (ref.type === "group") {
              if (!disallowedGroupKeys.has(getGroupKey(ref.id, ref.subgraphId))) {
                disallowedGroupKeys.add(getGroupKey(ref.id, ref.subgraphId));
                walkItems(workingLayout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? []);
              }
              continue;
            }
            if (ref.type === "subgraph") {
              if (!disallowedSubgraphIds.has(ref.id)) {
                disallowedSubgraphIds.add(ref.id);
                walkItems(workingLayout.subgraphs[ref.id] ?? []);
              }
            }
          }
        };

        disallowedGroupKeys.add(parsed.itemRef.itemKey);
        walkItems(workingLayout.groups[parsed.itemRef.itemKey] ?? []);
      }

      pendingDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origIndex: location.index,
        containerId: location.containerId,
        targetKey: dragKey,
        targetRef: parsed.itemRef,
        target: parsed.target,
        allGroupKeys: allContainers.groupKeys,
        allSubgraphIds: allContainers.subgraphIds,
        crossContainerEnabled,
        disallowedGroupKeys,
        disallowedSubgraphIds,
      };
      dragDeltaRef.current = 0;
      insertIndexRef.current = location.index;
      hoverContainerRef.current = location.containerId;
      lastPointerYRef.current = e.clientY;
      dragDirectionDownRef.current = true;
      setIsPointerArmedForDrag(true);
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.touchAction = "none";
      }
    },
    [
      workingLayout,
      targetDataKey,
      dataKeyToTarget,
      toStableStateKey,
      setCollapsedItems,
      setCurrentTarget,
      suppressNextTargetScrollRef,
      scrollContainerRef,
    ],
  );

  const detectHoverContainer = useCallback(
    (
      container: HTMLDivElement,
      pending: PendingDrag,
      draggedRect: DOMRect,
      movingDown: boolean,
    ): ContainerId => {
      if (!pending.crossContainerEnabled) {
        return pending.containerId;
      }
      const defaultContainer: ContainerId = scopeSubgraphId
        ? { scope: "subgraph", subgraphId: scopeSubgraphId }
        : { scope: "root" };
      let hoverContainer: ContainerId = defaultContainer;
      let bestArea = Infinity;

      for (const groupKey of pending.allGroupKeys) {
        if (pending.targetRef.type === "group" && pending.targetRef.itemKey === groupKey)
          continue;
        if (pending.disallowedGroupKeys.has(groupKey)) continue;
        if (collapsedItems[groupKey] ?? false) continue;
        const groupDataKey = `group-${groupKey}`;
        const groupEl = container.querySelector(
          `[data-reposition-item="${groupDataKey}"]`,
        ) as HTMLElement | null;
        if (!groupEl) continue;
        const rect = groupEl.getBoundingClientRect();
        const headerEl = groupEl.querySelector(
          `[data-reposition-header="${groupDataKey}"]`,
        ) as HTMLElement | null;
        const footerEl = groupEl.querySelector(
          `[data-reposition-footer="${groupDataKey}"]`,
        ) as HTMLElement | null;
        const headerRect = headerEl?.getBoundingClientRect() ?? null;
        const footerRect = footerEl?.getBoundingClientRect() ?? null;
        if (
          !isWithinContainerByBoundaryRows(
            draggedRect,
            rect,
            headerRect,
            footerRect,
            movingDown,
            OVERLAP_THRESHOLD_RATIO,
          )
        ) {
          continue;
        }
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          hoverContainer = { scope: "group", groupKey };
        }
      }

      for (const subgraphId of pending.allSubgraphIds) {
        if (
          pending.targetRef.type === "subgraph" &&
          pending.targetRef.id === subgraphId
        )
          continue;
        if (pending.disallowedSubgraphIds.has(subgraphId)) continue;
        if (
          collapsedItems[
            toStableStateKey(makeLocationPointer({ type: "subgraph", subgraphId }))
          ] ??
          false
        ) {
          continue;
        }
        const sgEl = container.querySelector(
          `[data-reposition-item="subgraph-${subgraphId}"]`,
        ) as HTMLElement | null;
        if (!sgEl) continue;
        const rect = sgEl.getBoundingClientRect();
        const headerEl = sgEl.querySelector(
          `[data-reposition-header="subgraph-${subgraphId}"]`,
        ) as HTMLElement | null;
        const footerEl = sgEl.querySelector(
          `[data-reposition-footer="subgraph-${subgraphId}"]`,
        ) as HTMLElement | null;
        const headerRect = headerEl?.getBoundingClientRect() ?? null;
        const footerRect = footerEl?.getBoundingClientRect() ?? null;
        if (
          !isWithinContainerByBoundaryRows(
            draggedRect,
            rect,
            headerRect,
            footerRect,
            movingDown,
            OVERLAP_THRESHOLD_RATIO,
          )
        ) {
          continue;
        }
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          hoverContainer = { scope: "subgraph", subgraphId };
        }
      }

      return hoverContainer;
    },
    [collapsedItems, toStableStateKey, scopeSubgraphId],
  );

  const computeInsertIndex = useCallback(
    (
      container: HTMLDivElement,
      pending: PendingDrag,
      hoverContainer: ContainerId,
      draggedRect: DOMRect,
      movingDown: boolean,
    ): number => {
      const hoverItems = getContainerItems(workingLayout, hoverContainer);
      const hoverKeys = hoverItems.map(itemRefToDataKey);
      const isSameContainer = containerIdEquals(
        hoverContainer,
        pending.containerId,
      );

      if (isSameContainer) {
        // Same-container reordering should be based on current sibling geometry,
        // not anchored to the original drag start index, so direction reversals stay smooth.
        const siblingKeys = hoverKeys.filter(
          (key) => key !== pending.targetKey,
        );
        const siblings = collectSiblingBounds(container, siblingKeys);
        const insertPosWithoutTarget = computeInsertPositionByThreshold(
          siblings,
          movingDown,
          draggedRect.top,
          draggedRect.bottom,
          OVERLAP_THRESHOLD_RATIO,
        );
        // Convert sibling-position index back into full container index (which still includes target).
        return insertPosWithoutTarget <= pending.origIndex
          ? insertPosWithoutTarget
          : insertPosWithoutTarget + 1;
      }

      const siblings = collectSiblingBounds(container, hoverKeys);
      return computeInsertPositionByThreshold(
        siblings,
        movingDown,
        draggedRect.top,
        draggedRect.bottom,
        OVERLAP_THRESHOLD_RATIO,
      );
    },
    [workingLayout],
  );

  const updateDragVisualState = useCallback(
    (
      pending: PendingDrag,
      hoverContainer: ContainerId,
      insertIndex: number,
      placeholderHeight: number,
    ) => {
      setDragVisual((prev) => {
        const next: DragVisualState = {
          targetKey: pending.targetKey,
          sourceContainer: pending.containerId,
          sourceIndex: pending.origIndex,
          hoverContainer,
          insertIndex,
          placeholderHeight,
        };
        if (
          prev &&
          prev.targetKey === next.targetKey &&
          containerIdEquals(prev.sourceContainer, next.sourceContainer) &&
          prev.sourceIndex === next.sourceIndex &&
          containerIdEquals(prev.hoverContainer, next.hoverContainer) &&
          prev.insertIndex === next.insertIndex &&
          prev.placeholderHeight === next.placeholderHeight
        ) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pending = pendingDragRef.current;
      if (!pending) return;
      if (e.pointerId !== pending.pointerId) return;

      const dy = e.clientY - pending.startY;
      const dx = e.clientX - pending.startX;

      // If not yet dragging, check threshold (vertical only)
      if (!isDragging) {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > DRAG_THRESHOLD) {
          pendingDragRef.current = null;
          stopAutoScroll();
          setIsPointerArmedForDrag(false);
          if (scrollContainerRef.current) {
            scrollContainerRef.current.style.touchAction = "";
          }
          return;
        }
        if (Math.abs(dy) < DRAG_THRESHOLD) return;
        setIsDragging(true);
        const container = scrollContainerRef.current;
        if (container) {
          const startEl = container.querySelector(
            `[data-reposition-item="${pending.targetKey}"]`,
          ) as HTMLElement | null;
          if (startEl) {
            const rect = startEl.getBoundingClientRect();
            dragBaseTopRef.current = rect.top;
            dragBaseLeftRef.current = rect.left;
            // Use layout box height (not transformed bounds) so placeholder matches row size.
            dragHeightRef.current = startEl.offsetHeight || rect.height;
            startEl.style.position = "fixed";
            startEl.style.top = `${rect.top}px`;
            startEl.style.left = `${rect.left}px`;
            startEl.style.width = `${rect.width}px`;
            startEl.style.zIndex = "70";
            startEl.style.pointerEvents = "none";
            setDragVisual({
              targetKey: pending.targetKey,
              sourceContainer: pending.containerId,
              sourceIndex: pending.origIndex,
              hoverContainer: pending.containerId,
              insertIndex: pending.origIndex,
              placeholderHeight: dragHeightRef.current,
            });
          }
        }
        try {
          scrollContainerRef.current?.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        lastPointerYRef.current = e.clientY;
        dragDirectionDownRef.current = dy >= 0;
        // Let React render the source placeholder before running overlap thresholds.
        // Without this, the first sibling can appear to jump immediately because the target
        // has been taken out of flow but the placeholder has not committed yet.
        return;
      }

      dragDeltaRef.current = dy;
      dragXRef.current = dx;

      const container = scrollContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const zoneHeight = containerRect.height * EDGE_SCROLL_ZONE_RATIO;
      const topZoneBottom = containerRect.top + zoneHeight;
      const bottomZoneTop = containerRect.bottom - zoneHeight;
      if (e.clientY <= topZoneBottom) {
        startAutoScroll(-1);
      } else if (e.clientY >= bottomZoneTop) {
        startAutoScroll(1);
      } else {
        stopAutoScroll();
      }

      // Keep dragged element in a fixed layer so it does not move with reflowing containers.
      const el = container.querySelector(
        `[data-reposition-item="${pending.targetKey}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.style.top = `${dragBaseTopRef.current + dy}px`;
        el.style.left = `${dragBaseLeftRef.current}px`;
      }

      const draggedRect = el?.getBoundingClientRect();
      if (!draggedRect) return;
      const draggedHeight =
        dragHeightRef.current || el?.offsetHeight || draggedRect.height;
      const frameDeltaY = e.clientY - lastPointerYRef.current;
      if (frameDeltaY !== 0) {
        dragDirectionDownRef.current = frameDeltaY > 0;
      }
      const movingDown = dragDirectionDownRef.current;
      lastPointerYRef.current = e.clientY;

      const hoverContainer = detectHoverContainer(
        container,
        pending,
        draggedRect,
        movingDown,
      );

      hoverContainerRef.current = hoverContainer;

      const isSameContainer = containerIdEquals(
        hoverContainer,
        pending.containerId,
      );

      // Update hover highlight (only for cross-container)
      setHoverGroupId(
        !isSameContainer && hoverContainer.scope === "group"
          ? (hoverContainer as { scope: "group"; groupKey: string }).groupKey
          : null,
      );
      insertIndexRef.current = computeInsertIndex(
        container,
        pending,
        hoverContainer,
        draggedRect,
        movingDown,
      );
      updateDragVisualState(
        pending,
        hoverContainer,
        insertIndexRef.current,
        draggedHeight,
      );
    },
    [
      isDragging,
      detectHoverContainer,
      computeInsertIndex,
      updateDragVisualState,
      startAutoScroll,
      stopAutoScroll,
      scrollContainerRef,
    ],
  );

  const clearAllTransforms = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const allItems = container.querySelectorAll<HTMLElement>(
      "[data-reposition-item]",
    );
    allItems.forEach((el) => {
      el.style.transform = "";
      el.style.zIndex = "";
      el.style.position = "";
      el.style.top = "";
      el.style.left = "";
      el.style.width = "";
      el.style.pointerEvents = "";
      el.style.transition = "";
      el.style.marginTop = "";
    });
  }, [scrollContainerRef]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pending = pendingDragRef.current;
      if (!pending) return;
      if (e.pointerId !== pending.pointerId) return;

      if (isDragging) {
        stopAutoScroll();
        try {
          scrollContainerRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        clearAllTransforms();

        const hoverContainer = hoverContainerRef.current ?? pending.containerId;
        const insertIdx = insertIndexRef.current;
        const isSameContainer = containerIdEquals(
          hoverContainer,
          pending.containerId,
        );

        // Commit if position or container changed
        if (!isSameContainer || insertIdx !== pending.origIndex) {
          const nextLayout = moveItemInLayout(
            workingLayout,
            pending.targetRef,
            pending.containerId,
            pending.origIndex,
            hoverContainer,
            insertIdx,
          );
          setWorkingLayout(nextLayout);
          if (pending.target.type === "group" && pending.targetRef.type === "group") {
            const nextSubgraphId = findGroupSubgraphIdInLayout(
              nextLayout,
              pending.targetRef.itemKey
            );
            const nextTarget: RepositionTarget = {
              type: "group",
              id: pending.target.id,
              subgraphId: nextSubgraphId
            };
            suppressNextTargetScrollRef.current = true;
            setCurrentTarget(nextTarget);
            lastMovedTargetRef.current = nextTarget;
          } else {
            lastMovedTargetRef.current = pending.target;
          }
        }

        setIsDragging(false);
        setHoverGroupId(null);
        setDragVisual(null);
      }

      pendingDragRef.current = null;
      stopAutoScroll();
      dragDeltaRef.current = 0;
      dragXRef.current = 0;
      insertIndexRef.current = -1;
      hoverContainerRef.current = null;
      dragBaseTopRef.current = 0;
      dragBaseLeftRef.current = 0;
      dragHeightRef.current = 0;
      lastPointerYRef.current = 0;
      dragDirectionDownRef.current = true;
      setIsPointerArmedForDrag(false);
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.touchAction = "";
      }
    },
    [
      isDragging,
      workingLayout,
      clearAllTransforms,
      stopAutoScroll,
      setWorkingLayout,
      setCurrentTarget,
      suppressNextTargetScrollRef,
      scrollContainerRef,
    ],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pending = pendingDragRef.current;
      if (!pending) return;
      if (isDragging) {
        stopAutoScroll();
        try {
          scrollContainerRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        clearAllTransforms();
        setIsDragging(false);
        setHoverGroupId(null);
        setDragVisual(null);
      }
      pendingDragRef.current = null;
      stopAutoScroll();
      dragDeltaRef.current = 0;
      dragXRef.current = 0;
      insertIndexRef.current = -1;
      hoverContainerRef.current = null;
      dragBaseTopRef.current = 0;
      dragBaseLeftRef.current = 0;
      dragHeightRef.current = 0;
      lastPointerYRef.current = 0;
      dragDirectionDownRef.current = true;
      setIsPointerArmedForDrag(false);
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.touchAction = "";
      }
    },
    [isDragging, clearAllTransforms, stopAutoScroll, scrollContainerRef],
  );

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  return {
    isDragging,
    isPointerArmedForDrag,
    hoverGroupId,
    dragVisual,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    lastMovedTargetRef,
  };
}
