import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  RepositionTarget,
  RepositionViewportAnchor,
} from "@/hooks/useRepositionMode";
import type {
  WorkflowNode,
  WorkflowGroup,
  WorkflowSubgraphDefinition,
} from "@/api/types";
import type { MobileLayout, ItemRef, ContainerId } from "@/utils/mobileLayout";
import {
  getGroupKey,
  makeLocationPointer,
  findItemInLayout,
  moveItemInLayout,
  getContainerItems,
} from "@/utils/mobileLayout";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import {
  findConnectedNode,
  findConnectedOutputNodes,
} from "@/utils/nodeOrdering";
import {
  DragPlaceholder,
} from "@/components/RepositionOverlay/DragPlaceholder";
import { ContainerItemCard } from "@/components/RepositionOverlay/ContainerItemCard";
import { HiddenBlockItem } from "@/components/RepositionOverlay/HiddenBlockItem";
import { NodeItemCard } from "@/components/RepositionOverlay/NodeItemCard";
import { FullscreenModalActions } from "@/components/modals/FullscreenModalActions";
import { RepositionOverlayTopBar } from "@/components/RepositionOverlay/TopBar";
import { RepositionScrollContainer } from "@/components/RepositionOverlay/RepositionScrollContainer";
import { WorkflowIcon } from "@/components/icons";
import { themeColors } from "@/theme/colors";
import { resolveWorkflowColor } from "@/theme/colors";
import { hexToRgba } from "@/utils/grouping";

interface RepositionOverlayProps {
  mobileLayout: MobileLayout;
  /** When navigated into a subgraph, pass its ID so the overlay renders scoped items. */
  scopeSubgraphId?: string | null;
  initialTarget: RepositionTarget;
  initialViewportAnchor?: RepositionViewportAnchor | null;
  onDone: (
    newLayout: MobileLayout,
    scrollTarget: RepositionTarget,
    viewportAnchor?: RepositionViewportAnchor | null
  ) => void;
  onCancel: () => void;
}

