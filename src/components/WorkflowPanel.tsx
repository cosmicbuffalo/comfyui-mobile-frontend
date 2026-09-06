import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { WorkflowNode } from "@/api/types";
import { getScopedWorkflowView } from "@/utils/canonicalWorkflowOps";
import { useWorkflowStore, type ScopeFrame } from "@/hooks/useWorkflow";
import { useWorkflowSelectionStore } from "@/hooks/useWorkflowSelection";
import { useBookmarksStore } from "@/hooks/useBookmarks";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import { useNoWorkflowImageModal } from "@/hooks/useNoWorkflowImageModal";
import { readWorkflowFromFile } from "@/utils/workflowFromFile";
import { useRepositionMode, type RepositionTarget } from "@/hooks/useRepositionMode";
import { pushBackEntry } from "@/hooks/useHistoryBackClose";
import { RepositionOverlay } from "@/components/RepositionOverlay";
import {
  flattenLayoutToNodeOrder,
  scopedNodeKey,
  type ItemRef,
} from "@/utils/mobileLayout";
import { collectLayoutHiddenState } from "@/utils/layoutHiddenState";
import { resolveConnectionHighlightSources } from "@/utils/connectionHighlighting";
import {
  findConnectedNode,
  findConnectedOutputNodes,
} from "@/utils/nodeOrdering";
import {
  buildNestedListFromLayout,
  hexToRgba,
  type NestedItem,
} from "@/utils/grouping";
import { collectAllWorkflowGroups } from "@/utils/workflowNodes";
import { NodeCard } from "./WorkflowPanel/NodeCard";
import { AddItemControls } from "./WorkflowPanel/AddItemControls";
import { SubgraphConnectionsSection } from "./WorkflowPanel/SubgraphConnectionsSection";
import { SubgraphScopeHeader } from "./WorkflowPanel/SubgraphScopeHeader";
import { ContainerFooter } from "./WorkflowPanel/ContainerFooter";
import { GraphContainerHeader } from "./WorkflowPanel/GraphContainer/Header";
import { useWorkflowClipboardStore } from "@/hooks/useWorkflowClipboard";
import { GraphContainerPlaceholder } from "./WorkflowPanel/GraphContainer/Placeholder";
import { GroupHiddenSelectionPlaceholder } from "./WorkflowPanel/GroupHiddenSelectionPlaceholder";
import { GroupSelectionActions } from "./WorkflowPanel/GroupSelectionActions";
import { AddNodeModal } from "@/components/modals/AddNodeModal";
import { DeleteContainerModal } from "@/components/modals/DeleteContainerModal";
import { MoveIntoSubgraphModal } from "@/components/modals/MoveIntoSubgraphModal";
import { RemoveHarvestedNodesDialog } from "@/components/modals/RemoveHarvestedNodesDialog";
import { SearchBar } from "@/components/SearchBar";
import { resolveWorkflowColor, themeColors } from "@/theme/colors";
import { requireHierarchicalKey } from "@/utils/itemKeys";
import {
  ArrowRightIcon,
  BookmarkIconSvg,
  CaretDownIcon,
  CaretUpIcon,
  DocumentIcon,
  EmptyWorkflowIcon,
} from "@/components/icons";
import { fuzzyMatch, normalizeTypes } from "@/utils/workflowSearch";
import { useErrorBadges } from "./WorkflowPanel/useErrorBadges";
import { useExecutionFollower } from "./WorkflowPanel/useExecutionFollower";
import { useI18n } from "@/i18n";
import { useBookmarkBar } from "./WorkflowPanel/useBookmarkBar";
import { ParentageEntry } from "@/components/ParentageEntry";
import { BOOKMARK_CHIP_ALPHA } from "@/utils/workflowSurfaceColor";
import { collectGroupSelectionKeys } from "@/utils/workflowSelection";
import { resolveNodeIdentityFromHierarchicalKey } from "@/utils/workflowHierarchy";
import { useWorkflowPanelScrollMemory } from "./WorkflowPanel/useWorkflowPanelScrollMemory";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { usePanelSearchShortcut } from "@/hooks/usePanelSearchShortcut";
import { useWorkflowUndoShortcuts } from "@/hooks/useWorkflowUndoShortcuts";
import { WorkflowUndoToast } from "./WorkflowPanel/WorkflowUndoToast";
import { collectMoveIntoSubgraphTargets } from "@/utils/moveIntoSubgraphTargets";

