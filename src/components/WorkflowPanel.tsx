import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useBookmarksStore } from "@/hooks/useBookmarks";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import {
  orderNodesForMobile,
  findConnectedNode,
  findConnectedOutputNodes,
} from "@/utils/nodeOrdering";
import {
  buildNestedList,
  computeNodeGroups,
  hexToRgba,
  type NestedItem,
} from "@/utils/grouping";
import { NodeCard } from "./WorkflowPanel/NodeCard";
import { GroupHeader, GroupFooter, GroupPlaceholder } from "./WorkflowPanel/group";
import { SubgraphHeader, SubgraphFooter } from "./WorkflowPanel/subgraph";
import { CaretDownIcon, DocumentIcon, EmptyWorkflowIcon, XMarkIcon } from "@/components/icons";

function normalizeTypes(type: string): string[] {
  return String(type)
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index >= needle.length) return true;
    }
  }
  return needle.length === 0;
}

function fuzzyMatch(query: string, text: string): boolean {
  if (!query.trim()) return true;
  const normalizedText = normalizeSearchText(text);
  return normalizeSearchText(query)
    .split(" ")
    .filter(Boolean)
    .every(
      (token) =>
        normalizedText.includes(token) || isSubsequence(token, normalizedText),
    );
}

export function WorkflowPanel({
  visible,
  onImageClick,
}: {
  visible: boolean;
  onImageClick?: (
    images: Array<{ src: string; alt?: string }>,
    index: number,
  ) => void;
}) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const connectionHighlightModes = useWorkflowStore(
    (s) => s.connectionHighlightModes,
  );
  const manuallyHiddenNodes = useWorkflowStore((s) => s.manuallyHiddenNodes);
  const bookmarkBarSide = useBookmarksStore((s) => s.bookmarkBarSide);
  const bookmarkBarTop = useBookmarksStore((s) => s.bookmarkBarTop);
  const setBookmarkBarPosition = useBookmarksStore(
    (s) => s.setBookmarkBarPosition,
  );
  const setBookmarkRepositioningActive = useBookmarksStore(
    (s) => s.setBookmarkRepositioningActive,
  );
  const ensureNodeExpanded = useWorkflowStore((s) => s.ensureNodeExpanded);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const revealNodeWithParents = useWorkflowStore((s) => s.revealNodeWithParents);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const nodeErrors = useWorkflowErrorsStore((s) => s.nodeErrors);
  const searchOpen = useWorkflowStore((s) => s.searchOpen);
  const searchQuery = useWorkflowStore((s) => s.searchQuery);
  const setSearchQuery = useWorkflowStore((s) => s.setSearchQuery);
  const setSearchOpen = useWorkflowStore((s) => s.setSearchOpen);
  const collapsedGroups = useWorkflowStore((s) => s.collapsedGroups);
  const hiddenGroups = useWorkflowStore((s) => s.hiddenGroups);
  const hiddenSubgraphs = useWorkflowStore((s) => s.hiddenSubgraphs);
  const toggleGroupCollapse = useWorkflowStore((s) => s.toggleGroupCollapse);
  const setGroupCollapsed = useWorkflowStore((s) => s.setGroupCollapsed);
  const setGroupHidden = useWorkflowStore((s) => s.setGroupHidden);
  const bypassAllInGroup = useWorkflowStore((s) => s.bypassAllInGroup);
  const collapsedSubgraphs = useWorkflowStore((s) => s.collapsedSubgraphs);
  const toggleSubgraphCollapse = useWorkflowStore(
    (s) => s.toggleSubgraphCollapse,
  );
  const setSubgraphCollapsed = useWorkflowStore((s) => s.setSubgraphCollapsed);
  const setNodeFold = useWorkflowStore((s) => s.setNodeFold);
  const bookmarkedNodeIds = useBookmarksStore((s) => s.bookmarkedNodeIds);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bookmarkBarRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [bookmarkCycleIndex, setBookmarkCycleIndex] = useState(0);
  const [isBookmarkRepositioning, setIsBookmarkRepositioning] = useState(false);
  const [isBookmarkDragging, setIsBookmarkDragging] = useState(false);
  const [bookmarkDragPosition, setBookmarkDragPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [errorBadgeByNodeId, setErrorBadgeByNodeId] = useState<
    Record<number, string>
  >({});
  const errorBadgeTimeoutsRef = useRef<Map<number, number>>(new Map());
  const bookmarkLongPressRef = useRef<number | null>(null);
  const bookmarkPointerRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    pointerId: number;
  } | null>(null);
  const bookmarkDragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchOpen(false);
  };

  const jumpToBookmarkedNode = useCallback(
    (nodeId: number, label?: string) => {
      revealNodeWithParents(nodeId);
      window.dispatchEvent(
        new CustomEvent("workflow-scroll-to-node", { detail: { nodeId, label } }),
      );
      scrollToNode(nodeId, label);
    },
    [revealNodeWithParents, scrollToNode],
  );

  const handleBookmarkButtonClick = useCallback(
    (nodeId: number, index: number) => () => {
      if (isBookmarkRepositioning) {
        setIsBookmarkRepositioning(false);
        setIsBookmarkDragging(false);
        setBookmarkDragPosition(null);
        return;
      }
      setBookmarkCycleIndex(index);
      jumpToBookmarkedNode(nodeId);
    },
    [isBookmarkRepositioning, jumpToBookmarkedNode],
  );

  const handleBookmarkCycleClick = useCallback(() => {
    if (isBookmarkRepositioning) {
      setIsBookmarkRepositioning(false);
      setIsBookmarkDragging(false);
      setBookmarkDragPosition(null);
      return;
    }
    const nextIndex = (bookmarkCycleIndex + 1) % bookmarkedNodeIds.length;
    setBookmarkCycleIndex(nextIndex);
    jumpToBookmarkedNode(bookmarkedNodeIds[nextIndex]);
  }, [
    bookmarkedNodeIds,
    bookmarkCycleIndex,
    isBookmarkRepositioning,
    jumpToBookmarkedNode,
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
    const maxTop = Math.max(minTop, wrapperHeight - barHeight - bottomMargin);
    return { minTop, maxTop };
  }, [getBottomBarOffset]);

  const clampBookmarkTop = useCallback(
    (nextTop: number) => {
      const bounds = getBookmarkBounds();
      if (!bounds) return nextTop;
      return Math.min(Math.max(nextTop, bounds.minTop), bounds.maxTop);
    },
    [getBookmarkBounds],
  );

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
    [clampBookmarkTop],
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
    [clampBookmarkTop],
  );

  const handleBookmarkPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      bookmarkPointerRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startTime: Date.now(),
        pointerId: event.pointerId,
      };
      if (isBookmarkRepositioning) {
        startBookmarkDrag(event.clientX, event.clientY);
      } else {
        bookmarkLongPressRef.current = window.setTimeout(() => {
          setIsBookmarkRepositioning(true);
          startBookmarkDrag(event.clientX, event.clientY);
        }, 500);
      }
      event.currentTarget.setPointerCapture(event.pointerId);
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
  }, [bookmarkDragPosition, clampBookmarkTop, setBookmarkBarPosition]);

  const handleBookmarkPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      clearBookmarkLongPress();
      const pointerState = bookmarkPointerRef.current;
      bookmarkPointerRef.current = null;
      if (isBookmarkDragging) {
        finalizeBookmarkPosition();
        setIsBookmarkDragging(false);
        return;
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
    setIsBookmarkDragging(false);
    setBookmarkDragPosition(null);
  }, [clearBookmarkLongPress]);

  const orderedNodes = useMemo(() => {
    if (!workflow) return [];
    const baseOrder = orderNodesForMobile(workflow);
    if (Object.keys(manuallyHiddenNodes).length === 0) {
      return baseOrder;
    }
    return baseOrder.filter((node) => !manuallyHiddenNodes[node.id]);
  }, [workflow, manuallyHiddenNodes]);

  const normalizedQuery = searchQuery.trim();
  const searchActive = searchOpen && normalizedQuery.length > 0;

  // Compute node-to-group mapping for search
  const nodeToGroup = useMemo(() => {
    if (!workflow) return new Map<number, number>();
    return computeNodeGroups(workflow);
  }, [workflow]);

  // Find groups that match the search query
  const matchingGroupIds = useMemo(() => {
    if (!searchActive || !workflow) return new Set<number>();
    const groups = workflow.groups ?? [];
    const matching = new Set<number>();
    for (const group of groups) {
      if (fuzzyMatch(normalizedQuery, group.title)) {
        matching.add(group.id);
      }
    }
    return matching;
  }, [workflow, searchActive, normalizedQuery]);

  // Filter nodes based on search, including group title matches
  const filteredNodes = useMemo(() => {
    if (!searchActive) return orderedNodes;
    return orderedNodes.filter((node) => {
      // If the node's group matches the search, include it
      const groupId = nodeToGroup.get(node.id);
      if (groupId !== undefined && matchingGroupIds.has(groupId)) {
        return true;
      }
      // Otherwise, check node content
      const typeDef = nodeTypes?.[node.type];
      const title = (node as { title?: unknown }).title;
      const labelParts = [
        typeof title === "string" ? title : "",
        typeDef?.display_name ?? "",
        node.type,
        String(node.id),
      ];
      return fuzzyMatch(normalizedQuery, labelParts.join(" "));
    });
  }, [
    orderedNodes,
    searchActive,
    normalizedQuery,
    nodeTypes,
    nodeToGroup,
    matchingGroupIds,
  ]);

  // Build nested list of items to render
  const nestedItems = useMemo(() => {
    if (!workflow) return [];

    if (searchActive) {
      return filteredNodes.map((node) => ({
        type: "node" as const,
        node,
        groupId: null,
        subgraphId: null,
      }));
    }

    return buildNestedList(
      filteredNodes,
      workflow,
      collapsedGroups,
      hiddenGroups,
      collapsedSubgraphs,
      hiddenSubgraphs,
    );
  }, [
    workflow,
    filteredNodes,
    collapsedGroups,
    hiddenGroups,
    collapsedSubgraphs,
    hiddenSubgraphs,
    searchActive,
  ]);

  const errorOrderByNodeId = useMemo(() => {
    const map = new Map<number, number>();
    let order = 0;
    for (const node of orderedNodes) {
      const errors = nodeErrors[String(node.id)];
      if (errors && errors.length > 0) {
        order += 1;
        map.set(node.id, order);
      }
    }
    return map;
  }, [orderedNodes, nodeErrors]);

  const highlightedNodeIds = useMemo(() => {
    if (!workflow) return new Set<number>();
    const activeEntries = Object.entries(connectionHighlightModes)
      .filter(([, mode]) => mode !== "off")
      .map(([id, mode]) => ({ id: Number(id), mode }));
    if (activeEntries.length === 0) return new Set<number>();

    const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
    const highlighted = new Set<number>();
    const isHiddenNode = (node: (typeof workflow.nodes)[number]) =>
      Boolean(manuallyHiddenNodes[node.id]);

    const collectTargets = (
      nodeId: number,
      seen: Set<number>,
      desiredTypes: Set<string>,
    ): Array<(typeof workflow.nodes)[number]> => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const targets: Array<(typeof workflow.nodes)[number]> = [];
      node.outputs?.forEach((output, index) => {
        const outputTypes = normalizeTypes(output.type);
        if (
          desiredTypes.size > 0 &&
          !outputTypes.some((type) => desiredTypes.has(type))
        )
          return;
        const connections = findConnectedOutputNodes(workflow, nodeId, index);
        connections.forEach((connection) => {
          const connected = connection.node;
          if (isHiddenNode(connected)) {
            targets.push(...collectTargets(connected.id, seen, desiredTypes));
          } else {
            targets.push(connected);
          }
        });
      });
      return targets;
    };

    const collectSources = (
      nodeId: number,
      seen: Set<number>,
      desiredTypes: Set<string>,
    ): Array<(typeof workflow.nodes)[number]> => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const sources: Array<(typeof workflow.nodes)[number]> = [];
      node.inputs?.forEach((input, index) => {
        if (input.link === null) return;
        const inputTypes = normalizeTypes(input.type);
        if (
          desiredTypes.size > 0 &&
          !inputTypes.some((type) => desiredTypes.has(type))
        )
          return;
        const connected = findConnectedNode(workflow, nodeId, index);
        if (!connected) return;
        if (isHiddenNode(connected.node)) {
          sources.push(
            ...collectSources(connected.node.id, seen, desiredTypes),
          );
        } else {
          sources.push(connected.node);
        }
      });
      return sources;
    };

    activeEntries.forEach(({ id: activeId, mode }) => {
      const activeNode = nodeMap.get(activeId);
      if (!activeNode) return;

      if (mode === "inputs" || mode === "both") {
        activeNode.inputs?.forEach((input, index) => {
          if (input.link === null) return;
          const connected = findConnectedNode(workflow, activeNode.id, index);
          if (!connected) return;
          if (!isHiddenNode(connected.node)) {
            highlighted.add(connected.node.id);
            return;
          }
          const inputTypes = new Set(normalizeTypes(input.type));
          const allSources = collectSources(
            connected.node.id,
            new Set<number>(),
            inputTypes,
          );
          allSources.forEach((node) => highlighted.add(node.id));
        });
      }

      if (mode === "outputs" || mode === "both") {
        activeNode.outputs?.forEach((output, index) => {
          const outputTypes = new Set(normalizeTypes(output.type));
          const connections = findConnectedOutputNodes(
            workflow,
            activeNode.id,
            index,
          );
          connections.forEach((connection) => {
            const connected = connection.node;
            if (!isHiddenNode(connected)) {
              highlighted.add(connected.id);
              return;
            }
            const targets = collectTargets(
              connected.id,
              new Set<number>(),
              outputTypes,
            );
            targets.forEach((node) => highlighted.add(node.id));
          });
        });
      }
    });

    return highlighted;
  }, [workflow, connectionHighlightModes, manuallyHiddenNodes]);

  useEffect(() => {
    const handleTemporaryLabelErrorNode = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const nodeId = typeof detail === "number" ? detail : detail.nodeId;
      const label = typeof detail === "object" ? detail.label : undefined;

      if (typeof nodeId !== "number") return;
      const nodeExists = filteredNodes.some((node) => node.id === nodeId);
      if (!nodeExists) return;

      const errorOrder = errorOrderByNodeId.get(nodeId);
      const badgeLabel =
        label ?? (errorOrder ? `Error #${errorOrder}` : "Error");

      setErrorBadgeByNodeId((prev) => ({ ...prev, [nodeId]: badgeLabel }));
      const existingTimeout = errorBadgeTimeoutsRef.current.get(nodeId);
      if (existingTimeout) {
        window.clearTimeout(existingTimeout);
      }
      const timeoutId = window.setTimeout(() => {
        setErrorBadgeByNodeId((prev) => {
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
        errorBadgeTimeoutsRef.current.delete(nodeId);
      }, 2000);
      errorBadgeTimeoutsRef.current.set(nodeId, timeoutId);
    };

    window.addEventListener(
      "workflow-label-error-node",
      handleTemporaryLabelErrorNode as EventListener,
    );
    return () =>
      window.removeEventListener(
        "workflow-label-error-node",
        handleTemporaryLabelErrorNode as EventListener,
      );
  }, [filteredNodes, errorOrderByNodeId]);

  useEffect(() => {
    const timeouts = errorBadgeTimeoutsRef.current;
    return () => {
      timeouts.forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    const handleScrollToNode = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const nodeId = typeof detail === "number" ? detail : detail.nodeId;
      const label = typeof detail === "object" ? detail.label : undefined;

      if (typeof nodeId !== "number") return;
      ensureNodeExpanded(nodeId);
      // Use native scrollIntoView instead of virtualizer
      const nodeElement = document.getElementById(`node-card-${nodeId}`);
      if (nodeElement) {
        nodeElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      requestAnimationFrame(() => scrollToNode(nodeId, label));
    };

    window.addEventListener(
      "workflow-scroll-to-node",
      handleScrollToNode as EventListener,
    );
    return () =>
      window.removeEventListener(
        "workflow-scroll-to-node",
        handleScrollToNode as EventListener,
      );
  }, [ensureNodeExpanded, scrollToNode]);

  useEffect(() => {
    if (!searchOpen) return;
    if (parentRef.current) {
      parentRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchOpen]);

  useEffect(() => {
    setBookmarkRepositioningActive(isBookmarkRepositioning);
    return () => setBookmarkRepositioningActive(false);
  }, [isBookmarkRepositioning, setBookmarkRepositioningActive]);

  useEffect(() => {
    if (!bookmarkedNodeIds.length) return;
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
    bookmarkedNodeIds.length,
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
      setIsBookmarkRepositioning(false);
      setIsBookmarkDragging(false);
      setBookmarkDragPosition(null);
      clearBookmarkLongPress();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, [clearBookmarkLongPress, isBookmarkRepositioning]);

  const findFirstNodeId = (items: NestedItem[]): number | null => {
    for (const item of items) {
      if (item.type === "node") return item.node.id;
      if (item.type === "group" || item.type === "subgraph") {
        const nestedMatch = findFirstNodeId(item.children);
        if (nestedMatch != null) return nestedMatch;
      }
    }
    return null;
  };

  const hasExpandedNestedItems = (items: NestedItem[]): boolean => {
    for (const item of items) {
      if (item.type === "node") {
        if (!item.node.flags?.collapsed) return true;
        continue;
      }
      if (!item.isCollapsed) return true;
      if (hasExpandedNestedItems(item.children)) return true;
    }
    return false;
  };

  const setNestedCollapsed = useCallback(
    (items: NestedItem[], collapsed: boolean) => {
      const applyCollapse = (nestedItems: NestedItem[]) => {
        for (const item of nestedItems) {
          if (item.type === "node") {
            setNodeFold(item.node.id, collapsed);
            continue;
          }
          if (item.type === "group") {
            setGroupCollapsed(item.group.id, collapsed);
            applyCollapse(item.children);
            continue;
          }
          setSubgraphCollapsed(item.subgraph.id, collapsed);
          applyCollapse(item.children);
        }
      };
      applyCollapse(items);
    },
    [setGroupCollapsed, setNodeFold, setSubgraphCollapsed],
  );

  const createFoldAllHandler = useCallback(
    (items: NestedItem[], shouldFold: boolean) => () => {
      setNestedCollapsed(items, shouldFold);
    },
    [setNestedCollapsed],
  );

  const renderItems = (items: NestedItem[], parentKey: string) =>
    items.map((item, index) => {
      const keyBase = `${parentKey}-${index}`;
      if (item.type === "group") {
        const group = item.group;
        const backgroundColor = hexToRgba(group.color, 0.15);
        const borderColor = hexToRgba(group.color, 0.4);
        const bookmarkNodeId = findFirstNodeId(item.children);
        const hasExpandedChildren = hasExpandedNestedItems(item.children);
        const foldAllLabel = hasExpandedChildren ? "Fold all" : "Unfold all";
        const handleFoldAll = createFoldAllHandler(
          item.children,
          hasExpandedChildren,
        );

        return (
          <div
            id={`group-wrapper-${item.group.id}`}
            key={`group-${item.group.id}-${keyBase}`}
            className="group-wrapper shadow-md rounded-xl border mb-3"
            style={{
              backgroundColor,
              borderColor,
            }}
          >
            <GroupHeader
              group={group}
              nodeCount={item.nodeCount}
              isCollapsed={item.isCollapsed}
              subgraphId={item.subgraphId}
              bookmarkNodeId={bookmarkNodeId}
              foldAllLabel={foldAllLabel}
              onToggleCollapse={() => toggleGroupCollapse(item.group.id)}
              onToggleFoldAll={handleFoldAll}
              onBypassAll={(bypass) =>
                bypassAllInGroup(item.group.id, bypass, item.subgraphId)
              }
              onHideGroup={() => setGroupHidden(item.group.id, true)}
            />
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                item.isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
              }`}
            >
              <div
                className={`overflow-hidden px-1 transition-opacity duration-200 ease-out ${
                  item.isCollapsed ? "opacity-0" : "opacity-100"
                }`}
              >
                {item.children.length > 0 ? (
                  renderItems(item.children, keyBase)
                ) : (
                  <GroupPlaceholder group={item.group} />
                )}
                <GroupFooter group={item.group} />
              </div>
            </div>
          </div>
        );
      }

      if (item.type === "subgraph") {
        // Default subgraph color - a slightly blue-tinted gray similar to node backgrounds
        const SUBGRAPH_BG_COLOR = "rgba(59, 130, 246, 0.08)"; // blue-500 at 8%
        const SUBGRAPH_BORDER_COLOR = "rgba(59, 130, 246, 0.25)"; // blue-500 at 25%

        return (
          <div
            key={`subgraph-${item.subgraph.id}-${keyBase}`}
            className="subgraph-wrapper shadow-md rounded-xl border mb-3"
            style={{
              backgroundColor: `var(--subgraph-bg, ${SUBGRAPH_BG_COLOR})`,
              borderColor: `var(--subgraph-border, ${SUBGRAPH_BORDER_COLOR})`,
              // CSS custom properties for dark mode - set via CSS or inline
              ["--subgraph-bg" as string]: SUBGRAPH_BG_COLOR,
              ["--subgraph-border" as string]: SUBGRAPH_BORDER_COLOR,
            }}
          >
            <SubgraphHeader
              subgraph={item.subgraph}
              nodeCount={item.nodeCount}
              isCollapsed={item.isCollapsed}
              onToggleCollapse={() => toggleSubgraphCollapse(item.subgraph.id)}
            />
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                item.isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
              }`}
            >
              <div
                className={`overflow-hidden px-1 transition-opacity duration-200 ease-out ${
                  item.isCollapsed ? "opacity-0" : "opacity-100"
                }`}
              >
                {item.children.length > 0 &&
                  renderItems(item.children, keyBase)}
                <SubgraphFooter subgraph={item.subgraph} />
              </div>
            </div>
          </div>
        );
      }

      return (
        <div
          key={`node-${item.node.id}-${keyBase}`}
          id={`node-card-${item.node.id}`}
        >
          <NodeCard
            node={item.node}
            isExecuting={executingNodeId === String(item.node.id)}
            isConnectionHighlighted={highlightedNodeIds.has(item.node.id)}
            errorBadgeLabel={errorBadgeByNodeId[item.node.id] ?? null}
            onImageClick={onImageClick}
          />
        </div>
      );
    });

  let content: ReactElement;
  if (!workflow) {
    content = (
      <div
        id="node-list-no-workflow"
        className="flex items-center justify-center h-full text-gray-500"
      >
        <div id="no-workflow-content" className="text-center p-8">
          <div
            id="no-workflow-icon-container"
            className="flex items-center justify-center mb-4"
          >
            <DocumentIcon className="w-10 h-10 text-gray-300" />
          </div>
          <p id="no-workflow-title" className="text-lg font-medium">
            No workflow loaded
          </p>
          <p id="no-workflow-description" className="text-sm mt-2">
            Open the menu to load a workflow
          </p>
        </div>
      </div>
    );
  } else if (orderedNodes.length === 0) {
    content = (
      <div
        id="node-list-empty"
        className="flex items-center justify-center h-full text-gray-500"
      >
        <div id="empty-workflow-content" className="text-center p-8">
          <div
            id="empty-workflow-icon-container"
            className="flex items-center justify-center mb-4"
          >
            <EmptyWorkflowIcon className="w-10 h-10 text-gray-300" />
          </div>
          <p id="empty-workflow-title" className="text-lg font-medium">
            Empty workflow
          </p>
          <p id="empty-workflow-description" className="text-sm mt-2">
            This workflow has no nodes
          </p>
        </div>
      </div>
    );
  } else {
    content = (
      <div id="node-list-shell" className="h-full flex flex-col">
        {searchOpen && (
          <div className="node-search-bar px-1 pt-3">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes..."
                className="comfy-input p-3 flex-1 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={handleClearSearch}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div
          id="node-list-container"
          ref={parentRef}
          className="flex-1 overflow-auto px-4 pt-4 overscroll-contain scroll-container"
          style={{ paddingBottom: "10rem" }}
          data-node-list="true"
        >
          {nestedItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center p-8">
                <p className="text-sm font-medium">No matching nodes</p>
                <p className="text-xs mt-2">Try a different search.</p>
              </div>
            </div>
          ) : (
            <div id="node-list-inner">{renderItems(nestedItems, "root")}</div>
          )}
        </div>
      </div>
    );
  }

  const bookmarkBarTopValue =
    bookmarkDragPosition?.y ?? bookmarkBarTop ?? 0;
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
    opacity:
      bookmarkBarTop == null && bookmarkDragPosition == null ? 0 : 1,
    touchAction: isBookmarkRepositioning ? "none" : "pan-y",
    pointerEvents:
      bookmarkBarTop == null && bookmarkDragPosition == null ? "none" : "auto",
  } as const;

  return (
    <div
      id="node-list-wrapper"
      ref={wrapperRef}
      className="absolute inset-x-0 top-[60px] bottom-0 bg-gray-100"
      style={{ display: visible ? "block" : "none" }}
    >
      {content}
      {bookmarkedNodeIds.length > 0 && (
        <div
          ref={bookmarkBarRef}
          className={`absolute z-[200] flex flex-col items-center gap-2 pointer-events-auto ${
            isBookmarkRepositioning
              ? "rounded-2xl ring-2 ring-blue-400/70 bg-white/30 shadow-lg"
              : ""
          }`}
          style={bookmarkBarStyle}
          onPointerDown={handleBookmarkPointerDown}
          onPointerMove={handleBookmarkPointerMove}
          onPointerUp={handleBookmarkPointerUp}
          onPointerCancel={handleBookmarkPointerCancel}
        >
          <div
            className={`flex flex-col items-center gap-2 ${
              isBookmarkRepositioning ? "p-2 cursor-grab" : ""
            }`}
          >
            {bookmarkedNodeIds.map((nodeId, index) => (
              <button
                key={nodeId}
                type="button"
                className="w-10 h-10 rounded-full border border-transparent bg-gray-900/10 text-[11px] font-bold text-gray-800 shadow-sm backdrop-blur-sm dark:bg-white/10 dark:text-gray-100 select-none"
                onClick={handleBookmarkButtonClick(nodeId, index)}
              >
                {nodeId}
              </button>
            ))}
            {bookmarkedNodeIds.length > 1 && (
              <button
                type="button"
                className="w-10 h-10 rounded-full border border-transparent bg-gray-900/10 text-gray-600 shadow-sm backdrop-blur-sm flex items-center justify-center dark:bg-white/10 dark:text-gray-200 select-none"
                aria-label="Cycle bookmarks"
                onClick={handleBookmarkCycleClick}
              >
                <CaretDownIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
