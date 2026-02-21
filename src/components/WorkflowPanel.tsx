import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { WorkflowNode } from "@/api/types";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useBookmarksStore } from "@/hooks/useBookmarks";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import { useRepositionMode } from "@/hooks/useRepositionMode";
import { RepositionOverlay } from "@/components/RepositionOverlay";
import {
  flattenLayoutToNodeOrder,
  type ItemRef,
} from "@/utils/mobileLayout";
import { findLayoutPath } from "@/utils/layoutTraversal";
import { collectLayoutHiddenState } from "@/utils/layoutHiddenState";
import {
  findConnectedNode,
  findConnectedOutputNodes,
} from "@/utils/nodeOrdering";
import {
  buildNestedListFromLayout,
  hexToRgba,
  type NestedItem,
} from "@/utils/grouping";
import { NodeCard } from "./WorkflowPanel/NodeCard";
import { AddNodePlaceholder } from "./WorkflowPanel/AddNodePlaceholder";
import { ContainerFooter } from "./WorkflowPanel/ContainerFooter";
import { GraphContainerHeader } from "./WorkflowPanel/GraphContainer/Header";
import { GraphContainerPlaceholder } from "./WorkflowPanel/GraphContainer/Placeholder";
import { AddNodeModal } from "@/components/modals/AddNodeModal";
import { DeleteContainerModal } from "@/components/modals/DeleteContainerModal";
import { SearchBar } from "@/components/SearchBar";
import { themeColors } from "@/theme/colors";
import { requireStableKey } from "@/utils/stableKeys";
import {
  CaretDownIcon,
  DocumentIcon,
  EmptyWorkflowIcon,
} from "@/components/icons";

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
  const bookmarkBarSide = useBookmarksStore((s) => s.bookmarkBarSide);
  const bookmarkBarTop = useBookmarksStore((s) => s.bookmarkBarTop);
  const setBookmarkBarPosition = useBookmarksStore(
    (s) => s.setBookmarkBarPosition,
  );
  const setBookmarkRepositioningActive = useBookmarksStore(
    (s) => s.setBookmarkRepositioningActive,
  );
  const setItemCollapsed = useWorkflowStore((s) => s.setItemCollapsed);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const revealNodeWithParents = useWorkflowStore(
    (s) => s.revealNodeWithParents,
  );
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const nodeErrors = useWorkflowErrorsStore((s) => s.nodeErrors);
  const searchOpen = useWorkflowStore((s) => s.searchOpen);
  const searchQuery = useWorkflowStore((s) => s.searchQuery);
  const setSearchQuery = useWorkflowStore((s) => s.setSearchQuery);
  const setSearchOpen = useWorkflowStore((s) => s.setSearchOpen);
  const addNodeModalRequest = useWorkflowStore((s) => s.addNodeModalRequest);
  const clearAddNodeModalRequest = useWorkflowStore(
    (s) => s.clearAddNodeModalRequest,
  );
  const collapsedItems = useWorkflowStore((s) => s.collapsedItems);
  const hiddenItems = useWorkflowStore((s) => s.hiddenItems);
  const setItemHidden = useWorkflowStore((s) => s.setItemHidden);
  const bypassAllInContainer = useWorkflowStore((s) => s.bypassAllInContainer);
  const deleteContainer = useWorkflowStore((s) => s.deleteContainer);
  const updateContainerTitle = useWorkflowStore((s) => s.updateContainerTitle);
  const mobileLayout = useWorkflowStore((s) => s.mobileLayout);
  const stableKeyByPointer = useWorkflowStore((s) => s.stableKeyByPointer);
  const bookmarkedItems = useBookmarksStore((s) => s.bookmarkedItems);
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);
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
  const [addNodeModalOpen, setAddNodeModalOpen] = useState(false);
  const [addNodeGroupId, setAddNodeGroupId] = useState<number | null>(null);
  const [addNodeSubgraphId, setAddNodeSubgraphId] = useState<string | null>(
    null,
  );
  const [deleteContainerTarget, setDeleteContainerTarget] = useState<{
    stableKey: string;
    containerTypeLabel: "group" | "subgraph";
    containerIdLabel: string;
    displayName: string;
    nodeCount: number;
  } | null>(null);
  const reposition = useRepositionMode();
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
  const handledAddNodeModalRequestIdRef = useRef<number | null>(null);
  const stableNodeKeyById = useMemo(
    () =>
      new Map(
        (workflow?.nodes ?? []).map((node) => [
          node.id,
          requireStableKey(node.stableKey, `node ${node.id}`),
        ]),
      ),
    [workflow],
  );
  const stableSubgraphKeyById = useMemo(
    () =>
      new Map(
        (workflow?.definitions?.subgraphs ?? []).map((subgraph) => [
          subgraph.id,
          requireStableKey(subgraph.stableKey, `subgraph ${subgraph.id}`),
        ]),
      ),
    [workflow],
  );

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchOpen(false);
  };

  type BookmarkEntry =
    | { stableKey: string; type: "node"; nodeId: number; subgraphId: string | null; text: string }
    | { stableKey: string; type: "group"; groupId: number; subgraphId: string | null; groupKey: string; text: string }
    | { stableKey: string; type: "subgraph"; subgraphId: string; text: string };

  const bookmarkEntryByStableKey = useMemo(() => {
    const byStableKey = new Map<string, BookmarkEntry>();
    const visitedGroups = new Set<string>();
    const visitedSubgraphs = new Set<string>();
    const visit = (refs: ItemRef[], currentSubgraphId: string | null) => {
      refs.forEach((ref) => {
        if (ref.type === "node") {
          const stableKey = requireStableKey(
            stableNodeKeyById.get(ref.id),
            `layout node ref ${ref.id}`,
          );
          byStableKey.set(stableKey, {
            stableKey,
            type: "node",
            nodeId: ref.id,
            subgraphId: currentSubgraphId,
            text: String(ref.id),
          });
          return;
        }
        if (ref.type === "group") {
          const stableKey = ref.stableKey;
          if (stableKey) {
            byStableKey.set(stableKey, {
              stableKey,
              type: "group",
              groupId: ref.id,
              subgraphId: currentSubgraphId,
              groupKey: ref.stableKey,
              text: `G${ref.id}`,
            });
          }
          if (visitedGroups.has(ref.stableKey)) return;
          visitedGroups.add(ref.stableKey);
          visit(mobileLayout.groups[ref.stableKey] ?? [], currentSubgraphId);
          return;
        }
        if (ref.type === "subgraph") {
          const stableKey = requireStableKey(
            stableSubgraphKeyById.get(ref.id),
            `layout subgraph ref ${ref.id}`,
          );
          byStableKey.set(stableKey, {
            stableKey,
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
    return byStableKey;
  }, [mobileLayout, stableNodeKeyById, stableSubgraphKeyById]);

  const bookmarkEntries = useMemo<BookmarkEntry[]>(
    () =>
      bookmarkedItems
        .map((stableKey) => bookmarkEntryByStableKey.get(stableKey))
        .filter((entry): entry is BookmarkEntry => entry != null),
    [bookmarkEntryByStableKey, bookmarkedItems],
  );

  const findPathToBookmarkedStableKey = useCallback(
    (stableKey: string): { groupKeys: string[]; subgraphIds: string[] } | null => {
      const path = findLayoutPath(mobileLayout, ({ ref }) => {
        if (ref.type === "node") {
          return (
            requireStableKey(
              stableNodeKeyById.get(ref.id),
              `layout node ref ${ref.id}`,
            ) === stableKey
          );
        }
        if (ref.type === "group") {
          return ref.stableKey === stableKey;
        }
        if (ref.type === "subgraph") {
          return (
            requireStableKey(
              stableSubgraphKeyById.get(ref.id),
              `layout subgraph ref ${ref.id}`,
            ) === stableKey
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
    [mobileLayout, stableNodeKeyById, stableSubgraphKeyById],
  );

  const jumpToBookmarkedNode = useCallback(
    (stableKey: string, nodeId: number, label?: string) => {
      revealNodeWithParents(stableKey);
      scrollToNode(stableKey, label);
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
      stableKey: string,
      groupStableKey: string,
      groupId: number,
      subgraphId: string | null,
    ) => {
      const path = findPathToBookmarkedStableKey(stableKey);
      if (path) {
        for (const id of path.subgraphIds) {
          const stableSubgraphKey =
            stableSubgraphKeyById.get(id) ?? null;
          if (!stableSubgraphKey) continue;
          setItemHidden(stableSubgraphKey, false);
          setItemCollapsed(stableSubgraphKey, false);
        }
        for (const key of path.groupKeys) {
          const stableGroupKey = stableKeyByPointer[key];
          if (!stableGroupKey) continue;
          setItemHidden(stableGroupKey, false);
          setItemCollapsed(stableGroupKey, false);
        }
      }
      if (subgraphId) {
        const stableSubgraphKey =
          stableSubgraphKeyById.get(subgraphId) ?? null;
        if (stableSubgraphKey) {
          setItemHidden(stableSubgraphKey, false);
          setItemCollapsed(stableSubgraphKey, false);
        }
      }
      setItemHidden(stableKey, false);
      setItemCollapsed(stableKey, false);

      const scope = subgraphId ?? "root";
      const headerSelector = `[data-group-id="${groupId}"][data-subgraph-id="${scope}"]`;
      const wrapperSelector = `[data-reposition-item="group-${groupStableKey}"]`;
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
      findPathToBookmarkedStableKey,
      setItemCollapsed,
      setItemHidden,
      stableKeyByPointer,
      stableSubgraphKeyById,
    ],
  );

  const jumpToBookmarkedSubgraph = useCallback(
    (stableKey: string, subgraphId: string) => {
      const path = findPathToBookmarkedStableKey(stableKey);
      if (path) {
        for (const id of path.subgraphIds) {
          const stableSubgraphKey =
            stableSubgraphKeyById.get(id) ?? null;
          if (!stableSubgraphKey) continue;
          setItemHidden(stableSubgraphKey, false);
          setItemCollapsed(stableSubgraphKey, false);
        }
        for (const key of path.groupKeys) {
          const stableGroupKey = stableKeyByPointer[key];
          if (!stableGroupKey) continue;
          setItemHidden(stableGroupKey, false);
          setItemCollapsed(stableGroupKey, false);
        }
      }
      setItemHidden(stableKey, false);
      setItemCollapsed(stableKey, false);

      const headerSelector = `[data-subgraph-header-id="${subgraphId}"]`;
      const wrapperSelector = `[data-reposition-item="subgraph-${subgraphId}"]`;
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
      findPathToBookmarkedStableKey,
      setItemCollapsed,
      setItemHidden,
      stableKeyByPointer,
      stableSubgraphKeyById,
    ],
  );

  const handleBookmarkButtonClick = useCallback(
    (entry: BookmarkEntry, index: number) => () => {
      if (isBookmarkRepositioning) {
        setIsBookmarkRepositioning(false);
        setIsBookmarkDragging(false);
        setBookmarkDragPosition(null);
        return;
      }
      setBookmarkCycleIndex(index);
      if (entry.type === "node") {
        jumpToBookmarkedNode(entry.stableKey, entry.nodeId);
      } else if (entry.type === "group") {
        jumpToBookmarkedGroup(
          entry.stableKey,
          entry.groupKey,
          entry.groupId,
          entry.subgraphId,
        );
      } else {
        jumpToBookmarkedSubgraph(entry.stableKey, entry.subgraphId);
      }
    },
    [
      isBookmarkRepositioning,
      jumpToBookmarkedGroup,
      jumpToBookmarkedNode,
      jumpToBookmarkedSubgraph,
    ],
  );

  const handleBookmarkCycleClick = useCallback(() => {
    if (isBookmarkRepositioning) {
      setIsBookmarkRepositioning(false);
      setIsBookmarkDragging(false);
      setBookmarkDragPosition(null);
      return;
    }
    const nextIndex = (bookmarkCycleIndex + 1) % bookmarkEntries.length;
    setBookmarkCycleIndex(nextIndex);
    const entry = bookmarkEntries[nextIndex];
    if (!entry) return;
    if (entry.type === "node") {
      jumpToBookmarkedNode(entry.stableKey, entry.nodeId);
    } else if (entry.type === "group") {
      jumpToBookmarkedGroup(
        entry.stableKey,
        entry.groupKey,
        entry.groupId,
        entry.subgraphId,
      );
    } else {
      jumpToBookmarkedSubgraph(entry.stableKey, entry.subgraphId);
    }
  }, [
    bookmarkEntries,
    bookmarkCycleIndex,
    isBookmarkRepositioning,
    jumpToBookmarkedGroup,
    jumpToBookmarkedNode,
    jumpToBookmarkedSubgraph,
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
      const isButtonPress = (event.target as HTMLElement).closest("button");
      if (isButtonPress && !isBookmarkRepositioning) {
        // Let bookmark buttons handle normal activation without drag interception.
        return;
      }
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
    const flatOrder: number[] = flattenLayoutToNodeOrder(mobileLayout);
    const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
    const ordered: WorkflowNode[] = [];
    for (const id of flatOrder) {
      const node = nodeMap.get(id);
      if (node) ordered.push(node);
    }
    // Append any nodes not in the layout
    const inLayout = new Set(flatOrder);
    for (const node of workflow.nodes) {
      if (!inLayout.has(node.id)) ordered.push(node);
    }
    return Object.keys(hiddenItems).length === 0
      ? ordered
      : ordered.filter(
          (node) => {
            const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
            return !hiddenItems[stableKey];
          },
        );
  }, [workflow, hiddenItems, mobileLayout]);

  const normalizedQuery = searchQuery.trim();
  const searchActive = searchOpen && normalizedQuery.length > 0;

  const matchingGroupIds = useMemo(() => {
    if (!searchActive || !workflow) return new Set<number>();
    const groups = [
      ...(workflow.groups ?? []),
      ...(workflow.definitions?.subgraphs ?? []).flatMap(
        (subgraph) => subgraph.groups ?? [],
      ),
    ];
    const matching = new Set<number>();
    for (const group of groups) {
      if (fuzzyMatch(normalizedQuery, group.title)) {
        matching.add(group.id);
      }
    }
    return matching;
  }, [workflow, searchActive, normalizedQuery]);

  const matchingSubgraphIds = useMemo(() => {
    if (!searchActive || !workflow) return new Set<string>();
    const subgraphs = workflow.definitions?.subgraphs ?? [];
    const matching = new Set<string>();
    for (const subgraph of subgraphs) {
      const name = subgraph.name || subgraph.id;
      if (fuzzyMatch(normalizedQuery, `${name} ${subgraph.id}`)) {
        matching.add(subgraph.id);
      }
    }
    return matching;
  }, [workflow, searchActive, normalizedQuery]);

  // Filter nodes based on search text only (not container title matches)
  const filteredNodes = useMemo(() => {
    if (!searchActive) return orderedNodes;
    return orderedNodes.filter((node) => {
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
  }, [orderedNodes, searchActive, normalizedQuery, nodeTypes]);

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((node) => node.id)),
    [filteredNodes],
  );

  const baseNestedItems = useMemo(() => {
    if (!workflow) return [];
    return buildNestedListFromLayout(
      mobileLayout,
      workflow,
      collapsedItems,
      hiddenItems,
      stableKeyByPointer,
    );
  }, [
    mobileLayout,
    workflow,
    collapsedItems,
    hiddenItems,
    stableKeyByPointer,
  ]);

  // Build nested list of items to render
  const nestedItems = useMemo(() => {
    if (!workflow) return [];

    if (searchActive) {
      const countNodes = (items: NestedItem[]): number => {
        let count = 0;
        for (const item of items) {
          if (item.type === "hiddenBlock") {
            count += item.count;
          } else if (item.type === "node") {
            count += 1;
          } else {
            count += countNodes(item.children);
          }
        }
        return count;
      };

      const pruneNestedForSearch = (
        items: NestedItem[],
        includeAllDescendants = false,
      ): NestedItem[] => {
        const result: NestedItem[] = [];
        for (const item of items) {
          if (item.type === "hiddenBlock") continue;
          if (item.type === "node") {
            if (includeAllDescendants || filteredNodeIds.has(item.node.id)) {
              result.push(item);
            }
            continue;
          }

          if (includeAllDescendants) {
            const allChildrenExpanded = pruneNestedForSearch(
              item.children,
              true,
            );
            result.push({
              ...item,
              isCollapsed: false,
              nodeCount: countNodes(allChildrenExpanded),
              children: allChildrenExpanded,
            });
            continue;
          }

          if (item.type === "group") {
            const groupMatches = matchingGroupIds.has(item.group.id);
            const prunedChildren = pruneNestedForSearch(
              item.children,
              groupMatches,
            );
            if (groupMatches || prunedChildren.length > 0) {
              result.push({
                ...item,
                isCollapsed: false,
                nodeCount: countNodes(prunedChildren),
                children: prunedChildren,
              });
            }
            continue;
          }

          const subgraphMatches = matchingSubgraphIds.has(item.subgraph.id);
          const prunedChildren = pruneNestedForSearch(item.children, false);
          if (subgraphMatches || prunedChildren.length > 0) {
            result.push({
              ...item,
              isCollapsed: false,
              nodeCount: countNodes(prunedChildren),
              children: prunedChildren,
            });
          }
        }
        return result;
      };

      return pruneNestedForSearch(baseNestedItems);
    }

    return baseNestedItems;
  }, [
    baseNestedItems,
    filteredNodeIds,
    matchingGroupIds,
    matchingSubgraphIds,
    searchActive,
    workflow,
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
      Boolean(
        hiddenItems[requireStableKey(node.stableKey, `node ${node.id}`)],
      );

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
  }, [workflow, connectionHighlightModes, hiddenItems]);

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
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    const handleScrollToNode = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const nodeId = typeof detail === "number" ? detail : detail.nodeId;
      const label = typeof detail === "object" ? detail.label : undefined;
      if (typeof nodeId !== "number") return;
      const resolvedNode = workflow?.nodes.find((entry) => entry.id === nodeId);
      if (!resolvedNode) return;
      const stableKey = requireStableKey(
        resolvedNode.stableKey,
        `node ${resolvedNode.id}`,
      );
      setItemCollapsed(stableKey, false);
      // Use native scrollIntoView instead of virtualizer
      const nodeElement =
        (typeof stableKey === "string"
          ? document.querySelector(`[data-stable-key="${stableKey}"]`)
          : null) ??
        document.querySelector(`[data-reposition-item="node-${nodeId}"]`);
      if (nodeElement) {
        nodeElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      requestAnimationFrame(() => scrollToNode(stableKey, label));
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
  }, [setItemCollapsed, scrollToNode, workflow]);

  useEffect(() => {
    if (!searchOpen) return;
    if (parentRef.current) {
      parentRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      const wrapper = wrapperRef.current;
      const bar = bookmarkBarRef.current;
      const searchEl = searchInputRef.current?.closest(".node-search-bar");
      if (!wrapper || !bar || !searchEl) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const searchRect = searchEl.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const searchBottom = searchRect.bottom - wrapperRect.top;
      const barTop = barRect.top - wrapperRect.top;
      const gap = 8;
      if (barTop < searchBottom + gap) {
        setBookmarkBarPosition({ top: searchBottom + gap });
      }
    });
  }, [searchOpen, setBookmarkBarPosition]);

  useEffect(() => {
    setBookmarkRepositioningActive(isBookmarkRepositioning);
    return () => setBookmarkRepositioningActive(false);
  }, [isBookmarkRepositioning, setBookmarkRepositioningActive]);

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

  useEffect(() => {
    if (!addNodeModalRequest) return;
    if (handledAddNodeModalRequestIdRef.current === addNodeModalRequest.id) {
      return;
    }
    handledAddNodeModalRequestIdRef.current = addNodeModalRequest.id;
    const frame = window.requestAnimationFrame(() => {
      setAddNodeGroupId(addNodeModalRequest.groupId);
      setAddNodeSubgraphId(addNodeModalRequest.subgraphId);
      setAddNodeModalOpen(true);
      clearAddNodeModalRequest();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [addNodeModalRequest, clearAddNodeModalRequest]);

  const hasExpandedNestedItems = (items: NestedItem[]): boolean => {
    for (const item of items) {
      if (item.type === "hiddenBlock") continue;
      if (item.type === "node") {
        const stableKey = requireStableKey(
          item.node.stableKey,
          `node ${item.node.id}`,
        );
        if (!collapsedItems[stableKey]) return true;
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
          if (item.type === "hiddenBlock") continue;
          if (item.type === "node") {
            const stableKey = requireStableKey(
              item.node.stableKey,
              `node ${item.node.id}`,
            );
            setItemCollapsed(stableKey, collapsed);
            continue;
          }
          if (item.type === "group") {
            const groupStableKey = requireStableKey(
              item.stableKey,
              `group ${item.group.id}`,
            );
            setItemCollapsed(groupStableKey, collapsed);
            applyCollapse(item.children);
            continue;
          }
          const stableSubgraphKey = requireStableKey(
            stableSubgraphKeyById.get(item.subgraph.id),
            `subgraph ${item.subgraph.id}`,
          );
          setItemCollapsed(stableSubgraphKey, collapsed);
          applyCollapse(item.children);
        }
      };
      applyCollapse(items);
    },
    [setItemCollapsed, stableSubgraphKeyById],
  );

  const collectHiddenStateFromRefs = useCallback(
    (refs: ItemRef[]) =>
      collectLayoutHiddenState(refs, {
        layout: mobileLayout,
        hiddenItems,
        stableKeyByPointer,
      }),
    [hiddenItems, mobileLayout, stableKeyByPointer],
  );

  const getHiddenStateForGroup = useCallback(
    (groupStableKey: string) =>
      collectHiddenStateFromRefs(
        mobileLayout.groups[groupStableKey] ?? [],
      ),
    [collectHiddenStateFromRefs, mobileLayout],
  );

  const getHiddenStateForSubgraph = useCallback(
    (subgraphId: string) =>
      collectHiddenStateFromRefs(mobileLayout.subgraphs[subgraphId] ?? []),
    [collectHiddenStateFromRefs, mobileLayout],
  );

  const revealHiddenState = useCallback(
    (state: {
      hiddenNodeKeys: Set<string>;
      hiddenGroupKeys: Set<string>;
      hiddenSubgraphIds: Set<string>;
    }) => {
      for (const groupKey of state.hiddenGroupKeys) {
        const stableGroupKey = stableKeyByPointer[groupKey];
        if (!stableGroupKey) continue;
        setItemHidden(stableGroupKey, false);
      }
      for (const subgraphId of state.hiddenSubgraphIds) {
        const stableSubgraphKey = requireStableKey(
          stableSubgraphKeyById.get(subgraphId),
          `subgraph ${subgraphId}`,
        );
        setItemHidden(stableSubgraphKey, false);
      }
      for (const nodeKey of state.hiddenNodeKeys) {
        const stableKey = stableKeyByPointer[nodeKey];
        if (!stableKey) continue;
        setItemHidden(stableKey, false);
      }
    },
    [setItemHidden, stableKeyByPointer, stableSubgraphKeyById],
  );

  const renderItems = (items: NestedItem[], parentKey: string) =>
    items.map((item, index) => {
      const keyBase = `${parentKey}-${index}`;

      if (item.type === "hiddenBlock") {
        return null;
      }

      if (item.type === "group") {
        const group = item.group;
        const backgroundColor = hexToRgba(group.color, 0.15);
        const borderColor = hexToRgba(group.color, 0.4);
        const hasExpandedChildren = hasExpandedNestedItems(item.children);
        const hasVisibleChildren = item.children.some(
          (child) => child.type !== "hiddenBlock",
        );
        const groupStableKey = requireStableKey(
          item.stableKey,
          `group ${item.group.id}`,
        );
        const hiddenState = getHiddenStateForGroup(groupStableKey);
        const isGroupBookmarked = bookmarkedItems.includes(groupStableKey);
        const canShowGroupBookmarkAction =
          bookmarkedItems.length < 5 || isGroupBookmarked;
        const hiddenNodeCount = hiddenState.hiddenNodeCount;
        const foldAllLabel = hasExpandedChildren ? "Fold all" : "Unfold all";
        const handleFoldAll = () => {
          if (!hasExpandedChildren) {
            setItemCollapsed(groupStableKey, false);
          }
          setNestedCollapsed(item.children, hasExpandedChildren);
        };

        return (
          <div
            key={`group-${item.group.id}-${keyBase}`}
            className="group-wrapper shadow-md rounded-xl border mb-3"
            style={{
              backgroundColor,
              borderColor,
            }}
            data-reposition-item={`group-${groupStableKey}`}
            data-stable-key={groupStableKey}
          >
            <GraphContainerHeader
              containerType="group"
              containerId={group.id}
              title={group.title?.trim() || `Group ${group.id}`}
              nodeCount={item.nodeCount}
              isCollapsed={item.isCollapsed}
              backgroundColor={hexToRgba(group.color, 0.22)}
              borderColor={hexToRgba(group.color, 0.4)}
              hiddenNodeCount={hiddenNodeCount}
              isBookmarked={isGroupBookmarked}
              canShowBookmarkAction={canShowGroupBookmarkAction}
              foldAllLabel={foldAllLabel}
              onToggleCollapse={() => setItemCollapsed(groupStableKey, !item.isCollapsed)}
              onToggleBookmark={() => toggleBookmark(groupStableKey)}
              onShowHiddenNodes={() => {
                if (hiddenNodeCount > 0) {
                  revealHiddenState(hiddenState);
                }
              }}
              onToggleFoldAll={handleFoldAll}
              onBypassAll={(bypass) =>
                bypassAllInContainer(groupStableKey, bypass)
              }
              onHide={() => setItemHidden(groupStableKey, true)}
              onAddNode={() => {
                setAddNodeGroupId(item.group.id);
                setAddNodeSubgraphId(item.subgraphId ?? null);
                setAddNodeModalOpen(true);
              }}
              onDelete={() => {
                if (item.nodeCount === 0) {
                  deleteContainer(groupStableKey, { deleteNodes: false });
                  return;
                }
                setDeleteContainerTarget({
                  stableKey: groupStableKey,
                  containerTypeLabel: "group",
                  containerIdLabel: `#${item.group.id}`,
                  displayName:
                    item.group.title?.trim() || `Group ${item.group.id}`,
                  nodeCount: item.nodeCount,
                });
              }}
              onMove={() =>
                reposition.openOverlay({
                  type: "group",
                  id: item.group.id,
                  subgraphId: item.subgraphId ?? null,
                })
              }
              onCommitTitle={(nextTitle) =>
                updateContainerTitle(groupStableKey, nextTitle)
              }
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
                {hiddenNodeCount > 0 && item.nodeCount > 0 && (
                  <div className="px-3 pb-2 -mt-1 text-xs text-gray-400 text-center">
                    {hiddenNodeCount} hidden node
                    {hiddenNodeCount === 1 ? "" : "s"}
                  </div>
                )}
                {hasVisibleChildren ? (
                  renderItems(item.children, keyBase)
                ) : !searchActive || matchingGroupIds.has(item.group.id) ? (
                  <GraphContainerPlaceholder
                    containerType="group"
                    containerId={item.group.id}
                    hiddenNodeCount={hiddenNodeCount}
                    borderColor={hexToRgba(item.group.color, 0.3)}
                    dashedBorderColor={hexToRgba(item.group.color, 0.4)}
                    onClick={() => {
                      setAddNodeGroupId(item.group.id);
                      setAddNodeSubgraphId(item.subgraphId ?? null);
                      setAddNodeModalOpen(true);
                    }}
                  />
                ) : null}
                <ContainerFooter
                  id={`group-footer-${item.group.id}`}
                  headerId={`group-header-${item.group.id}`}
                  title={item.group.title}
                  nodeCount={item.nodeCount}
                  backgroundColor={hexToRgba(item.group.color, 0.15)}
                  borderColor={hexToRgba(item.group.color, 0.3)}
                  textClassName="text-gray-500 dark:text-gray-400"
                  className="group-footer"
                />
              </div>
            </div>
          </div>
        );
      }

      if (item.type === "subgraph") {
        const SUBGRAPH_BG_COLOR = themeColors.brand.subgraphBackground08;
        const SUBGRAPH_BORDER_COLOR = themeColors.brand.subgraphBorder25;
        const subgraphHiddenState = getHiddenStateForSubgraph(item.subgraph.id);
        const subgraphHiddenNodeCount = subgraphHiddenState.hiddenNodeCount;
        const subgraphStableKey =
          requireStableKey(
            stableSubgraphKeyById.get(item.subgraph.id),
            `subgraph ${item.subgraph.id}`,
          );
        const isSubgraphBookmarked = bookmarkedItems.includes(subgraphStableKey);
        const canShowSubgraphBookmarkAction =
          bookmarkedItems.length < 5 || isSubgraphBookmarked;
        const subgraphHasExpandedChildren = hasExpandedNestedItems(item.children);
        const subgraphFoldAllLabel = subgraphHasExpandedChildren
          ? "Fold all"
          : "Unfold all";
        const handleSubgraphFoldAll = () => {
          if (!subgraphHasExpandedChildren) {
            setItemCollapsed(subgraphStableKey, false);
          }
          setNestedCollapsed(item.children, subgraphHasExpandedChildren);
        };

        return (
          <div
            key={`subgraph-${item.subgraph.id}-${keyBase}`}
            className="subgraph-wrapper shadow-md rounded-xl border mb-3"
            style={{
              backgroundColor: `var(--subgraph-bg, ${SUBGRAPH_BG_COLOR})`,
              borderColor: `var(--subgraph-border, ${SUBGRAPH_BORDER_COLOR})`,
              ["--subgraph-bg" as string]: SUBGRAPH_BG_COLOR,
              ["--subgraph-border" as string]: SUBGRAPH_BORDER_COLOR,
            }}
            data-reposition-item={`subgraph-${item.subgraph.id}`}
            data-stable-key={subgraphStableKey}
          >
            <GraphContainerHeader
              containerType="subgraph"
              containerId={item.subgraph.id}
              title={(item.subgraph.name || item.subgraph.id).trim()}
              nodeCount={item.nodeCount}
              isCollapsed={item.isCollapsed}
              backgroundColor={themeColors.brand.subgraphBackground14}
              borderColor={themeColors.brand.subgraphBorder25}
              hiddenNodeCount={subgraphHiddenNodeCount}
              isBookmarked={isSubgraphBookmarked}
              canShowBookmarkAction={canShowSubgraphBookmarkAction}
              foldAllLabel={subgraphFoldAllLabel}
              onToggleCollapse={() =>
                setItemCollapsed(subgraphStableKey, !item.isCollapsed)
              }
              onToggleBookmark={() => toggleBookmark(subgraphStableKey)}
              onBypassAll={(bypass) =>
                bypassAllInContainer(subgraphStableKey, bypass)
              }
              onToggleFoldAll={handleSubgraphFoldAll}
              onShowHiddenNodes={
                () => {
                  if (subgraphHiddenNodeCount > 0) {
                    revealHiddenState(subgraphHiddenState);
                  }
                }
              }
              onHide={() =>
                setItemHidden(subgraphStableKey, true)
              }
              onDelete={() => {
                if (item.nodeCount === 0) {
                  deleteContainer(subgraphStableKey, { deleteNodes: false });
                  return;
                }
                setDeleteContainerTarget({
                  stableKey: subgraphStableKey,
                  containerTypeLabel: "subgraph",
                  containerIdLabel: item.subgraph.id,
                  displayName: item.subgraph.name?.trim() || item.subgraph.id,
                  nodeCount: item.nodeCount
                });
              }}
              onAddNode={() => {
                setAddNodeGroupId(null);
                setAddNodeSubgraphId(item.subgraph.id);
                setAddNodeModalOpen(true);
              }}
              onMove={() =>
                reposition.openOverlay({
                  type: "subgraph",
                  id: item.subgraph.id,
                })
              }
              onCommitTitle={(nextTitle) =>
                updateContainerTitle(subgraphStableKey, nextTitle)
              }
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
                {subgraphHiddenNodeCount > 0 && item.nodeCount > 0 && (
                  <div className="px-3 pb-2 -mt-1 text-xs text-gray-400 text-center">
                    {subgraphHiddenNodeCount} hidden node
                    {subgraphHiddenNodeCount === 1 ? "" : "s"}
                  </div>
                )}
                {item.children.length > 0 ? (
                  renderItems(item.children, keyBase)
                ) : !searchActive || matchingSubgraphIds.has(item.subgraph.id) ? (
                  <GraphContainerPlaceholder
                    containerType="subgraph"
                    containerId={item.subgraph.id}
                    hiddenNodeCount={subgraphHiddenNodeCount}
                    borderColor={themeColors.brand.subgraphBorder20}
                    dashedBorderColor={themeColors.brand.subgraphBorder25}
                    onClick={() => {
                      setAddNodeGroupId(null);
                      setAddNodeSubgraphId(item.subgraph.id);
                      setAddNodeModalOpen(true);
                    }}
                  />
                ) : null}
                <ContainerFooter
                  id={`subgraph-footer-${item.subgraph.id}`}
                  headerId={`subgraph-header-${item.subgraph.id}`}
                  title={item.subgraph.name || item.subgraph.id}
                  nodeCount={item.nodeCount}
                  backgroundColor={themeColors.brand.subgraphBackground10}
                  borderColor={themeColors.brand.subgraphBorder20}
                  textClassName="text-blue-600 dark:text-blue-500"
                  className="subgraph-footer"
                />
              </div>
            </div>
          </div>
        );
      }

      return (
        <div
          key={`node-${item.node.id}-${keyBase}`}
          data-reposition-item={`node-${item.node.id}`}
          data-stable-key={requireStableKey(item.node.stableKey, `node ${item.node.id}`)}
        >
          <NodeCard
            node={item.node}
            isExecuting={executingNodeId === String(item.node.id)}
            isConnectionHighlighted={highlightedNodeIds.has(item.node.id)}
            errorBadgeLabel={errorBadgeByNodeId[item.node.id] ?? null}
            onImageClick={onImageClick}
            onMoveNode={() =>
              reposition.openOverlay({ type: "node", id: item.node.id })
            }
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
          <div className="mt-6 w-64 max-w-full mx-auto">
            <AddNodePlaceholder
              onClick={() => {
                setAddNodeGroupId(null);
                setAddNodeSubgraphId(null);
                setAddNodeModalOpen(true);
              }}
            />
          </div>
        </div>
      </div>
    );
  } else {
    content = (
      <div id="node-list-shell" className="h-full flex flex-col">
        {searchOpen && (
          <div className="node-search-bar bg-gray-100 px-4 py-2">
            <SearchBar
              inputRef={searchInputRef}
              value={searchQuery}
              onChange={setSearchQuery}
              onClear={handleClearSearch}
              placeholder="Search nodes..."
              inputClassName="comfy-input border-gray-300"
            />
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

  return (
    <div
      id="node-list-wrapper"
      ref={wrapperRef}
      className="absolute inset-x-0 top-[69px] bottom-0 bg-gray-100"
      style={{ display: visible ? "block" : "none" }}
    >
      {content}
      <AddNodeModal
        isOpen={addNodeModalOpen}
        addInGroupId={addNodeGroupId}
        addInSubgraphId={addNodeSubgraphId}
        onClose={() => {
          setAddNodeModalOpen(false);
          setAddNodeGroupId(null);
          setAddNodeSubgraphId(null);
        }}
      />
      {deleteContainerTarget && (
        <DeleteContainerModal
          containerTypeLabel={deleteContainerTarget.containerTypeLabel}
          containerIdLabel={deleteContainerTarget.containerIdLabel}
          displayName={deleteContainerTarget.displayName}
          nodeCount={deleteContainerTarget.nodeCount}
          onCancel={() => setDeleteContainerTarget(null)}
          onDeleteContainerOnly={() => {
            deleteContainer(deleteContainerTarget.stableKey, {
              deleteNodes: false,
            });
            setDeleteContainerTarget(null);
          }}
          onDeleteContainerAndNodes={() => {
            deleteContainer(deleteContainerTarget.stableKey, {
              deleteNodes: true,
            });
            setDeleteContainerTarget(null);
          }}
        />
      )}
      {reposition.overlayOpen && reposition.initialTarget && (
        <RepositionOverlay
          mobileLayout={mobileLayout}
          initialTarget={reposition.initialTarget}
          initialViewportAnchor={reposition.initialViewportAnchor}
          onDone={reposition.commitAndClose}
          onCancel={reposition.cancelOverlay}
        />
      )}
      {bookmarkEntries.length > 0 && (
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
            {bookmarkEntries.map((entry, index) => (
              <button
                key={entry.stableKey}
                type="button"
                className="w-10 h-10 rounded-full border border-transparent bg-gray-900/10 text-[11px] font-bold text-gray-800 shadow-sm backdrop-blur-sm dark:bg-white/10 dark:text-gray-100 select-none"
                onClick={handleBookmarkButtonClick(entry, index)}
              >
                {entry.text}
              </button>
            ))}
            {bookmarkEntries.length > 1 && (
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