export const WorkflowPanel = memo(function WorkflowPanel({
  visible,
  onImageClick,
}: {
  visible: boolean;
  onImageClick?: (
    images: Array<{ src: string; alt?: string }>,
    index: number,
    enableFollowQueue?: boolean,
  ) => void;
}) {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const workflow = useWorkflowStore((s) => s.workflow);
  const executingNodePath = useWorkflowStore((s) => s.executingNodePath);
  const connectionHighlightModes = useWorkflowStore(
    (s) => s.connectionHighlightModes,
  );
  const bookmarkBarSide = useBookmarksStore((s) => s.bookmarkBarSide);
  const bookmarkBarTop = useBookmarksStore((s) => s.bookmarkBarTop);
  const bookmarkBarCollapsed = useBookmarksStore((s) => s.bookmarkBarCollapsed);
  const bookmarkBarCollapsedTop = useBookmarksStore((s) => s.bookmarkBarCollapsedTop);
  const setBookmarkBarCollapsed = useBookmarksStore((s) => s.setBookmarkBarCollapsed);
  const setBookmarkBarPosition = useBookmarksStore(
    (s) => s.setBookmarkBarPosition,
  );
  const setBookmarkRepositioningActive = useBookmarksStore(
    (s) => s.setBookmarkRepositioningActive,
  );
  const setItemCollapsed = useWorkflowStore((s) => s.setItemCollapsed);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const jumpToWorkflowItem = useWorkflowStore((s) => s.jumpToWorkflowItem);
  const revealNodeWithParents = useWorkflowStore(
    (s) => s.revealNodeWithParents,
  );
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const nodeErrors = useWorkflowErrorsStore((s) => s.nodeErrors);
  const nodeErrorsByItemKey = useWorkflowErrorsStore((s) => s.nodeErrorsByItemKey);
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
  const copyContainer = useWorkflowStore((s) => s.copyContainer);
  const duplicateContainer = useWorkflowStore((s) => s.duplicateContainer);
  const moveItemsIntoSubgraph = useWorkflowStore((s) => s.moveItemsIntoSubgraph);
  const pasteIntoContainer = useWorkflowStore((s) => s.pasteIntoContainer);
  const clipboardSummary = useWorkflowClipboardStore((s) => s.payload?.summary ?? null);
  const updateContainerTitle = useWorkflowStore((s) => s.updateContainerTitle);
  const updateWorkflowItemColor = useWorkflowStore((s) => s.updateWorkflowItemColor);
  const mobileLayout = useWorkflowStore((s) => s.mobileLayout);
  const itemKeyByPointer = useWorkflowStore((s) => s.itemKeyByPointer);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const activeSessionId = useWorkflowStore((s) => s.activeSessionId);
  const addGroupNearNode = useWorkflowStore((s) => s.addGroupNearNode);
  const enterSubgraph = useWorkflowStore((s) => s.enterSubgraph);
  const exitSubgraph = useWorkflowStore((s) => s.exitSubgraph);
  const bookmarkedItems = useBookmarksStore((s) => s.bookmarkedItems);
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  const [moveIntoSubgraphItemKeys, setMoveIntoSubgraphItemKeys] = useState<string[] | null>(null);
  // Nodes a move left feeding nothing; non-empty opens the removal offer.
  const [harvestedNodeIds, setHarvestedNodeIds] = useState<number[]>([]);
  const reposition = useRepositionMode();
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const [topBarHeight, setTopBarHeight] = useState(69);
  // Drag-and-drop a workflow .json or an image (workflow extracted from its
  // embedded metadata) onto the panel to load it. dragDepthRef counters the
  // enter/leave events that fire for descendant elements so the overlay doesn't
  // flicker as the cursor moves over child nodes.
  const [isFileDragging, setIsFileDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const previousTopBarHeightRef = useRef<number | null>(null);
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

  useExecutionFollower(visible);

  // Scope-aware workflow and layout for subgraph navigation
  const currentScopeFrame = scopeStack[scopeStack.length - 1];
  const currentSubgraphId =
    currentScopeFrame?.type === "subgraph" ? currentScopeFrame.id : null;
  // The breadcrumb retains a transparent row at root to avoid changing the top
  // bar's measured height. Let the root viewport extend beneath that row so it
  // remains visually absent and content can scroll through it.
  const workflowViewportTop = currentSubgraphId
    ? topBarHeight
    : Math.max(0, topBarHeight - 33);

  // Selection is scoped to the current view: clear it whenever the scope changes
  // (entering/exiting a subgraph) so bulk ops always act within one scope.
  const clearWorkflowSelection = useWorkflowSelectionStore((s) => s.clearSelection);
  const workflowSelectionMode = useWorkflowSelectionStore((s) => s.selectionMode);
  const exitWorkflowSelectionMode = useWorkflowSelectionStore((s) => s.exitSelectionMode);
  useEffect(() => {
    clearWorkflowSelection();
  }, [currentSubgraphId, clearWorkflowSelection]);

  useEffect(() => {
    if (!visible || !workflowSelectionMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      exitWorkflowSelectionMode();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, workflowSelectionMode, exitWorkflowSelectionMode]);

  usePanelSearchShortcut({
    visible,
    searchOpen,
    setSearchOpen,
    inputRef: searchInputRef,
  });
  useWorkflowUndoShortcuts(visible);

  // Bottom-of-list quick-add: add a node or an empty group at the bottom of the
  // current scope (root or the subgraph we're inside).
  // "Move into subgraph" only leads somewhere when this scope actually holds a
  // subgraph the item could go into. Inside a subgraph with nothing nested in
  // it, the action opened a picker with no destinations, so it is not offered.
  const canMoveIntoSubgraph = useCallback(
    (itemKey: string) =>
      collectMoveIntoSubgraphTargets(workflow, scopeStack, [itemKey]).length > 0,
    [workflow, scopeStack],
  );

  const handleAddNodeInScope = useCallback(() => {
    setAddNodeGroupId(null);
    setAddNodeSubgraphId(currentSubgraphId);
    setAddNodeModalOpen(true);
  }, [currentSubgraphId]);
  const handleAddGroupInScope = useCallback(() => {
    addGroupNearNode(null, currentSubgraphId);
  }, [addGroupNearNode, currentSubgraphId]);
  const currentScopePlaceholderPath = useMemo(
    () =>
      scopeStack
        .filter((frame): frame is Extract<ScopeFrame, { type: "subgraph" }> => frame.type === "subgraph")
        .map((frame) => frame.placeholderNodeId),
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

  // Scope view with the subgraph's own nodes AND links (converted to tuples)
  // so link traversal within this scope works correctly.
  const currentScopeWorkflow = useMemo(
    () => (workflow ? getScopedWorkflowView(workflow, currentSubgraphId) : null),
    [workflow, currentSubgraphId],
  );

  const {
    bookmarkBarRef,
    bookmarkListRef,
    bookmarkListMaskStyle,
    bookmarkTopFade,
    bookmarkBottomFade,
    bookmarkEdgeFadeSize,
    bookmarkListScrollLocked,
    canCycleBookmarks,
    canCycleBookmarksBack,
    updateBookmarkScrollFades,
    scrollBookmarkEdge,
    bookmarkEntries,
    isBookmarkRepositioning,
    bookmarkBarStyle,
    handleBookmarkButtonClick,
    handleBookmarkParentClick,
    handleBookmarkCycleClick,
    handleBookmarkCycleBackClick,
    consumeBookmarkPressIntent,
    handleBookmarkPointerDown,
    handleBookmarkPointerMove,
    handleBookmarkPointerUp,
    handleBookmarkPointerCancel,
  } = useBookmarkBar({
    workflow,
    nodeTypes,
    isDesktop,
    mobileLayout,
    nodeItemKeyByScopedKey,
    subgraphItemKeyById,
    jumpToWorkflowItem,
    revealNodeWithParents,
    bookmarkedItems,
    bookmarkBarSide,
    bookmarkBarTop,
    setBookmarkBarPosition,
    bookmarkBarCollapsed,
    bookmarkBarCollapsedTop,
    // Only desktop pins the exit button in the gutter; on mobile it rides in
    // the scope header, where nothing else competes for the space.
    leftGutterReserved: isDesktop && Boolean(currentSubgraphId),
    setBookmarkBarCollapsed,
    wrapperRef,
    previousTopBarHeightRef,
    topBarHeight,
  });

  const currentScopeMobileLayout = useMemo(() => {
    if (!currentSubgraphId) return mobileLayout;
    const subgraphLayout = mobileLayout.subgraphs[currentSubgraphId] ?? [];
    return { ...mobileLayout, root: subgraphLayout };
  }, [mobileLayout, currentSubgraphId]);

  // Back-button / hardware-back: one history entry per subgraph level so Back
  // exits the subgraph instead of leaving the app. Exiting through the
  // breadcrumb releases the entries (consuming the pushed history states) so
  // they don't linger and silently eat later Back presses.
  const scopeDepth = scopeStack.length;
  const prevScopeDepthRef = useRef(scopeDepth);
  const navEntryReleasesRef = useRef<Array<() => void>>([]);
  useEffect(() => {
    const prevDepth = prevScopeDepthRef.current;
    prevScopeDepthRef.current = scopeDepth;
    if (scopeDepth > prevDepth) {
      for (let level = prevDepth; level < scopeDepth; level += 1) {
        navEntryReleasesRef.current.push(pushBackEntry(() => exitSubgraph()));
      }
      return;
    }
    for (let level = scopeDepth; level < prevDepth; level += 1) {
      navEntryReleasesRef.current.pop()?.();
    }
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
    const groups = collectAllWorkflowGroups(workflow);
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
      const errors = (node.itemKey ? nodeErrorsByItemKey[node.itemKey] : undefined)
        ?? nodeErrors[String(node.id)];
      if (errors && errors.length > 0) {
        order += 1;
        map.set(node.id, order);
      }
    }
    return map;
  }, [orderedNodes, nodeErrors, nodeErrorsByItemKey]);

  const highlightedNodeIds = useMemo(() => {
    if (!currentScopeWorkflow) return new Set<number>();
    const activeEntries = resolveConnectionHighlightSources(
      currentScopeWorkflow.nodes,
      connectionHighlightModes,
    );
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

    activeEntries.forEach(({ node: activeNode, mode }) => {
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

  const errorBadgeByNodeId = useErrorBadges(filteredNodes, errorOrderByNodeId);

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
    const handleScrollToTop = () => {
      parentRef.current?.scrollTo({ top: 0, behavior: "auto" });
    };

    window.addEventListener(
      "workflow-scroll-to-top",
      handleScrollToTop as EventListener,
    );
    return () =>
      window.removeEventListener(
        "workflow-scroll-to-top",
        handleScrollToTop as EventListener,
      );
  }, []);

  // The same list element is reused across tabs and subgraph scopes. Preserve
  // each view independently so scrolling inside a subgraph cannot move root.
  const handleNodeListScroll = useWorkflowPanelScrollMemory(
    parentRef,
    activeSessionId,
    scopeStack,
  );

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
  }, [bookmarkBarRef, searchOpen, setBookmarkBarPosition]);

  useEffect(() => {
    setBookmarkRepositioningActive(isBookmarkRepositioning);
    return () => setBookmarkRepositioningActive(false);
  }, [isBookmarkRepositioning, setBookmarkRepositioningActive]);

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

  // Per-item callbacks are cached by item identity so NodeCard's memo holds —
  // fresh inline closures would re-render every card on every panel render.
  const moveNodeHandlers = useMemo(() => {
    const cache = new Map<string, () => void>();
    return (cacheKey: string, target: RepositionTarget) => {
      let handler = cache.get(cacheKey);
      if (!handler) {
        handler = () => reposition.openOverlay(target);
        cache.set(cacheKey, handler);
      }
      return handler;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reposition.openOverlay]);
  const enterSubgraphHandlers = useMemo(() => {
    const cache = new Map<number, () => void>();
    return (placeholderNodeId: number) => {
      let handler = cache.get(placeholderNodeId);
      if (!handler) {
        handler = () => enterSubgraph(placeholderNodeId);
        cache.set(placeholderNodeId, handler);
      }
      return handler;
    };
  }, [enterSubgraph]);

  // Keys are identity-based (group key / placeholder id / node id) — never
  // positional. An index in the key remounts every later sibling's subtree
  // on delete/search/collapse, losing local state and re-decoding previews.
  const renderItems = (items: NestedItem[]) =>
    items.map((item) => {
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
        const groupSubgraphId = item.subgraphId ?? null;
        const groupSelectionChildKeys = workflowSelectionMode && workflow
          ? collectGroupSelectionKeys(
              mobileLayout,
              workflow,
              item.group.id,
              groupSubgraphId,
              'children',
            )
          : [];
        const groupSelectionDescendantKeys = workflowSelectionMode && workflow
          ? collectGroupSelectionKeys(
              mobileLayout,
              workflow,
              item.group.id,
              groupSubgraphId,
              'descendants',
            )
          : [];
        const groupHiddenSelectionKeys = workflowSelectionMode && workflow
          ? groupSelectionChildKeys.filter(
              (key) =>
                hiddenItems[key]
                && Boolean(resolveNodeIdentityFromHierarchicalKey(workflow, key)),
            )
          : [];
        const hiddenState = getHiddenStateForGroup(groupHierarchicalKey);
        const isGroupBookmarked = bookmarkedItems.includes(groupHierarchicalKey);
        const hiddenNodeCount = hiddenState.hiddenNodeCount;
        // Derive from the group's own node counts (not item.children) so these
        // actions stay available when the group is folded — folding empties
        // item.children, but nodeCount/bypassedNodeCount remain accurate.
        const hasBypassedNodes = item.bypassedNodeCount > 0;
        const hasEngagedNodes = item.bypassedNodeCount < item.nodeCount;
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
            key={`group-${groupHierarchicalKey}`}
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
              selectionKey={groupHierarchicalKey}
              title={group.title?.trim() || `Group ${group.id}`}
              nodeCount={item.nodeCount}
              isCollapsed={item.isCollapsed}
              color={resolvedGroupColor}
              bypassState={bypassState}
              bypassedNodeCount={item.bypassedNodeCount}
              hiddenNodeCount={hiddenNodeCount}
              isBookmarked={isGroupBookmarked}
              canFoldAll={hasExpandedChildren}
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
              onMoveIntoSubgraph={
                canMoveIntoSubgraph(groupHierarchicalKey)
                  ? () => setMoveIntoSubgraphItemKeys([groupHierarchicalKey])
                  : undefined
              }
              onDuplicate={() => duplicateContainer(groupHierarchicalKey)}
              onCopy={() => copyContainer(groupHierarchicalKey)}
              onPaste={() => pasteIntoContainer(groupHierarchicalKey)}
              pasteSummary={clipboardSummary}
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
                {workflowSelectionMode && !item.isCollapsed && (
                  <GroupSelectionActions
                    childrenKeys={groupSelectionChildKeys}
                    descendantKeys={groupSelectionDescendantKeys}
                  />
                )}
                {hiddenNodeCount > 0 && item.nodeCount > 0 && (
                  <div className="px-3 pb-2 -mt-1 text-xs text-slate-400 text-center">
                    {hiddenNodeCount} hidden node
                    {hiddenNodeCount === 1 ? "" : "s"}
                  </div>
                )}
                {hasVisibleChildren ? (
                  renderItems(item.children)
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
                {workflowSelectionMode && groupHiddenSelectionKeys.length > 0 && (
                  <GroupHiddenSelectionPlaceholder hiddenKeys={groupHiddenSelectionKeys} />
                )}
              </div>
            </div>
            {!item.isCollapsed && (
              <ContainerFooter
                id={`group-footer-${item.group.id}`}
                headerId={`group-header-${item.group.id}`}
                title={item.group.title}
                nodeCount={item.nodeCount}
                color={resolvedGroupColor}
                textClassName="text-slate-400"
                className="group-footer"
                allBypassed={bypassState === 'all'}
              />
            )}
          </div>
        );
      }

      if (item.type === "subgraph") {
        // In the canonical model, subgraph placeholders are rendered as NodeCards.
        // Resolve the specific placeholder instance when the layout recorded
        // one; first-match by type is only a legacy-layout fallback (it picks
        // the wrong card when one definition has several placeholders).
        const placeholderNode = currentScopeWorkflow?.nodes.find((n) =>
          item.placeholderNodeId != null
            ? n.id === item.placeholderNodeId && n.type === item.subgraph.id
            : n.type === item.subgraph.id,
        );
        if (!placeholderNode) return null;

        return (
          <div
            key={`subgraph-placeholder-${item.subgraph.id}-${placeholderNode.id}`}
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
              onMoveNode={moveNodeHandlers(
                `subgraph-${item.subgraph.id}-${placeholderNode.id}`,
                { type: "subgraph", id: item.subgraph.id, nodeId: placeholderNode.id },
              )}
              onMoveIntoSubgraph={
                canMoveIntoSubgraph(
                  requireHierarchicalKey(
                    placeholderNode.itemKey,
                    `subgraph-placeholder ${item.subgraph.id}`,
                  ),
                )
                  ? () => setMoveIntoSubgraphItemKeys([
                      requireHierarchicalKey(
                        placeholderNode.itemKey,
                        `subgraph-placeholder ${item.subgraph.id}`,
                      ),
                    ])
                  : undefined
              }
              onEnterSubgraph={enterSubgraphHandlers(placeholderNode.id)}
            />
          </div>
        );
      }

      return (
        <div
          key={`node-${item.node.id}`}
          data-reposition-item={`node-${item.node.id}`}
          data-item-key={requireHierarchicalKey(item.node.itemKey, `node ${item.node.id}`)}
        >
          <NodeCard
            node={item.node}
            isExecuting={executingNodeIdInScope === item.node.id}
            isConnectionHighlighted={highlightedNodeIds.has(item.node.id)}
            errorBadgeLabel={errorBadgeByNodeId[item.node.id] ?? null}
            onImageClick={onImageClick}
            onMoveNode={moveNodeHandlers(`node-${item.node.id}`, {
              type: "node",
              id: item.node.id,
            })}
            onMoveIntoSubgraph={
              canMoveIntoSubgraph(
                requireHierarchicalKey(item.node.itemKey, `node ${item.node.id}`),
              )
                ? () => setMoveIntoSubgraphItemKeys([
                    requireHierarchicalKey(item.node.itemKey, `node ${item.node.id}`),
                  ])
                : undefined
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
        className="flex items-center justify-center h-full text-slate-400"
        style={{ paddingBottom: "var(--bottom-bar-offset, 80px)" }}
      >
        <div
          id="no-workflow-content"
          className="text-center p-8 rounded-xl border border-white/10 bg-slate-900/95 shadow-lg"
        >
          <div
            id="no-workflow-icon-container"
            className="flex items-center justify-center mb-4"
          >
            <DocumentIcon className="w-10 h-10 text-slate-500" />
          </div>
          <p id="no-workflow-title" className="text-lg font-semibold text-slate-100">
            {t('No workflow loaded')}
          </p>
          <p id="no-workflow-description" className="text-sm mt-2 text-slate-400">
            {t('Open the menu to load a workflow')}
          </p>
        </div>
      </div>
    );
  } else if (orderedNodes.length === 0) {
    content = (
      <div
        id="node-list-empty"
        className="flex items-center justify-center h-full text-slate-400"
        style={{ paddingBottom: "var(--bottom-bar-offset, 80px)" }}
      >
        <div
          id="empty-workflow-content"
          className="text-center p-8 rounded-xl border border-white/10 bg-slate-900/95 shadow-lg"
        >
          <div
            id="empty-workflow-icon-container"
            className="flex items-center justify-center mb-4"
          >
            <EmptyWorkflowIcon className="w-10 h-10 text-slate-500" />
          </div>
          <p id="empty-workflow-title" className="text-lg font-semibold text-slate-100">
            {t('Empty workflow')}
          </p>
          <p id="empty-workflow-description" className="text-sm mt-2 text-slate-400">
            {t('This workflow has no nodes')}
          </p>
          <div className="mt-6 w-80 max-w-full mx-auto">
            <AddItemControls
              onAddNode={handleAddNodeInScope}
              onAddGroup={handleAddGroupInScope}
            />
          </div>
        </div>
      </div>
    );
  } else {
    content = (
      // Shell + scroll container span the full width (scrollbar at the screen
      // edge); the content inside is capped and centered — same shape as the
      // reposition view.
      <div id="node-list-shell" className="h-full flex flex-col w-full">
        {searchOpen && (
          <div className="node-search-bar bg-slate-900/95 border-b border-white/10 px-4 py-2">
            <div className="mx-auto w-full max-w-3xl">
              <SearchBar
                inputRef={searchInputRef}
                value={searchQuery}
                onChange={setSearchQuery}
                onClear={handleClearSearch}
                placeholder={t("Search nodes...")}
                inputClassName="comfy-input border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 focus:ring-cyan-400"
              />
            </div>
          </div>
        )}

        <div
          id="node-list-container"
          ref={parentRef}
          className="flex-1 overflow-auto px-1 pt-3 overscroll-contain scroll-container"
          style={{ paddingBottom: "10rem" }}
          data-node-list="true"
          onScroll={handleNodeListScroll}
        >
          {nestedItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              <div className="text-center p-6 rounded-xl border border-white/10 bg-slate-900/95">
                <p className="text-sm font-semibold text-slate-100">{t('No matching nodes')}</p>
                <p className="text-xs mt-2">{t('Try a different search.')}</p>
              </div>
            </div>
          ) : (
            <div
              id="node-list-inner"
              className="mx-auto w-full max-w-3xl"
              // Trailing scroll range an open inline combo borrows so a widget
              // in the last node can still reach the top of the scrollport.
              // It lives on the content, never on the scroller's own padding:
              // a flex item's automatic minimum size will not compress padding,
              // so padding here would grow the container past the viewport and
              // make the whole document scrollable.
              style={{ paddingBottom: "var(--combo-open-scroll-space, 0px)" }}
            >
              {currentSubgraphId && !searchActive && (
                <>
                  <SubgraphScopeHeader subgraphId={currentSubgraphId} />
                  <SubgraphConnectionsSection subgraphId={currentSubgraphId} />
                </>
              )}
              {renderItems(nestedItems)}
              {!searchActive && (
                <AddItemControls
                  className="mt-1 mb-2"
                  onAddNode={handleAddNodeInScope}
                  onAddGroup={handleAddGroupInScope}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const dragHasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const handleFileDragEnter = (event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsFileDragging(true);
  };

  const handleFileDragOver = (event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleFileDragLeave = (event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsFileDragging(false);
  };

  const handleFileDrop = async (event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsFileDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const result = await readWorkflowFromFile(file);
    if (result.kind === "workflow") {
      loadWorkflow(result.workflow, result.filename, {
        filenameIsPlaceholder: result.filenameIsPlaceholder,
      });
      useWorkflowErrorsStore.getState().setError(null);
    } else if (result.kind === "no-workflow") {
      useNoWorkflowImageModal.getState().show(result.filename);
    } else {
      useWorkflowErrorsStore.getState().setError(result.message);
    }
  };

  return (
    <div
      id="node-list-wrapper"
      ref={wrapperRef}
      className="absolute inset-x-0 bottom-0 bg-slate-950/88"
      style={{ display: visible ? "block" : "none", top: workflowViewportTop }}
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {isFileDragging && (
        <div
          id="workflow-drop-overlay"
          className="pointer-events-none absolute inset-0 z-[1400] flex items-center justify-center bg-slate-950/70 backdrop-blur-[1px]"
        >
          <div className="m-4 flex flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-cyan-400/70 px-8 py-6 text-center">
            <span className="text-sm font-semibold text-cyan-200">{t('Drop to load workflow')}</span>
            <span className="text-xs text-slate-400">{t('Workflow .json or an image with an embedded workflow')}</span>
          </div>
        </div>
      )}
      <WorkflowUndoToast />
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
      {moveIntoSubgraphItemKeys && (
        <MoveIntoSubgraphModal
          itemKeys={moveIntoSubgraphItemKeys}
          onClose={() => setMoveIntoSubgraphItemKeys(null)}
          onConfirm={(placeholderItemKey) => {
            const moved = moveItemsIntoSubgraph(
              moveIntoSubgraphItemKeys,
              placeholderItemKey,
            );
            setMoveIntoSubgraphItemKeys(null);
            if (moved) {
              jumpToWorkflowItem({ kind: 'subgraph', itemKey: placeholderItemKey });
              // The move may have stranded sibling instances' feeder nodes
              // after carrying their values inside; offer to clean those up.
              if (moved.harvestedFrom.length > 0) {
                setHarvestedNodeIds(moved.harvestedFrom);
              }
            }
          }}
        />
      )}
      {harvestedNodeIds.length > 0 && (
        <RemoveHarvestedNodesDialog
          nodeIds={harvestedNodeIds}
          onClose={() => setHarvestedNodeIds([])}
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
      {isDesktop && currentSubgraphId && (
        // Outside the centred node column and pinned to the wrapper rather than
        // to the list, so it stays put however far the list is scrolled: leaving
        // a subgraph is always one click away, never a scroll first.
        <button
          type="button"
          className="subgraph-exit-desktop absolute z-[200] flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-slate-900 text-slate-300 shadow-md hover:bg-white/5"
          style={{ top: "16px", right: "calc(50% + 24rem + 0.75rem)" }}
          aria-label={t("Exit subgraph")}
          onClick={() => exitSubgraph()}
        >
          <ArrowRightIcon
            className="w-5 h-5 rotate-180"
            style={{position: "relative", left: "3px"}}
          />
        </button>
      )}

      {bookmarkEntries.length > 0 && (
        <div
          ref={bookmarkBarRef}
          // `select-none` on the whole gutter, not just its buttons: the bar is
          // a drag surface (long-press to reposition) and nothing in it is worth
          // copying, so without it iOS starts a text selection mid-drag. The
          // app-wide `-webkit-touch-callout: none` in index.css only suppresses
          // the callout menu; selection is governed separately. `user-select`
          // inherits, so this covers the entries, chips, cycle controls and edge
          // zones in one go.
          className={`absolute z-[200] flex select-none flex-col items-center gap-2 pointer-events-auto ${
            bookmarkBarCollapsed ? "bookmark-bar-collapsing" : "bookmark-bar-expanding"
          } ${
            // Collapsed, the gutter is one button wide whatever the platform.
            isDesktop && !bookmarkBarCollapsed
              ? "desktop-bookmark-bar items-stretch w-56"
              : ""
          } ${
            isBookmarkRepositioning
              // The outline itself is in index.css, where it can be drawn
              // without taking part in layout. Dimmed while it is being carried,
              // so the list underneath — the thing being positioned against —
              // stays readable through it.
              // No `shadow-lg`: the class owns box-shadow, which it needs for
              // the wash's spread, and the drop shadow is folded in there.
              ? `bookmark-bar-repositioning opacity-60 ${
                  // Collapsed, the gutter IS the round button, so the outline
                  // traces it rather than boxing it.
                  bookmarkBarCollapsed ? "rounded-full" : "rounded-2xl"
                }`
              : ""
          }`}
          // The gutter owns its horizontal gestures — flick away to change
          // side, flick toward the edge to collapse — so a swipe that starts on
          // it must never also be read as a swipe between panels.
          data-swipe-nav-ignore="true"
          style={bookmarkBarStyle}
          onPointerDown={handleBookmarkPointerDown}
          onPointerMove={handleBookmarkPointerMove}
          onPointerUp={handleBookmarkPointerUp}
          onPointerCancel={handleBookmarkPointerCancel}
        >
          {bookmarkBarCollapsed ? (
            <button
              type="button"
              // Long-press to reposition still belongs to the container, so this
              // only has to handle the tap. The gutter keeps its drag surface
              // whether it is showing one button or twenty.
              className={`bookmark-bar-collapsed w-10 h-10 shrink-0 cursor-pointer rounded-full border text-amber-500 shadow-md flex items-center justify-center select-none ${
                // Transparent while repositioning so the gutter's amber wash
                // shows through it: collapsed, the button covers the whole
                // gutter, so an opaque fill left the outline as the only sign
                // of the mode — while the expanded bar shows the wash across
                // its whole body.
                isBookmarkRepositioning
                  ? "border-amber-400/40 bg-transparent"
                  : "border-white/10 bg-slate-900"
              }`}
              aria-label={t("Show bookmarks")}
              aria-expanded={false}
              onClick={() => {
                if (consumeBookmarkPressIntent()) return;
                setBookmarkBarCollapsed(false);
              }}
            >
              <BookmarkIconSvg className="w-5 h-5" />
            </button>
          ) : (
          <>
          {/* Pinned above the scrolling list, like the forward control below it,
              so both stay reachable however far the list is scrolled. */}
          {isDesktop && (
            <button
              type="button"
              // Pinned above the list rather than scrolling with it: it is the
              // way out of a bar too tall to see the end of, which is exactly
              // when it would otherwise be scrolled out of reach.
              className="desktop-bookmark-collapse flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/95 text-xs text-slate-300 shadow-sm hover:bg-white/5"
              aria-label={t("Collapse bookmarks")}
              onClick={() => setBookmarkBarCollapsed(true)}
            >
              <BookmarkIconSvg className="w-4 h-4 text-amber-500" />
              {t("Collapse bookmarks")}
            </button>
          )}
          {!isDesktop && canCycleBookmarksBack && (
            <button
              type="button"
              className="w-10 h-10 shrink-0 cursor-pointer rounded-full border border-white/10 bg-slate-900 text-slate-300 shadow-sm flex items-center justify-center select-none"
              aria-label={t("Cycle bookmarks backwards")}
              onClick={handleBookmarkCycleBackClick}
            >
              <CaretUpIcon className="w-5 h-5" />
            </button>
          )}
          <div className="relative flex min-h-0 w-full flex-1 flex-col">
          <div
            ref={bookmarkListRef}
            data-bookmark-scroll="true"
            onScroll={updateBookmarkScrollFades}
            // The list scrolls once there are more bookmarks than fit beside the
            // node column; the cycle button below stays pinned so it's reachable
            // no matter how far the list is scrolled. Desktop keeps a scrollbar
            // and `pr-2` reserves room so it never sits on the entries' edges;
            // the mobile gutter floats over the node list, where a scrollbar
            // track reads as chrome laid on the content, so it is hidden.
            // `overflow-x-hidden` and `pan-y` together: the list scrolls only
            // vertically, so a sideways drag on an entry is left for the bar's
            // own collapse gesture instead of being eaten as a rubber-banding
            // horizontal scroll that goes nowhere.
            className={`bookmark-bar-list flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overscroll-contain ${
              bookmarkListScrollLocked ? "overflow-y-hidden" : "overflow-y-auto"
            } ${
              isDesktop
                ? "items-stretch pr-2"
                : "items-center [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            } ${
              isBookmarkRepositioning ? "cursor-grab" : ""
            }`}
            // `none` while repositioning: the browser keeps panning a list it
            // was already scrolling, which is what stole the drag that should
            // have followed the hold.
            style={{
              ...bookmarkListMaskStyle,
              touchAction: isBookmarkRepositioning ? "none" : "pan-y",
            }}
          >
            {bookmarkEntries.map((entry, index) => isDesktop ? (
              <div key={entry.itemKey}>
                <ParentageEntry
                  label={entry.text}
                  parents={entry.parents.map((parent, parentIndex) => ({
                    ...parent,
                    key: `${parentIndex}:${parent.label}`,
                  }))}
                  surfaceColor={entry.surfaceColor}
                  borderColor={entry.borderColor}
                  className="desktop-bookmark-entry"
                  parentClassName="bookmark-parent-chip"
                  removeClassName="desktop-bookmark-remove"
                  bookmarkFlashKey={entry.itemKey}
                  onClick={handleBookmarkButtonClick(entry, index)}
                  onParentClick={(parentIndex, event) =>
                    handleBookmarkParentClick(entry.parents[parentIndex].itemKey)(event)
                  }
                  parentAriaLabel={(parent) => `Jump to ${parent.label}`}
                  onRemove={() => toggleBookmark(entry.itemKey)}
                  removeAriaLabel={t('Remove bookmark')}
                />
              </div>
            ) : (
              <button
                key={entry.itemKey}
                type="button"
                data-bookmark-flash-key={entry.itemKey}
                className="w-10 h-10 shrink-0 cursor-pointer rounded-full border border-white/10 text-[11px] font-bold text-slate-100 shadow-sm select-none"
                onClick={handleBookmarkButtonClick(entry, index)}
                style={{
                  backgroundColor: hexToRgba(entry.surfaceColor, BOOKMARK_CHIP_ALPHA),
                  borderColor: hexToRgba(entry.borderColor, BOOKMARK_CHIP_ALPHA),
                }}
              >
                {entry.compactText}
              </button>
            ))}
          </div>
          {/* Tapping a faded end scrolls that way instead of activating the
              bookmark showing through it. */}
          {bookmarkTopFade > 0 && !bookmarkListScrollLocked && (
            <button
              type="button"
              className="absolute inset-x-0 top-0 cursor-pointer"
              style={{ height: bookmarkEdgeFadeSize }}
              aria-label={t("Scroll bookmarks up")}
              onClick={() => scrollBookmarkEdge("up")}
            />
          )}
          {bookmarkBottomFade > 0 && !bookmarkListScrollLocked && (
            <button
              type="button"
              className="absolute inset-x-0 bottom-0 cursor-pointer"
              style={{ height: bookmarkEdgeFadeSize }}
              aria-label={t("Scroll bookmarks down")}
              onClick={() => scrollBookmarkEdge("down")}
            />
          )}
          </div>
          {!isDesktop && canCycleBookmarks && (
            <button
              type="button"
              className="w-10 h-10 shrink-0 cursor-pointer rounded-full border border-white/10 bg-slate-900 text-slate-300 shadow-sm flex items-center justify-center select-none"
              aria-label={t("Cycle bookmarks")}
              onClick={handleBookmarkCycleClick}
            >
              <CaretDownIcon className="w-5 h-5" />
            </button>
          )}
          </>
          )}
        </div>
      )}
    </div>
  );
});