function findGroupHierarchicalKeyInLayout(
  layout: MobileLayout,
  groupId: number,
  subgraphId: string | null
): string | null {
  let firstMatch: string | null = null;
  const visit = (refs: ItemRef[], currentSubgraphId: string | null): string | null => {
    for (const ref of refs) {
      if (ref.type === "group") {
        if (ref.id === groupId && firstMatch == null) {
          firstMatch = getGroupKey(ref.id, ref.subgraphId);
        }
        if (ref.id === groupId && currentSubgraphId === subgraphId) {
          return getGroupKey(ref.id, ref.subgraphId);
        }
        const nested = visit(layout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
        if (nested) return nested;
        continue;
      }
      if (ref.type === "subgraph") {
        const nested = visit(layout.subgraphs[ref.id] ?? [], ref.id);
        if (nested) return nested;
      }
    }
    return null;
  };
  return visit(layout.root, null) ?? firstMatch;
}

function findGroupSubgraphIdByHierarchicalKey(
  layout: MobileLayout,
  groupHierarchicalKey: string
): string | null {
  const parent = layout.groupParents?.[groupHierarchicalKey];
  if (!parent) {
    const visit = (refs: ItemRef[], currentSubgraphId: string | null): string | null => {
      for (const ref of refs) {
        if (ref.type === "group") {
          if (getGroupKey(ref.id, ref.subgraphId) === groupHierarchicalKey) return currentSubgraphId;
          const nested = visit(layout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
          if (nested !== null) return nested;
          continue;
        }
        if (ref.type === "subgraph") {
          const nested = visit(layout.subgraphs[ref.id] ?? [], ref.id);
          if (nested !== null) return nested;
        }
      }
      return null;
    };
    return visit(layout.root, null);
  }
  if (parent.scope === "subgraph") return parent.subgraphId;
  if (parent.scope === "root") return null;
  return findGroupSubgraphIdByHierarchicalKey(layout, parent.groupKey);
}

function targetToDataKey(target: RepositionTarget, layout?: MobileLayout): string {
  if (target.type === "node") return `node-${target.id}`;
  if (target.type === "group") {
    const groupKey = layout
      ? findGroupHierarchicalKeyInLayout(layout, target.id, target.subgraphId ?? null)
      : null;
    if (groupKey) return `group-${groupKey}`;
    return `group-${makeLocationPointer({
      type: "group",
      groupId: target.id,
      subgraphId: target.subgraphId ?? null,
    })}`;
  }
  return `subgraph-${target.id}`;
}

function itemRefToDataKey(ref: ItemRef): string {
  if (ref.type === "node") return `node-${ref.id}`;
  if (ref.type === "group") return `group-${getGroupKey(ref.id, ref.subgraphId)}`;
  if (ref.type === "subgraph") return `subgraph-${ref.id}`;
  return `hidden-${ref.blockId}`;
}

function containerIdEquals(a: ContainerId, b: ContainerId): boolean {
  if (a.scope !== b.scope) return false;
  if (a.scope === "root") return true;
  if (a.scope === "group" && b.scope === "group") return a.groupKey === b.groupKey;
  if (a.scope === "subgraph" && b.scope === "subgraph")
    return a.subgraphId === b.subgraphId;
  return false;
}

function containerIdToKey(c: ContainerId): string {
  if (c.scope === "root") return "root";
  if (c.scope === "group") return `group-${c.groupKey}`;
  return `subgraph-${c.subgraphId}`;
}

/** Collect all group and subgraph container IDs from the layout. */
function collectAllContainerIds(layout: MobileLayout): {
  groupKeys: string[];
  subgraphIds: string[];
} {
  return {
    groupKeys: Object.keys(layout.groups),
    subgraphIds: Object.keys(layout.subgraphs),
  };
}

interface IndexedBounds {
  idx: number;
  top: number;
  bottom: number;
  height: number;
}

function collectSiblingBounds(
  container: HTMLElement,
  itemKeys: string[],
  excludedKey?: string,
): IndexedBounds[] {
  const siblings: IndexedBounds[] = [];
  itemKeys.forEach((key, idx) => {
    if (key === excludedKey) return;
    const el = container.querySelector(
      `[data-reposition-item="${key}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    siblings.push({
      idx,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
    });
  });
  return siblings;
}

function isContainerEnteredByDrag(
  draggedRect: DOMRect,
  containerRect: DOMRect,
  thresholdRatio: number,
): boolean {
  const overlapTop = Math.max(draggedRect.top, containerRect.top);
  const overlapBottom = Math.min(draggedRect.bottom, containerRect.bottom);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);
  return overlapHeight >= draggedRect.height * thresholdRatio;
}

function isWithinContainerByBoundaryRows(
  draggedRect: DOMRect,
  containerRect: DOMRect,
  headerRect: DOMRect | null,
  footerRect: DOMRect | null,
  movingDown: boolean,
  thresholdRatio: number,
): boolean {
  const intersectsContainer =
    draggedRect.bottom >= containerRect.top &&
    draggedRect.top <= containerRect.bottom;
  if (!intersectsContainer) return false;

  // Fallback for containers without measurable boundary rows.
  if (!headerRect || !footerRect) {
    return isContainerEnteredByDrag(draggedRect, containerRect, thresholdRatio);
  }

  if (movingDown) {
    const enteredThroughHeader =
      draggedRect.bottom > headerRect.top + headerRect.height * thresholdRatio;
    const exitedThroughFooter =
      draggedRect.bottom > footerRect.top + footerRect.height * thresholdRatio;
    return enteredThroughHeader && !exitedThroughFooter;
  }

  const enteredThroughFooter =
    draggedRect.top < footerRect.bottom - footerRect.height * thresholdRatio;
  const exitedThroughHeader =
    draggedRect.top < headerRect.bottom - headerRect.height * thresholdRatio;
  return enteredThroughFooter && !exitedThroughHeader;
}

function computeInsertPositionByThreshold(
  siblings: IndexedBounds[],
  movingDown: boolean,
  draggedTop: number,
  draggedBottom: number,
  thresholdRatio: number,
): number {
  if (siblings.length === 0) return 0;
  if (movingDown) {
    let insertAt = 0;
    for (const sibling of siblings) {
      const passThreshold = sibling.top + sibling.height * thresholdRatio;
      if (draggedBottom > passThreshold) {
        insertAt = sibling.idx + 1;
        continue;
      }
      break;
    }
    return insertAt;
  }
  let insertAt = siblings.length;
  for (let i = siblings.length - 1; i >= 0; i -= 1) {
    const sibling = siblings[i];
    const passThreshold = sibling.bottom - sibling.height * thresholdRatio;
    if (draggedTop < passThreshold) {
      insertAt = sibling.idx;
      continue;
    }
    break;
  }
  return insertAt;
}

const DRAG_THRESHOLD = 5;
const OVERLAP_THRESHOLD_RATIO = 0.625; // 5/8 overlap trigger
const EDGE_SCROLL_ZONE_RATIO = 1 / 6;
const EDGE_SCROLL_SLOW_PX_PER_SEC = 120;
const EDGE_SCROLL_FAST_PX_PER_SEC = 640;
const EDGE_SCROLL_ACCEL_DELAY_MS = 350;
const EDGE_SCROLL_ACCEL_DURATION_MS = 300;
const INPUT_HIGHLIGHT_COLOR = themeColors.status.success;
const OUTPUT_HIGHLIGHT_COLOR = themeColors.status.warning;
const CONNECTED_NODE_BORDER_COLOR = themeColors.status.danger;
const TARGET_BORDER_BLUE = themeColors.brand.blue500;

interface PendingDrag {
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

interface DragVisualState {
  targetKey: string;
  sourceContainer: ContainerId;
  sourceIndex: number;
  hoverContainer: ContainerId;
  insertIndex: number;
  placeholderHeight: number;
}

export function RepositionOverlay({
  mobileLayout,
  scopeSubgraphId = null,
  initialTarget,
  initialViewportAnchor = null,
  onDone,
  onCancel,
}: RepositionOverlayProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const workflowCollapsedItems = useWorkflowStore((s) => s.collapsedItems);
  const itemKeyByPointer = useWorkflowStore((s) => s.itemKeyByPointer);
  const nodeErrors = useWorkflowErrorsStore((s) => s.nodeErrors);
  const toStableStateKey = useCallback(
    (pointer: string) => itemKeyByPointer[pointer] ?? pointer,
    [itemKeyByPointer],
  );

  const [workingLayout, setWorkingLayout] = useState<MobileLayout>(() =>
    JSON.parse(JSON.stringify(mobileLayout)),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [currentTarget, setCurrentTarget] =
    useState<RepositionTarget>(initialTarget);
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);
  const [isPointerArmedForDrag, setIsPointerArmedForDrag] = useState(false);

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
  const hoverExpandTimeoutRef = useRef<number | null>(null);
  const hoverExpandKeyRef = useRef<string | null>(null);
  const lastMovedTargetRef = useRef<RepositionTarget | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollDirectionRef = useRef<-1 | 1 | null>(null);
  const autoScrollZoneEnteredAtRef = useRef(0);
  const autoScrollLastFrameAtRef = useRef(0);
  const suppressNextTargetScrollRef = useRef(false);
  const hasCompletedInitialTargetScrollRef = useRef(false);
  const hasAppliedEntryAnchorRef = useRef(false);
  const highlightTimeoutRef = useRef<number | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>(
    () => {
      const next = { ...(workflowCollapsedItems ?? {}) };
      if (initialTarget.type === "group") {
        const groupHierarchicalKey = findGroupHierarchicalKeyInLayout(
          mobileLayout,
          initialTarget.id,
          initialTarget.subgraphId ?? null
        );
        if (groupHierarchicalKey) {
          next[groupHierarchicalKey] = true;
        }
      }
      if (initialTarget.type === "subgraph") {
        next[
          toStableStateKey(
            makeLocationPointer({ type: "subgraph", subgraphId: initialTarget.id }),
          )
        ] = true;
      }
      return next;
    },
  );
  const [connectionHighlightTargetKey, setConnectionHighlightTargetKey] =
    useState<string | null>(null);
  const [dragVisual, setDragVisual] = useState<DragVisualState | null>(null);
  const workingLayoutRef = useRef(workingLayout);
  useEffect(() => {
    workingLayoutRef.current = workingLayout;
  }, [workingLayout]);

  const targetDataKey = useMemo(
    () => targetToDataKey(currentTarget, workingLayout),
    [currentTarget, workingLayout]
  );
  const connectionHighlightEnabled =
    connectionHighlightTargetKey === targetDataKey;

  const targetAncestors = useMemo(() => {
    const targetRef: ItemRef | null =
      currentTarget.type === "node"
        ? { type: "node", id: currentTarget.id }
        : currentTarget.type === "group"
          ? (() => {
              const itemKey = findGroupHierarchicalKeyInLayout(
                workingLayout,
                currentTarget.id,
                currentTarget.subgraphId ?? null
              );
              if (!itemKey) return null;
              return {
                type: "group" as const,
                id: currentTarget.id,
                subgraphId: currentTarget.subgraphId ?? null,
                itemKey,
              };
            })()
          : { type: "subgraph", id: currentTarget.id };
    if (!targetRef) {
      return {
        groupIds: new Set<string>(),
        subgraphIds: new Set<string>(),
      };
    }

    const itemEquals = (a: ItemRef, b: ItemRef): boolean => {
      if (a.type !== b.type) return false;
      if (a.type === "node" && b.type === "node") return a.id === b.id;
      if (a.type === "group" && b.type === "group") return a.itemKey === b.itemKey;
      if (a.type === "subgraph" && b.type === "subgraph") return a.id === b.id;
      if (a.type === "hiddenBlock" && b.type === "hiddenBlock")
        return a.blockId === b.blockId;
      return false;
    };

    const visit = (
      items: ItemRef[],
      groupTrail: string[],
      subgraphTrail: string[],
    ): { groupIds: Set<string>; subgraphIds: Set<string> } | null => {
      for (const ref of items) {
        if (itemEquals(ref, targetRef)) {
          return {
            groupIds: new Set(groupTrail),
            subgraphIds: new Set(subgraphTrail),
          };
        }
        if (ref.type === "group") {
          const found = visit(
            workingLayout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [],
            [...groupTrail, getGroupKey(ref.id, ref.subgraphId)],
            subgraphTrail,
          );
          if (found) return found;
        } else if (ref.type === "subgraph") {
          const found = visit(
            workingLayout.subgraphs[ref.id] ?? [],
            groupTrail,
            [...subgraphTrail, ref.id],
          );
          if (found) return found;
        }
      }
      return null;
    };

    return (
      visit(workingLayout.root, [], []) ?? {
        groupIds: new Set<string>(),
        subgraphIds: new Set<string>(),
      }
    );
  }, [workingLayout, currentTarget]);

  const connectionContext = useMemo(() => {
    if (!workflow || currentTarget.type !== "node") {
      return {
        hasConnections: false,
        hasUpstream: false,
        hasDownstream: false,
        leftLineCount: 0,
        rightLineCount: 0,
        upstreamNodeIds: new Set<number>(),
        downstreamNodeIds: new Set<number>(),
      };
    }

    const node = workflow.nodes.find((n) => n.id === currentTarget.id);
    if (!node) {
      return {
        hasConnections: false,
        hasUpstream: false,
        hasDownstream: false,
        leftLineCount: 0,
        rightLineCount: 0,
        upstreamNodeIds: new Set<number>(),
        downstreamNodeIds: new Set<number>(),
      };
    }

    const upstreamNodeIds = new Set<number>();
    node.inputs.forEach((input, inputIndex) => {
      if (input.link == null) return;
      const source = findConnectedNode(workflow, node.id, inputIndex);
      if (source) upstreamNodeIds.add(source.node.id);
    });

    const downstreamNodeIds = new Set<number>();
    node.outputs.forEach((output, outputIndex) => {
      if (!output.links || output.links.length === 0) return;
      const targets = findConnectedOutputNodes(workflow, node.id, outputIndex);
      for (const target of targets) downstreamNodeIds.add(target.node.id);
    });

    upstreamNodeIds.delete(node.id);
    downstreamNodeIds.delete(node.id);

    const leftLineCount = node.inputs.filter(
      (input) => input.link != null,
    ).length;
    const rightLineCount = node.outputs.reduce(
      (count, output) => count + (output.links?.length ?? 0),
      0,
    );

    return {
      hasConnections: leftLineCount > 0 || rightLineCount > 0,
      hasUpstream: upstreamNodeIds.size > 0,
      hasDownstream: downstreamNodeIds.size > 0,
      leftLineCount: Math.min(3, leftLineCount),
      rightLineCount: Math.min(3, rightLineCount),
      upstreamNodeIds,
      downstreamNodeIds,
    };
  }, [workflow, currentTarget]);

  const nodeMap = useMemo(
    () => {
      const map = new Map<number, WorkflowNode>(
        (workflow?.nodes ?? []).map((n) => [n.id, n]),
      );
      // When scoped into a subgraph, include its inner nodes (they may shadow root IDs)
      if (scopeSubgraphId) {
        const sg = workflow?.definitions?.subgraphs?.find((s) => s.id === scopeSubgraphId);
        for (const node of sg?.nodes ?? []) {
          map.set(node.id, node);
        }
      }
      return map;
    },
    [workflow, scopeSubgraphId],
  );
  const groupMap = useMemo(() => {
    const rootMap = new Map<number, WorkflowGroup>();
    for (const g of workflow?.groups ?? []) {
      rootMap.set(g.id, g);
    }
    const bySubgraph = new Map<string, Map<number, WorkflowGroup>>();
    for (const sg of workflow?.definitions?.subgraphs ?? []) {
      const sgMap = new Map<number, WorkflowGroup>();
      for (const g of sg.groups ?? []) {
        sgMap.set(g.id, g);
      }
      bySubgraph.set(sg.id, sgMap);
    }
    return { rootMap, bySubgraph };
  }, [workflow]);
  const groupByHierarchicalKey = useMemo(() => {
    const map = new Map<string, WorkflowGroup>();
    for (const group of workflow?.groups ?? []) {
      const itemKey = group.itemKey ?? `legacy-group-root-${group.id}`;
      map.set(itemKey, group);
    }
    for (const subgraph of workflow?.definitions?.subgraphs ?? []) {
      for (const group of subgraph.groups ?? []) {
        const itemKey =
          group.itemKey ?? `legacy-group-${subgraph.id}-${group.id}`;
        map.set(itemKey, group);
      }
    }
    return map;
  }, [workflow]);
  const subgraphMap = useMemo(
    () =>
      new Map<string, WorkflowSubgraphDefinition>(
        (workflow?.definitions?.subgraphs ?? []).map((sg) => [sg.id, sg]),
      ),
    [workflow],
  );
  const groupRefByHierarchicalKey = useMemo(() => {
    const map = new Map<string, { id: number; subgraphId: string | null }>();
    const visitedGroups = new Set<string>();
    const visitedSubgraphs = new Set<string>();
    const visit = (refs: ItemRef[], currentSubgraphId: string | null) => {
      for (const ref of refs) {
        if (ref.type === "group") {
          map.set(getGroupKey(ref.id, ref.subgraphId), { id: ref.id, subgraphId: currentSubgraphId });
          if (visitedGroups.has(getGroupKey(ref.id, ref.subgraphId))) continue;
          visitedGroups.add(getGroupKey(ref.id, ref.subgraphId));
          visit(workingLayout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
          continue;
        }
        if (ref.type === "subgraph") {
          if (visitedSubgraphs.has(ref.id)) continue;
          visitedSubgraphs.add(ref.id);
          visit(workingLayout.subgraphs[ref.id] ?? [], ref.id);
        }
      }
    };
    visit(workingLayout.root, null);
    return map;
  }, [workingLayout]);

  // Initial scroll + highlight
  useEffect(() => {
    const key = targetToDataKey(currentTarget, workingLayoutRef.current);
    let frameId: number | null = null;
    if (suppressNextTargetScrollRef.current) {
      suppressNextTargetScrollRef.current = false;
    } else {
      requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        const el = container?.querySelector<HTMLElement>(
          `[data-reposition-item="${key}"]`,
        );
        if (!el) return;
        const isFirstTargetScroll = !hasCompletedInitialTargetScrollRef.current;
        if (
          isFirstTargetScroll &&
          !hasAppliedEntryAnchorRef.current &&
          initialViewportAnchor &&
          container
        ) {
          const currentTop = el.getBoundingClientRect().top;
          const delta = currentTop - initialViewportAnchor.viewportTop;
          if (Math.abs(delta) > 0.5) {
            container.scrollTop += delta;
          }
          hasAppliedEntryAnchorRef.current = true;
          hasCompletedInitialTargetScrollRef.current = true;
          return;
        }
        const scrollBehavior: ScrollBehavior =
          isFirstTargetScroll ? "auto" : "smooth";
        el.scrollIntoView({ behavior: scrollBehavior, block: "center" });
        hasCompletedInitialTargetScrollRef.current = true;
      });
    }
    frameId = requestAnimationFrame(() => {
      setHighlightKey(key);
    });
    if (highlightTimeoutRef.current != null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightKey(null);
      highlightTimeoutRef.current = null;
    }, 1500);
    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (highlightTimeoutRef.current != null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, [currentTarget, initialViewportAnchor]);

  /** Parse a data key into a RepositionTarget. */
  const dataKeyToTarget = useCallback(
    (key: string): { target: RepositionTarget; itemRef: ItemRef } | null => {
      if (key.startsWith("node-")) {
        const id = parseInt(key.slice(5), 10);
        if (!Number.isFinite(id)) return null;
        return { target: { type: "node", id }, itemRef: { type: "node", id } };
      }
      if (key.startsWith("group-")) {
        const groupKey = key.slice(6);
        const ref = groupRefByHierarchicalKey.get(groupKey);
        if (!ref) return null;
        const { id, subgraphId } = ref;
        return {
          target: { type: "group", id, subgraphId },
          itemRef: { type: "group", id, subgraphId, itemKey: groupKey },
        };
      }
      if (key.startsWith("subgraph-")) {
        const id = key.slice(9);
        return {
          target: { type: "subgraph", id },
          itemRef: { type: "subgraph", id },
        };
      }
      return null;
    },
    [groupRefByHierarchicalKey],
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
    [workingLayout, targetDataKey, dataKeyToTarget, toStableStateKey],
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

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current != null) {
      window.cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    autoScrollDirectionRef.current = null;
    autoScrollZoneEnteredAtRef.current = 0;
    autoScrollLastFrameAtRef.current = 0;
  }, []);

  const startAutoScroll = useCallback(
    (direction: -1 | 1) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const now = performance.now();
      if (autoScrollDirectionRef.current !== direction) {
        autoScrollDirectionRef.current = direction;
        autoScrollZoneEnteredAtRef.current = now;
        autoScrollLastFrameAtRef.current = now;
      }

      if (autoScrollRafRef.current != null) return;

      const tick = (frameNow: number) => {
        const el = scrollContainerRef.current;
        const activeDirection = autoScrollDirectionRef.current;
        if (!el || activeDirection == null || !pendingDragRef.current || !isDragging) {
          autoScrollRafRef.current = null;
          return;
        }

        const lastFrame = autoScrollLastFrameAtRef.current || frameNow;
        const dtMs = Math.max(0, frameNow - lastFrame);
        autoScrollLastFrameAtRef.current = frameNow;

        const zoneElapsed = Math.max(
          0,
          frameNow - autoScrollZoneEnteredAtRef.current - EDGE_SCROLL_ACCEL_DELAY_MS,
        );
        const accelProgress =
          EDGE_SCROLL_ACCEL_DURATION_MS > 0
            ? Math.min(1, zoneElapsed / EDGE_SCROLL_ACCEL_DURATION_MS)
            : 1;
        const speedPxPerSec =
          EDGE_SCROLL_SLOW_PX_PER_SEC +
          (EDGE_SCROLL_FAST_PX_PER_SEC - EDGE_SCROLL_SLOW_PX_PER_SEC) *
            accelProgress;
        const deltaPx = (speedPxPerSec * dtMs) / 1000;

        const prevTop = el.scrollTop;
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        const nextTop = Math.max(
          0,
          Math.min(maxTop, prevTop + activeDirection * deltaPx),
        );
        el.scrollTop = nextTop;

        if (nextTop === prevTop) {
          autoScrollRafRef.current = null;
          return;
        }

        autoScrollRafRef.current = window.requestAnimationFrame(tick);
      };

      autoScrollRafRef.current = window.requestAnimationFrame(tick);
    },
    [isDragging],
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

      // Auto-expand collapsed hover containers after short delay.
      const hoverExpandKey =
        hoverContainer.scope === "group"
          ? `group-${hoverContainer.groupKey}`
          : hoverContainer.scope === "subgraph"
            ? `subgraph-${hoverContainer.subgraphId}`
            : null;
      const hoverIsCollapsed =
        hoverContainer.scope === "group"
          ? (collapsedItems[hoverContainer.groupKey] ?? false)
          : hoverContainer.scope === "subgraph"
            ? (collapsedItems[
                toStableStateKey(
                  makeLocationPointer({
                    type: "subgraph",
                    subgraphId: hoverContainer.subgraphId,
                  }),
                )
              ] ?? false)
            : false;

      if (hoverExpandKey && hoverIsCollapsed && !isSameContainer) {
        if (hoverExpandKeyRef.current !== hoverExpandKey) {
          if (hoverExpandTimeoutRef.current != null) {
            window.clearTimeout(hoverExpandTimeoutRef.current);
          }
          hoverExpandKeyRef.current = hoverExpandKey;
          hoverExpandTimeoutRef.current = window.setTimeout(() => {
            const current = hoverContainerRef.current;
            if (!current) return;
            if (current.scope === "group") {
              setCollapsedItems((prev) => ({
                ...prev,
                [current.groupKey]: false,
              }));
            } else if (current.scope === "subgraph") {
              setCollapsedItems((prev) => ({
                ...prev,
                [toStableStateKey(
                  makeLocationPointer({
                    type: "subgraph",
                    subgraphId: current.subgraphId,
                  }),
                )]: false,
              }));
            }
            hoverExpandTimeoutRef.current = null;
          }, 350);
        }
      } else if (hoverExpandTimeoutRef.current != null) {
        window.clearTimeout(hoverExpandTimeoutRef.current);
        hoverExpandTimeoutRef.current = null;
        hoverExpandKeyRef.current = null;
      }

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
      collapsedItems,
      toStableStateKey,
      startAutoScroll,
      stopAutoScroll,
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
  }, []);

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
        if (hoverExpandTimeoutRef.current != null) {
          window.clearTimeout(hoverExpandTimeoutRef.current);
          hoverExpandTimeoutRef.current = null;
        }
        hoverExpandKeyRef.current = null;

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
            const nextSubgraphId = findGroupSubgraphIdByHierarchicalKey(
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
    [isDragging, workingLayout, clearAllTransforms, stopAutoScroll],
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
        if (hoverExpandTimeoutRef.current != null) {
          window.clearTimeout(hoverExpandTimeoutRef.current);
          hoverExpandTimeoutRef.current = null;
        }
        hoverExpandKeyRef.current = null;
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
    [isDragging, clearAllTransforms, stopAutoScroll],
  );

  useEffect(() => {
    return () => {
      stopAutoScroll();
      if (hoverExpandTimeoutRef.current != null) {
        window.clearTimeout(hoverExpandTimeoutRef.current);
      }
    };
  }, [stopAutoScroll]);

  const handleDone = () => {
    const finalTarget = lastMovedTargetRef.current ?? currentTarget;
    const targetEl = scrollContainerRef.current?.querySelector<HTMLElement>(
      `[data-reposition-item="${targetToDataKey(finalTarget, workingLayout)}"]`,
    );
    const viewportAnchor = targetEl
      ? { viewportTop: targetEl.getBoundingClientRect().top }
      : null;
    onDone(workingLayout, finalTarget, viewportAnchor);
  };

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedItems((prev) => {
      const current = prev[groupKey] ?? false;
      return { ...prev, [groupKey]: !current };
    });
  };

  const getNodeDisplayName = (nodeId: number) => {
    const node = nodeMap.get(nodeId);
    if (!node) return `Node #${nodeId}`;
    const title =
      typeof (node as { title?: unknown }).title === "string" &&
      ((node as { title?: unknown }).title as string).trim()
        ? ((node as { title?: unknown }).title as string).trim()
        : null;
    return title || nodeTypes?.[node.type]?.display_name || node.type;
  };

  const getNodeBorderClass = (nodeId: number): string => {
    if (targetDataKey === `node-${nodeId}`) return "";
    const node = nodeMap.get(nodeId);
    if (!node) return "border-transparent";
    const hasErrors = nodeErrors[String(nodeId)]?.length > 0;
    if (hasErrors) return "border-red-700 shadow-red-200";
    const isExecuting = executingNodeId === String(nodeId);
    if (isExecuting) return "border-green-500 shadow-green-200";
    const isBypassed = node.mode === 4;
    if (isBypassed) return "border-purple-300";
    return "border-transparent";
  };

  const isNodeBypassed = (nodeId: number): boolean => {
    const node = nodeMap.get(nodeId);
    return node?.mode === 4;
  };

  const getNodeTintColor = (nodeId: number): string | undefined => {
    const node = nodeMap.get(nodeId);
    if (!node) return undefined;
    if (node.mode === 4) return undefined; // bypassed
    const hasErrors = nodeErrors[String(nodeId)]?.length > 0;
    if (hasErrors) return undefined;
    const isExecuting = executingNodeId === String(nodeId);
    if (isExecuting) return undefined;
    const rawColor = (typeof node.bgcolor === 'string' && node.bgcolor.trim())
      ? node.bgcolor.trim()
      : (typeof node.color === 'string' ? node.color.trim() : '');
    if (!rawColor) return undefined;
    return hexToRgba(resolveWorkflowColor(rawColor), 0.4);
  };

  function countNodesInItems(items: ItemRef[]): number {
    let count = 0;
    for (const ref of items) {
      if (ref.type === "node") count += 1;
      else if (ref.type === "hiddenBlock")
        count += workingLayout.hiddenBlocks[ref.blockId]?.length ?? 0;
      else if (ref.type === "group")
        count += countNodesInItems(workingLayout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? []);
      else if (ref.type === "subgraph")
        count += 1; // Subgraphs are single items now
    }
    return count;
  }

  function countBypassedNodesInItems(items: ItemRef[]): number {
    let count = 0;
    for (const ref of items) {
      if (ref.type === "node") {
        if (isNodeBypassed(ref.id)) count += 1;
      } else if (ref.type === "hiddenBlock") {
        const nodeIds = workingLayout.hiddenBlocks[ref.blockId] ?? [];
        for (const nid of nodeIds) {
          if (isNodeBypassed(nid)) count += 1;
        }
      } else if (ref.type === "group") {
        count += countBypassedNodesInItems(workingLayout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? []);
      } else if (ref.type === "subgraph") {
        if (ref.nodeId != null && isNodeBypassed(ref.nodeId)) count += 1;
      }
    }
    return count;
  }

  // Render items from the working layout (source of truth for order)
  const renderLayoutItems = (
    items: ItemRef[],
    containerId: ContainerId,
  ): React.ReactNode => {
    const rendered: React.ReactNode[] = [];
    const hoverContainerMatches =
      dragVisual != null &&
      containerIdEquals(containerId, dragVisual.hoverContainer);
    let placeholderIndex = -1;
    if (hoverContainerMatches && dragVisual) {
      placeholderIndex = dragVisual.insertIndex;
      if (placeholderIndex < 0) placeholderIndex = 0;
      if (placeholderIndex > items.length) placeholderIndex = items.length;
    }

    const pushPlaceholderIfNeeded = (idx: number) => {
      if (!hoverContainerMatches || !dragVisual) return;
      if (placeholderIndex !== idx) return;
      rendered.push(
        <DragPlaceholder
          key={`placeholder-${containerIdToKey(containerId)}-${idx}-${dragVisual.targetKey}`}
          containerKey={containerIdToKey(containerId)}
          indexLabel={String(idx)}
          targetKey={dragVisual.targetKey}
          height={dragVisual.placeholderHeight}
        />,
      );
    };

    items.forEach((ref, idx) => {
      pushPlaceholderIfNeeded(idx);
      if (ref.type === "hiddenBlock") {
        const nodeIds = workingLayout.hiddenBlocks[ref.blockId] ?? [];
        rendered.push(
          <HiddenBlockItem
            key={`hidden-${ref.blockId}`}
            blockId={ref.blockId}
            nodeCount={nodeIds.length}
          />,
        );
        return;
      }

      if (ref.type === "node") {
        const dataKey = `node-${ref.id}`;
        const isTarget = dataKey === targetDataKey;
        const bypassed = isNodeBypassed(ref.id);
        const highlightConnections =
          connectionHighlightEnabled && connectionContext.hasConnections;
        const isUpstream =
          highlightConnections && connectionContext.upstreamNodeIds.has(ref.id);
        const isDownstream =
          highlightConnections &&
          connectionContext.downstreamNodeIds.has(ref.id);
        const borderClass = isTarget
          ? "border-blue-500 ring-2 ring-blue-400"
          : isUpstream || isDownstream
            ? ""
            : getNodeBorderClass(ref.id);
        const borderStyle: React.CSSProperties = {};
        const connectionBorderWidth = "7px";

        if (highlightConnections) {
          if (isTarget) {
            borderStyle.borderTopColor = TARGET_BORDER_BLUE;
            borderStyle.borderBottomColor = TARGET_BORDER_BLUE;
            borderStyle.borderLeftColor = connectionContext.hasUpstream
              ? INPUT_HIGHLIGHT_COLOR
              : TARGET_BORDER_BLUE;
            borderStyle.borderRightColor = connectionContext.hasDownstream
              ? OUTPUT_HIGHLIGHT_COLOR
              : TARGET_BORDER_BLUE;
            if (connectionContext.hasUpstream)
              borderStyle.borderLeftWidth = connectionBorderWidth;
            if (connectionContext.hasDownstream)
              borderStyle.borderRightWidth = connectionBorderWidth;
          } else if (isUpstream || isDownstream) {
            borderStyle.borderColor = CONNECTED_NODE_BORDER_COLOR;
            if (isUpstream) {
              borderStyle.borderRightColor = INPUT_HIGHLIGHT_COLOR;
              borderStyle.borderRightWidth = connectionBorderWidth;
            }
            if (isDownstream) {
              borderStyle.borderLeftColor = OUTPUT_HIGHLIGHT_COLOR;
              borderStyle.borderLeftWidth = connectionBorderWidth;
            }
          }
        }

        rendered.push(
          <NodeItemCard
            key={dataKey}
            dataKey={dataKey}
            nodeId={ref.id}
            displayName={getNodeDisplayName(ref.id)}
            isTarget={isTarget}
            isBypassed={bypassed}
            isDragging={isDragging}
            borderClass={borderClass}
            borderStyle={
              Object.keys(borderStyle).length > 0 ? borderStyle : undefined
            }
            isHighlighted={highlightKey === dataKey}
            tintColor={getNodeTintColor(ref.id)}
          />,
        );
        return;
      }

      if (ref.type === "group") {
        const groupRef = groupRefByHierarchicalKey.get(getGroupKey(ref.id, ref.subgraphId));
        const group =
          groupByHierarchicalKey.get(getGroupKey(ref.id, ref.subgraphId)) ??
          (groupRef?.subgraphId == null
            ? groupMap.rootMap.get(ref.id)
            : groupMap.bySubgraph.get(groupRef.subgraphId)?.get(ref.id));
        if (!group) return null;
        const dataKey = `group-${getGroupKey(ref.id, ref.subgraphId)}`;
        const isTarget = dataKey === targetDataKey;
        const isCollapsed = collapsedItems[getGroupKey(ref.id, ref.subgraphId)] ?? false;
        const isAncestorOfTarget = targetAncestors.groupIds.has(getGroupKey(ref.id, ref.subgraphId));
        const canToggleCollapse = !isTarget && !isAncestorOfTarget;
        const color = resolveWorkflowColor(group.color);
        const displayTitle = group.title?.trim() || `Group ${ref.id}`;
        const children = workingLayout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [];
        const nodeCount = countNodesInItems(children);
        const bypassedCount = countBypassedNodesInItems(children);
        const allBypassed = nodeCount > 0 && bypassedCount === nodeCount;
        const isDropTarget = hoverGroupId === getGroupKey(ref.id, ref.subgraphId);

        rendered.push(
          <ContainerItemCard
            key={dataKey}
            containerType="group"
            containerDataKey={dataKey}
            dataKey={dataKey}
            title={displayTitle}
            nodeCount={nodeCount}
            isTarget={isTarget}
            isCollapsed={isCollapsed}
            canToggleCollapse={canToggleCollapse}
            isDragging={isDragging}
            isDropTarget={isDropTarget}
            isHighlighted={highlightKey === dataKey}
            color={color}
            allBypassed={allBypassed}
            onToggleCollapse={() => toggleGroupCollapse(getGroupKey(ref.id, ref.subgraphId))}
            childrenContent={
              !isCollapsed && children.length > 0 ? (
                <div className="px-1">
                  {renderLayoutItems(children, {
                    scope: "group",
                    groupKey: getGroupKey(ref.id, ref.subgraphId),
                  })}
                </div>
              ) : null
            }
          />,
        );
        return;
      }

      if (ref.type === "subgraph") {
        // Render subgraph placeholders as single items (not expanded)
        const subgraph = subgraphMap.get(ref.id);
        if (!subgraph) return null;
        const dataKey = `subgraph-${ref.id}`;
        const isTarget = dataKey === targetDataKey;
        const displayTitle = subgraph.name || subgraph.id;
        const placeholderNodeId = ref.nodeId;
        const bypassed = placeholderNodeId != null && isNodeBypassed(placeholderNodeId);
        const borderClass = isTarget
          ? "border-blue-500 ring-2 ring-blue-400"
          : bypassed
            ? "border-purple-300"
            : "border-blue-500/60";
        const subgraphBlue = themeColors.brand.blue500;

        rendered.push(
          <NodeItemCard
            key={dataKey}
            dataKey={dataKey}
            nodeId={placeholderNodeId ?? 0}
            displayName={displayTitle}
            isTarget={isTarget}
            isBypassed={bypassed}
            isDragging={isDragging}
            borderClass={borderClass}
            isHighlighted={highlightKey === dataKey}
            rightIcon={<WorkflowIcon className="w-4 h-4 -scale-x-100 text-blue-500" />}
            bgClassName={bypassed ? "bg-purple-200" : ""}
            borderStyle={bypassed ? undefined : { backgroundColor: hexToRgba(subgraphBlue, 0.1) }}
          />,
        );
        return;
      }
    });
    if (
      hoverContainerMatches &&
      dragVisual &&
      placeholderIndex === items.length
    ) {
      rendered.push(
        <DragPlaceholder
          key={`placeholder-${containerIdToKey(containerId)}-end-${dragVisual.targetKey}`}
          containerKey={containerIdToKey(containerId)}
          indexLabel="end"
          targetKey={dragVisual.targetKey}
          height={dragVisual.placeholderHeight}
        />,
      );
    }
    return rendered;
  };

  // Block touch events from reaching the document-level swipe navigation handler.
  const overlayRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = overlayRootRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("touchstart", stop, true);
    el.addEventListener("touchmove", stop, true);
    el.addEventListener("touchend", stop, true);
    el.addEventListener("touchcancel", stop, true);
    return () => {
      el.removeEventListener("touchstart", stop, true);
      el.removeEventListener("touchmove", stop, true);
      el.removeEventListener("touchend", stop, true);
      el.removeEventListener("touchcancel", stop, true);
    };
  }, []);

  return createPortal(
    <div
      ref={overlayRootRef}
      className="fixed inset-0 z-[2300] bg-gray-100 flex flex-col"
    >
      <RepositionOverlayTopBar
        nodeId={currentTarget.type === "node" ? currentTarget.id : 0}
        canShowConnectionsToggle={
          currentTarget.type === "node" && connectionContext.hasConnections
        }
        connectionHighlightEnabled={connectionHighlightEnabled}
        onToggleConnections={() =>
          setConnectionHighlightTargetKey((prev) =>
            prev === targetDataKey ? null : targetDataKey,
          )
        }
        connectionMode={
          connectionHighlightEnabled
            ? connectionContext.hasUpstream && connectionContext.hasDownstream
              ? "both"
              : connectionContext.hasUpstream
                ? "inputs"
                : "outputs"
            : "off"
        }
        leftLineCount={connectionContext.leftLineCount}
        rightLineCount={connectionContext.rightLineCount}
        inputHighlightColor={INPUT_HIGHLIGHT_COLOR}
        outputHighlightColor={OUTPUT_HIGHLIGHT_COLOR}
      />

      <RepositionScrollContainer
        scrollContainerRef={scrollContainerRef}
        isDragging={isDragging}
        isPointerArmedForDrag={isPointerArmedForDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {renderLayoutItems(
          scopeSubgraphId
            ? workingLayout.subgraphs[scopeSubgraphId] ?? []
            : workingLayout.root,
          scopeSubgraphId
            ? { scope: "subgraph", subgraphId: scopeSubgraphId }
            : { scope: "root" }
        )}
        <div data-reposition-footer="root" className="h-10" />
      </RepositionScrollContainer>

      <FullscreenModalActions
        zIndex={2301}
        actions={[
          {
            key: "cancel",
            label: "Cancel",
            onClick: onCancel,
            variant: "secondary"
          },
          {
            key: "done",
            label: "Done",
            onClick: handleDone,
            variant: "primary"
          }
        ]}
      />
    </div>,
    document.body,
  );
}
