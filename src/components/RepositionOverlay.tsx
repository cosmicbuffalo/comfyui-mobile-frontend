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
} from "@/utils/mobileLayout";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import {
  containerIdEquals,
  containerIdToKey,
  findGroupHierarchicalKeyInLayout,
  targetToDataKey,
} from "@/components/RepositionOverlay/repositionGeometry";
import { useDragEngine } from "@/components/RepositionOverlay/useDragEngine";
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


const INPUT_HIGHLIGHT_COLOR = themeColors.status.success;
const OUTPUT_HIGHLIGHT_COLOR = themeColors.status.warning;
const TARGET_BORDER_CYAN = themeColors.border.focusCyan;
const SUBGRAPH_ACCENT_CYAN = themeColors.border.focusCyan;


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
  const [currentTarget, setCurrentTarget] =
    useState<RepositionTarget>(initialTarget);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
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
  const [connectionHighlightEnabled, setConnectionHighlightEnabled] =
    useState(false);
  const workingLayoutRef = useRef(workingLayout);
  useEffect(() => {
    workingLayoutRef.current = workingLayout;
  }, [workingLayout]);

  const targetDataKey = useMemo(
    () => targetToDataKey(currentTarget, workingLayout),
    [currentTarget, workingLayout]
  );
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
          : { type: "subgraph", id: currentTarget.id, nodeId: currentTarget.nodeId };
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
        // Recover the placeholder instance from the layout ref so the main
        // panel (which renders placeholders as node items) can be scrolled
        // to after commit.
        const allRefs = [
          ...workingLayout.root,
          ...Object.values(workingLayout.groups).flat(),
          ...Object.values(workingLayout.subgraphs).flat(),
        ];
        const layoutRef = allRefs.find(
          (ref): ref is Extract<ItemRef, { type: "subgraph" }> =>
            ref.type === "subgraph" && ref.id === id,
        );
        return {
          target: { type: "subgraph", id, nodeId: layoutRef?.nodeId },
          itemRef: layoutRef ?? { type: "subgraph", id },
        };
      }
      return null;
    },
    [groupRefByHierarchicalKey, workingLayout],
  );

  const {
    isDragging,
    isPointerArmedForDrag,
    hoverGroupId,
    dragVisual,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    lastMovedTargetRef,
  } = useDragEngine({
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
  });



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
    if (hasErrors) return "border-red-600 shadow-red-900/20";
    const isExecuting = executingNodeId === String(nodeId);
    if (isExecuting) return "border-emerald-500 shadow-emerald-900/20";
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
          ? "border-cyan-400 ring-2 ring-cyan-400/70"
          : isUpstream || isDownstream
            ? ""
            : getNodeBorderClass(ref.id);
        const borderStyle: React.CSSProperties = {};
        const connectionBorderWidth = "7px";

        if (highlightConnections) {
          if (isTarget) {
            borderStyle.borderTopColor = TARGET_BORDER_CYAN;
            borderStyle.borderBottomColor = TARGET_BORDER_CYAN;
            borderStyle.borderLeftColor = connectionContext.hasUpstream
              ? INPUT_HIGHLIGHT_COLOR
              : TARGET_BORDER_CYAN;
            borderStyle.borderRightColor = connectionContext.hasDownstream
              ? OUTPUT_HIGHLIGHT_COLOR
              : TARGET_BORDER_CYAN;
            if (connectionContext.hasUpstream)
              borderStyle.borderLeftWidth = connectionBorderWidth;
            if (connectionContext.hasDownstream)
              borderStyle.borderRightWidth = connectionBorderWidth;
          } else if (isUpstream || isDownstream) {
            // Connected nodes stay transparent-bordered except for the single
            // side that faces their connection to the active (target) node.
            borderStyle.borderColor = "transparent";
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
          ? "border-cyan-400 ring-2 ring-cyan-400/70"
          : bypassed
            ? "border-purple-300"
            : "border-cyan-400/60";

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
            rightIcon={<WorkflowIcon className="w-4 h-4 -scale-x-100 text-cyan-300" />}
            bgClassName={bypassed ? "bg-purple-950/35" : ""}
            borderStyle={bypassed ? undefined : { backgroundColor: hexToRgba(SUBGRAPH_ACCENT_CYAN, 0.1) }}
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
      className="fixed inset-0 z-[2300] bg-slate-950 text-slate-100 flex flex-col"
    >
      <RepositionOverlayTopBar
        nodeId={currentTarget.type === "node" ? currentTarget.id : 0}
        canShowConnectionsToggle={
          currentTarget.type === "node" && connectionContext.hasConnections
        }
        connectionHighlightEnabled={connectionHighlightEnabled}
        onToggleConnections={() =>
          setConnectionHighlightEnabled((prev) => !prev)
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
