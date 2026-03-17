import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { WorkflowLink, WorkflowNode } from "@/api/types";
import { useWorkflowStore, type ScopeFrame } from "@/hooks/useWorkflow";
import { useBookmarksStore } from "@/hooks/useBookmarks";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import { useRepositionMode } from "@/hooks/useRepositionMode";
import { RepositionOverlay } from "@/components/RepositionOverlay";
import {
  flattenLayoutToNodeOrder,
  getGroupKey,
  scopedNodeKey,
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
import { resolveWorkflowColor, themeColors } from "@/theme/colors";
import { requireHierarchicalKey } from "@/utils/itemKeys";
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
  const executingNodePath = useWorkflowStore((s) => s.executingNodePath);
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
  const editContainerLabelRequest = useWorkflowStore(
    (s) => s.editContainerLabelRequest,
  );
  const clearEditContainerLabelRequest = useWorkflowStore(
    (s) => s.clearEditContainerLabelRequest,
  );
  const clearAddNodeModalRequest = useWorkflowStore(
    (s) => s.clearAddNodeModalRequest,
  );
  const collapsedItems = useWorkflowStore((s) => s.collapsedItems);
  const hiddenItems = useWorkflowStore((s) => s.hiddenItems);
  const setItemHidden = useWorkflowStore((s) => s.setItemHidden);
  const bypassAllInContainer = useWorkflowStore((s) => s.bypassAllInContainer);
  const deleteContainer = useWorkflowStore((s) => s.deleteContainer);
  const updateContainerTitle = useWorkflowStore((s) => s.updateContainerTitle);
  const updateWorkflowItemColor = useWorkflowStore((s) => s.updateWorkflowItemColor);
  const mobileLayout = useWorkflowStore((s) => s.mobileLayout);
  const itemKeyByPointer = useWorkflowStore((s) => s.itemKeyByPointer);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const enterSubgraph = useWorkflowStore((s) => s.enterSubgraph);
  const exitSubgraph = useWorkflowStore((s) => s.exitSubgraph);
  const navigateToSubgraphTrail = useWorkflowStore(
    (s) => s.navigateToSubgraphTrail,
  );
  const bookmarkedItems = useBookmarksStore((s) => s.bookmarkedItems);
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bookmarkBarRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [bookmarkCycleIndex, setBookmarkCycleIndex] = useState(0);
  const [pendingBookmarkEntry, setPendingBookmarkEntry] =
    useState<BookmarkEntry | null>(null);
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
    itemKey: string;
    containerTypeLabel: "group" | "subgraph";
    containerIdLabel: string;
    displayName: string;
    nodeCount: number;
  } | null>(null);
  const reposition = useRepositionMode();
  const [topBarHeight, setTopBarHeight] = useState(69);
  const [errorBadgeByNodeId, setErrorBadgeByNodeId] = useState<
    Record<number, string>
  >({});
  const errorBadgeTimeoutsRef = useRef<Map<number, number>>(new Map());
  const bookmarkLongPressRef = useRef<number | null>(null);
  const bookmarkLongPressTriggeredRef = useRef(false);
  const previousTopBarHeightRef = useRef<number | null>(null);
  const bookmarkPointerRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    pointerId: number;
    isButtonPress: boolean;
  } | null>(null);
  const bookmarkDragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const handledAddNodeModalRequestIdRef = useRef<number | null>(null);
  const nodeItemKeyByScopedKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of workflow?.nodes ?? []) {
      map.set(
        scopedNodeKey(node.id, null),
        requireHierarchicalKey(node.itemKey, `node ${node.id}`),
      );
    }
    for (const sg of workflow?.definitions?.subgraphs ?? []) {
      for (const node of sg.nodes ?? []) {
        if (node.itemKey) {
          map.set(scopedNodeKey(node.id, sg.id), node.itemKey);
        }
      }
    }
    return map;
  }, [workflow]);
  const subgraphItemKeyById = useMemo(
    () =>
      new Map(
        (workflow?.definitions?.subgraphs ?? []).map((subgraph) => [
          subgraph.id,
          requireHierarchicalKey(subgraph.itemKey, `subgraph ${subgraph.id}`),
        ]),
      ),
    [workflow],
  );

  // Scope-aware workflow and layout for subgraph navigation
  const currentScopeFrame = scopeStack[scopeStack.length - 1];
  const currentSubgraphId =
    currentScopeFrame?.type === "subgraph" ? currentScopeFrame.id : null;
  const currentScopePlaceholderPath = useMemo(
    () =>
      scopeStack
        .filter((frame): frame is Extract<ScopeFrame, { type: "subgraph" }> => frame.type === "subgraph")
        .map((frame) => frame.placeholderNodeId),
    [scopeStack],
  );
  const currentScopeSubgraphTrail = useMemo(
    () =>
      scopeStack
        .filter(
          (frame): frame is Extract<ScopeFrame, { type: "subgraph" }> =>
            frame.type === "subgraph",
        )
        .map((frame) => frame.id),
    [scopeStack],
  );

  const executingNodeIdInScope = useMemo(() => {
    if (!executingNodePath) return null;
    const parts = executingNodePath
      .split(":")
      .map((part) => Number(part))
      .filter((value) => Number.isFinite(value));
    if (parts.length === 0) return null;
    const executionScopePath = parts.slice(0, -1);
    const executionLeafNodeId = parts[parts.length - 1];

    if (executionScopePath.length < currentScopePlaceholderPath.length) return null;
    for (let i = 0; i < currentScopePlaceholderPath.length; i += 1) {
      if (executionScopePath[i] !== currentScopePlaceholderPath[i]) return null;
    }

    if (executionScopePath.length === currentScopePlaceholderPath.length) {
      return executionLeafNodeId;
    }
    return executionScopePath[currentScopePlaceholderPath.length] ?? null;
  }, [executingNodePath, currentScopePlaceholderPath]);

  const currentScopeWorkflow = useMemo(() => {
    if (!workflow) return null;
    if (!currentSubgraphId) return workflow;
    const subgraph = workflow?.definitions?.subgraphs?.find(
      (sg) => sg.id === currentSubgraphId,
    );
    if (!subgraph) return workflow;
    // Use the subgraph's own nodes AND links so that link traversal within
    // this scope (connection highlighting, ConnectionButton) works correctly.
    return {
      ...workflow,
      nodes: subgraph.nodes ?? [],
      links: (subgraph.links ?? []).map(
        (l) => [l.id, l.origin_id, l.origin_slot, l.target_id, l.target_slot, l.type] as WorkflowLink,
      ),
    };
  }, [workflow, currentSubgraphId]);

  const currentScopeMobileLayout = useMemo(() => {
    if (!currentSubgraphId) return mobileLayout;
    const subgraphLayout = mobileLayout.subgraphs[currentSubgraphId] ?? [];
    return { ...mobileLayout, root: subgraphLayout };
  }, [mobileLayout, currentSubgraphId]);

  // Back-button / hardware-back: push a history state when entering a subgraph
  // so the browser back button calls exitSubgraph instead of leaving the app.
  const scopeDepth = scopeStack.length;
  useEffect(() => {
    if (scopeDepth <= 1) return;
    window.history.pushState({ mobileSubgraphNav: true }, "");
    const handlePopState = () => {
      exitSubgraph();
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [scopeDepth, exitSubgraph]);

  // Track top bar height so the node list wrapper stays below the breadcrumb when visible.
  useEffect(() => {
    const el = document.getElementById("top-bar-root");
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setTopBarHeight(entry.target.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchOpen(false);
  };

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
      findPathToBookmarkedHierarchicalKey,
      setItemCollapsed,
      setItemHidden,
      itemKeyByPointer,
      subgraphItemKeyById,
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

  const handleBookmarkButtonClick = useCallback(
    (entry: BookmarkEntry, index: number) => () => {
      if (bookmarkLongPressTriggeredRef.current) {
        bookmarkLongPressTriggeredRef.current = false;
        return;
      }
      if (isBookmarkRepositioning) {
        setIsBookmarkRepositioning(false);
        setIsBookmarkDragging(false);
        setBookmarkDragPosition(null);
        return;
      }
      setBookmarkCycleIndex(index);
      navigateToBookmarkEntry(entry);
    },
    [
      isBookmarkRepositioning,
      navigateToBookmarkEntry,
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
    navigateToBookmarkEntry(entry);
  }, [
    bookmarkEntries,
    bookmarkCycleIndex,
    isBookmarkRepositioning,
    navigateToBookmarkEntry,
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
        event.currentTarget.setPointerCapture(event.pointerId);
      } else if (isButtonPress) {
        bookmarkLongPressRef.current = window.setTimeout(() => {
          bookmarkLongPressTriggeredRef.current = true;
          setIsBookmarkRepositioning(true);
          startBookmarkDrag(event.clientX, event.clientY);
        }, 500);
      } else {
        event.preventDefault();
        bookmarkLongPressRef.current = window.setTimeout(() => {
          bookmarkLongPressTriggeredRef.current = true;
          setIsBookmarkRepositioning(true);
          startBookmarkDrag(event.clientX, event.clientY);
        }, 500);
        event.currentTarget.setPointerCapture(event.pointerId);
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
  }, [bookmarkDragPosition, clampBookmarkTop, setBookmarkBarPosition]);

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

  const orderedNodes = useMemo(() => {
    if (!currentScopeWorkflow) return [];
    const flatOrder: number[] = flattenLayoutToNodeOrder(currentScopeMobileLayout);
    const nodeMap = new Map(currentScopeWorkflow.nodes.map((n) => [n.id, n]));
    const ordered: WorkflowNode[] = [];
    for (const id of flatOrder) {
      const node = nodeMap.get(id);
      if (node) ordered.push(node);
    }
    // Append any nodes not in the layout
    const inLayout = new Set(flatOrder);
    for (const node of currentScopeWorkflow.nodes) {
      if (!inLayout.has(node.id)) ordered.push(node);
    }
    return Object.keys(hiddenItems).length === 0
      ? ordered
      : ordered.filter(
          (node) => {
            const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
            return !hiddenItems[itemKey];
          },
        );
  }, [currentScopeWorkflow, hiddenItems, currentScopeMobileLayout]);

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
    if (!currentScopeWorkflow) return [];
    return buildNestedListFromLayout(
      currentScopeMobileLayout,
      currentScopeWorkflow,
      collapsedItems,
      hiddenItems,
      currentSubgraphId,
    );
  }, [
    currentScopeMobileLayout,
    currentScopeWorkflow,
    collapsedItems,
    hiddenItems,
    currentSubgraphId,
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
    if (!currentScopeWorkflow) return new Set<number>();
    const activeEntries = Object.entries(connectionHighlightModes)
      .filter(([, mode]) => mode !== "off")
      .map(([id, mode]) => ({ id: Number(id), mode }));
    if (activeEntries.length === 0) return new Set<number>();

    const nodeMap = new Map(currentScopeWorkflow.nodes.map((node) => [node.id, node]));
    const highlighted = new Set<number>();
    const isHiddenNode = (node: (typeof currentScopeWorkflow.nodes)[number]) =>
      Boolean(
        hiddenItems[requireHierarchicalKey(node.itemKey, `node ${node.id}`)],
      );

    const collectTargets = (
      nodeId: number,
      seen: Set<number>,
      desiredTypes: Set<string>,
    ): Array<(typeof currentScopeWorkflow.nodes)[number]> => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const targets: Array<(typeof currentScopeWorkflow.nodes)[number]> = [];
      node.outputs?.forEach((output, index) => {
        const outputTypes = normalizeTypes(output.type);
        if (
          desiredTypes.size > 0 &&
          !outputTypes.some((type) => desiredTypes.has(type))
        )
          return;
        const connections = findConnectedOutputNodes(currentScopeWorkflow, nodeId, index);
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
    ): Array<(typeof currentScopeWorkflow.nodes)[number]> => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const sources: Array<(typeof currentScopeWorkflow.nodes)[number]> = [];
      node.inputs?.forEach((input, index) => {
        if (input.link === null) return;
        const inputTypes = normalizeTypes(input.type);
        if (
          desiredTypes.size > 0 &&
          !inputTypes.some((type) => desiredTypes.has(type))
        )
          return;
        const connected = findConnectedNode(currentScopeWorkflow, nodeId, index);
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
          const connected = findConnectedNode(currentScopeWorkflow, activeNode.id, index);
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
            currentScopeWorkflow,
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
  }, [currentScopeWorkflow, connectionHighlightModes, hiddenItems]);

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
      const itemKey = requireHierarchicalKey(
        resolvedNode.itemKey,
        `node ${resolvedNode.id}`,
      );
      setItemCollapsed(itemKey, false);
      // Use native scrollIntoView instead of virtualizer
      const nodeElement =
        (typeof itemKey === "string"
          ? document.querySelector(`[data-item-key="${itemKey}"]`)
          : null) ??
        document.querySelector(`[data-reposition-item="node-${nodeId}"]`);
      if (nodeElement) {
        nodeElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      requestAnimationFrame(() => scrollToNode(itemKey, label));
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
        const itemKey = requireHierarchicalKey(
          item.node.itemKey,
          `node ${item.node.id}`,
        );
        if (!collapsedItems[itemKey]) return true;
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
            const itemKey = requireHierarchicalKey(
              item.node.itemKey,
              `node ${item.node.id}`,
            );
            setItemCollapsed(itemKey, collapsed);
            continue;
          }
          if (item.type === "group") {
            const groupHierarchicalKey = requireHierarchicalKey(
              item.group.itemKey,
              `group ${item.group.id}`,
            );
            setItemCollapsed(groupHierarchicalKey, collapsed);
            applyCollapse(item.children);
            continue;
          }
          const subgraphItemKey = requireHierarchicalKey(
            subgraphItemKeyById.get(item.subgraph.id),
            `subgraph ${item.subgraph.id}`,
          );
          setItemCollapsed(subgraphItemKey, collapsed);
          applyCollapse(item.children);
        }
      };
      applyCollapse(items);
    },
    [setItemCollapsed, subgraphItemKeyById],
  );

  const collectHiddenStateFromRefs = useCallback(
    (refs: ItemRef[]) =>
      collectLayoutHiddenState(refs, {
        layout: mobileLayout,
        hiddenItems,
      }),
    [hiddenItems, mobileLayout],
  );

  const getHiddenStateForGroup = useCallback(
    (groupHierarchicalKey: string) =>
      collectHiddenStateFromRefs(
        mobileLayout.groups[groupHierarchicalKey] ?? [],
      ),
    [collectHiddenStateFromRefs, mobileLayout],
  );

  const revealHiddenState = useCallback(
    (state: {
      hiddenNodeKeys: Set<string>;
      hiddenGroupKeys: Set<string>;
      hiddenSubgraphIds: Set<string>;
    }) => {
      for (const groupKey of state.hiddenGroupKeys) {
        const groupItemKey = itemKeyByPointer[groupKey];
        if (!groupItemKey) continue;
        setItemHidden(groupItemKey, false);
      }
      for (const subgraphId of state.hiddenSubgraphIds) {
        const subgraphItemKey = requireHierarchicalKey(
          subgraphItemKeyById.get(subgraphId),
          `subgraph ${subgraphId}`,
        );
        setItemHidden(subgraphItemKey, false);
      }
      for (const nodeKey of state.hiddenNodeKeys) {
        const itemKey = itemKeyByPointer[nodeKey];
        if (!itemKey) continue;
        setItemHidden(itemKey, false);
      }
    },
    [setItemHidden, itemKeyByPointer, subgraphItemKeyById],
  );

  function hasNestedNodeMatching(items: NestedItem[], predicate: (mode: number) => boolean): boolean {
    for (const item of items) {
      if (item.type === "hiddenBlock") continue;
      if (item.type === "node") {
        if (predicate(item.node.mode ?? 0)) return true;
        continue;
      }
      if (hasNestedNodeMatching(item.children, predicate)) return true;
    }
    return false;
  }

  const renderItems = (items: NestedItem[], parentKey: string) =>
    items.map((item, index) => {
      const keyBase = `${parentKey}-${index}`;

      if (item.type === "hiddenBlock") {
        return null;
      }

      if (item.type === "group") {
        const group = item.group;
        const resolvedGroupColor = resolveWorkflowColor(group.color);
        const backgroundColor = hexToRgba(resolvedGroupColor, 0.15);
        const borderColor = hexToRgba(resolvedGroupColor, 0.4);
        const hasExpandedChildren = hasExpandedNestedItems(item.children);
        const hasVisibleChildren = item.children.some(
          (child) => child.type !== "hiddenBlock",
        );
        const groupHierarchicalKey = requireHierarchicalKey(
          item.group.itemKey,
          `group ${item.group.id}`,
        );
        const hiddenState = getHiddenStateForGroup(groupHierarchicalKey);
        const isGroupBookmarked = bookmarkedItems.includes(groupHierarchicalKey);
        const canShowGroupBookmarkAction =
          bookmarkedItems.length < 5 || isGroupBookmarked;
        const hiddenNodeCount = hiddenState.hiddenNodeCount;
        const hasBypassedNodes = hasNestedNodeMatching(item.children, (m) => m === 4);
        const hasEngagedNodes = hasNestedNodeMatching(item.children, (m) => m !== 4);
        const foldAllLabel = hasExpandedChildren ? "Fold all" : "Unfold all";
        const handleFoldAll = () => {
          if (!hasExpandedChildren) {
            setItemCollapsed(groupHierarchicalKey, false);
          }
          setNestedCollapsed(item.children, hasExpandedChildren);
        };

        const bypassState: 'none' | 'partial' | 'all' =
          item.bypassedNodeCount === 0 ? 'none'
          : item.bypassedNodeCount >= item.nodeCount ? 'all'
          : 'partial';

        return (
          <div
            key={`group-${item.group.id}-${keyBase}`}
            className="group-wrapper shadow-md rounded-xl border mb-3 overflow-hidden"
            style={{
              backgroundColor: bypassState === 'all' ? hexToRgba(themeColors.brand.bypassPurple, 0.08) : backgroundColor,
              borderColor: bypassState === 'all' ? hexToRgba(themeColors.brand.bypassPurple, 0.3) : borderColor,
            }}
            data-reposition-item={`group-${groupHierarchicalKey}`}
            data-item-key={groupHierarchicalKey}
          >
            <GraphContainerHeader
              containerType="group"
              containerId={group.id}
              title={group.title?.trim() || `Group ${group.id}`}
              nodeCount={item.nodeCount}
              isCollapsed={item.isCollapsed}
              color={resolvedGroupColor}
              bypassState={bypassState}
              bypassedNodeCount={item.bypassedNodeCount}
              hiddenNodeCount={hiddenNodeCount}
              isBookmarked={isGroupBookmarked}
              canShowBookmarkAction={canShowGroupBookmarkAction}
              foldAllLabel={foldAllLabel}
              onToggleCollapse={() => setItemCollapsed(groupHierarchicalKey, !item.isCollapsed)}
              onToggleBookmark={() => toggleBookmark(groupHierarchicalKey)}
              onShowHiddenNodes={() => {
                if (hiddenNodeCount > 0) {
                  revealHiddenState(hiddenState);
                }
              }}
              onToggleFoldAll={handleFoldAll}
              onBypassAll={(bypass) =>
                bypassAllInContainer(groupHierarchicalKey, bypass)
              }
              onHide={() => setItemHidden(groupHierarchicalKey, true)}
              onAddNode={() => {
                setAddNodeGroupId(item.group.id);
                setAddNodeSubgraphId(item.subgraphId ?? null);
                setAddNodeModalOpen(true);
              }}
              onDelete={() => {
                if (item.nodeCount === 0) {
                  deleteContainer(groupHierarchicalKey, { deleteNodes: false });
                  return;
                }
                setDeleteContainerTarget({
                  itemKey: groupHierarchicalKey,
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
                updateContainerTitle(groupHierarchicalKey, nextTitle)
              }
              onChangeColor={(nextColor) =>
                updateWorkflowItemColor(groupHierarchicalKey, nextColor)
              }
              containerColor={resolvedGroupColor}
              labelEditRequestId={
                editContainerLabelRequest?.itemKey === groupHierarchicalKey
                  ? editContainerLabelRequest.id
                  : null
              }
              labelEditInitialValue={
                editContainerLabelRequest?.itemKey === groupHierarchicalKey
                  ? (editContainerLabelRequest.initialValue ?? "")
                  : ""
              }
              onLabelEditRequestHandled={() => {
                if (editContainerLabelRequest?.itemKey === groupHierarchicalKey) {
                  clearEditContainerLabelRequest();
                }
              }}
              showBypassAllAction={hasEngagedNodes}
              showUnbypassAllAction={hasBypassedNodes}
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
                    color={resolvedGroupColor}
                    onClick={() => {
                      setAddNodeGroupId(item.group.id);
                      setAddNodeSubgraphId(item.subgraphId ?? null);
                      setAddNodeModalOpen(true);
                    }}
                  />
                ) : null}
              </div>
            </div>
            {!item.isCollapsed && (
              <ContainerFooter
                id={`group-footer-${item.group.id}`}
                headerId={`group-header-${item.group.id}`}
                title={item.group.title}
                nodeCount={item.nodeCount}
                color={resolvedGroupColor}
                textClassName="text-gray-500 dark:text-gray-400"
                className="group-footer"
                allBypassed={bypassState === 'all'}
              />
            )}
          </div>
        );
      }

      if (item.type === "subgraph") {
        // In the canonical model, subgraph placeholders are rendered as NodeCards.
        // The placeholder node is the root canonical node whose type = the subgraph UUID.
        const placeholderNode = currentScopeWorkflow?.nodes.find(
          (n) => n.type === item.subgraph.id,
        );
        if (!placeholderNode) return null;

        return (
          <div
            key={`subgraph-placeholder-${item.subgraph.id}-${keyBase}`}
            data-reposition-item={`node-${placeholderNode.id}`}
            data-item-key={requireHierarchicalKey(
              placeholderNode.itemKey,
              `subgraph-placeholder ${item.subgraph.id}`,
            )}
          >
            <NodeCard
              node={placeholderNode}
              isExecuting={executingNodeIdInScope === placeholderNode.id}
              isConnectionHighlighted={highlightedNodeIds.has(placeholderNode.id)}
              errorBadgeLabel={errorBadgeByNodeId[placeholderNode.id] ?? null}
              onImageClick={onImageClick}
              onMoveNode={() =>
                reposition.openOverlay({ type: "subgraph", id: item.subgraph.id })
              }
              onEnterSubgraph={() => enterSubgraph(placeholderNode.id)}
            />
          </div>
        );
      }

      return (
        <div
          key={`node-${item.node.id}-${keyBase}`}
          data-reposition-item={`node-${item.node.id}`}
          data-item-key={requireHierarchicalKey(item.node.itemKey, `node ${item.node.id}`)}
        >
          <NodeCard
            node={item.node}
            isExecuting={executingNodeIdInScope === item.node.id}
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
      className="absolute inset-x-0 bottom-0 bg-gray-100"
      style={{ display: visible ? "block" : "none", top: topBarHeight }}
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
            deleteContainer(deleteContainerTarget.itemKey, {
              deleteNodes: false,
            });
            setDeleteContainerTarget(null);
          }}
          onDeleteContainerAndNodes={() => {
            deleteContainer(deleteContainerTarget.itemKey, {
              deleteNodes: true,
            });
            setDeleteContainerTarget(null);
          }}
        />
      )}
      {reposition.overlayOpen && reposition.initialTarget && (
        <RepositionOverlay
          mobileLayout={mobileLayout}
          scopeSubgraphId={currentSubgraphId}
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
                key={entry.itemKey}
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
