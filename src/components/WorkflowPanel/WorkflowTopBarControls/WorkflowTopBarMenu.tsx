import type { RefObject } from 'react';
import { useMemo } from 'react';
import { useWorkflowStore, getInputWidgetDefinitions, getWidgetDefinitions } from '@/hooks/useWorkflow';
import { useBookmarksStore } from '@/hooks/useBookmarks';
import { useHistoryStore } from '@/hooks/useHistory';
import { loadTemplateWorkflow, loadUserWorkflow } from '@/api/client';
import { CaretDownIcon, CaretRightIcon, EllipsisVerticalIcon, EyeIcon, EyeOffIcon, LogoutIcon, ArrowRightIcon, ReloadIcon, SearchIcon, TrashIcon } from '@/components/icons';

interface WorkflowTopBarMenuProps {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onGoToQueue: () => void;
  onGoToOutputs: () => void;
  onHandleDirtyAction: (action: 'unload' | 'clearWorkflowCache' | 'clearAllCache') => void;
}

export function WorkflowTopBarMenu({
  open,
  buttonRef,
  menuRef,
  onToggle,
  onClose,
  onGoToQueue,
  onGoToOutputs,
  onHandleDirtyAction
}: WorkflowTopBarMenuProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const setNodeFold = useWorkflowStore((s) => s.setNodeFold);
  const setGroupCollapsed = useWorkflowStore((s) => s.setGroupCollapsed);
  const setSubgraphCollapsed = useWorkflowStore((s) => s.setSubgraphCollapsed);
  const setNodeHidden = useWorkflowStore((s) => s.setNodeHidden);
  const showAllHiddenNodes = useWorkflowStore((s) => s.showAllHiddenNodes);
  const manuallyHiddenNodes = useWorkflowStore((s) => s.manuallyHiddenNodes);
  const hiddenGroups = useWorkflowStore((s) => s.hiddenGroups);
  const hiddenSubgraphs = useWorkflowStore((s) => s.hiddenSubgraphs);
  const bookmarkedNodeIds = useBookmarksStore((s) => s.bookmarkedNodeIds);
  const clearNodeBookmarks = useBookmarksStore((s) => s.clearNodeBookmarks);
  const collapsedGroups = useWorkflowStore((s) => s.collapsedGroups);
  const collapsedSubgraphs = useWorkflowStore((s) => s.collapsedSubgraphs);
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const searchOpen = useWorkflowStore((s) => s.searchOpen);
  const setSearchOpen = useWorkflowStore((s) => s.setSearchOpen);
  const setSearchQuery = useWorkflowStore((s) => s.setSearchQuery);
  const connectionButtonsVisible = useWorkflowStore((s) => s.connectionButtonsVisible);
  const toggleConnectionButtonsVisible = useWorkflowStore(
    (s) => s.toggleConnectionButtonsVisible,
  );
  const history = useHistoryStore((s) => s.history);

  const hasWorkflow = Boolean(workflow);
  const allWorkflowNodeIds = useMemo(() => (
    workflow?.nodes.map((node) => node.id) ?? []
  ), [workflow]);
  const allGroupIds = useMemo(() => {
    if (!workflow) return [];
    const rootGroups = workflow.groups?.map((group) => group.id) ?? [];
    const subgraphGroups = workflow.definitions?.subgraphs?.flatMap((subgraph) => (
      subgraph.groups?.map((group) => group.id) ?? []
    )) ?? [];
    return [...rootGroups, ...subgraphGroups];
  }, [workflow]);
  const allSubgraphIds = useMemo(() => (
    workflow?.definitions?.subgraphs?.map((subgraph) => subgraph.id) ?? []
  ), [workflow]);

  const bypassedNodeIds = useMemo(() => (
    workflow?.nodes.filter((node) => node.mode === 4).map((node) => node.id) ?? []
  ), [workflow]);
  const staticNodeIds = useMemo(() => {
    if (!workflow || !nodeTypes) return [];
    return workflow.nodes.filter((node) => {
      if (node.type === 'Fast Groups Bypasser (rgthree)') return false;
      const widgetDefs = getWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      return widgetDefs.length === 0 && inputWidgetDefs.length === 0;
    }).map((node) => node.id);
  }, [workflow, nodeTypes]);
  const bypassedNodeCount = bypassedNodeIds.length;
  const staticNodeCount = staticNodeIds.length;
  const manuallyHiddenCount = useMemo(
    () => Object.values(manuallyHiddenNodes).filter(Boolean).length,
    [manuallyHiddenNodes]
  );
  const hiddenBypassedCount = useMemo(
    () => bypassedNodeIds.filter((id) => manuallyHiddenNodes[id]).length,
    [bypassedNodeIds, manuallyHiddenNodes]
  );
  const hiddenStaticCount = useMemo(
    () => staticNodeIds.filter((id) => manuallyHiddenNodes[id]).length,
    [staticNodeIds, manuallyHiddenNodes]
  );

  const visibleNodes = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes.filter((node) => !manuallyHiddenNodes[node.id]);
  }, [workflow, manuallyHiddenNodes]);

  const hasFoldedVisibleNode = useMemo(
    () => visibleNodes.some((node) => node.flags?.collapsed),
    [visibleNodes]
  );
  const hasUnfoldedVisibleNode = useMemo(
    () => visibleNodes.some((node) => !node.flags?.collapsed),
    [visibleNodes]
  );
  const hasCollapsedGroup = useMemo(
    () => allGroupIds.some((groupId) => collapsedGroups[groupId] ?? true),
    [allGroupIds, collapsedGroups]
  );
  const hasExpandedGroup = useMemo(
    () => allGroupIds.some((groupId) => collapsedGroups[groupId] === false),
    [allGroupIds, collapsedGroups]
  );
  const hasCollapsedSubgraph = useMemo(
    () => allSubgraphIds.some((subgraphId) => collapsedSubgraphs[subgraphId] ?? true),
    [allSubgraphIds, collapsedSubgraphs]
  );
  const hasExpandedSubgraph = useMemo(
    () => allSubgraphIds.some((subgraphId) => collapsedSubgraphs[subgraphId] === false),
    [allSubgraphIds, collapsedSubgraphs]
  );
  const hasFoldedVisibleItem = hasFoldedVisibleNode || hasCollapsedGroup || hasCollapsedSubgraph;
  const hasUnfoldedVisibleItem = hasUnfoldedVisibleNode || hasExpandedGroup || hasExpandedSubgraph;
  const showAllHiddenNodesButton = useMemo(() => {
    if (manuallyHiddenCount > 0) return true;
    if (Object.values(hiddenGroups).some(Boolean)) return true;
    return Object.values(hiddenSubgraphs).some(Boolean);
  }, [manuallyHiddenCount, hiddenGroups, hiddenSubgraphs]);

  const closeMenu = () => {
    onClose();
  };

  const handleGoToQueueClick = () => {
    onGoToQueue();
    closeMenu();
  };

  const handleGoToOutputsClick = () => {
    onGoToOutputs();
    closeMenu();
  };

  const handleSearchClick = () => {
    setSearchQuery('');
    setSearchOpen(true);
    closeMenu();
  };

  const handleToggleConnectionsClick = () => {
    toggleConnectionButtonsVisible();
    closeMenu();
  };

  const handleFoldAllClick = () => {
    allWorkflowNodeIds.forEach((id) => setNodeFold(id, true));
    allGroupIds.forEach((id) => setGroupCollapsed(id, true));
    allSubgraphIds.forEach((id) => setSubgraphCollapsed(id, true));
    closeMenu();
  };

  const handleUnfoldAllClick = () => {
    allWorkflowNodeIds.forEach((id) => setNodeFold(id, false));
    allGroupIds.forEach((id) => setGroupCollapsed(id, false));
    allSubgraphIds.forEach((id) => setSubgraphCollapsed(id, false));
    closeMenu();
  };

  const handleHideStaticClick = () => {
    staticNodeIds.forEach((id) => setNodeHidden(id, true));
    closeMenu();
  };

  const handleToggleBypassedClick = () => {
    if (hiddenBypassedCount > 0) {
      bypassedNodeIds.forEach((id) => setNodeHidden(id, false));
    } else {
      bypassedNodeIds.forEach((id) => setNodeHidden(id, true));
    }
    closeMenu();
  };

  const handleShowAllHiddenClick = () => {
    showAllHiddenNodes();
    closeMenu();
  };

  const handleClearBookmarksClick = () => {
    clearNodeBookmarks();
    closeMenu();
  };

  const handleReloadUserClick = async () => {
    if (!workflowSource || workflowSource.type !== 'user') return;
    try {
      const data = await loadUserWorkflow(workflowSource.filename);
      loadWorkflow(data, workflowSource.filename, { fresh: true, source: workflowSource });
    } catch (err) {
      console.error('Failed to reload workflow:', err);
    }
    closeMenu();
  };

  const handleReloadTemplateClick = async () => {
    if (!workflowSource || workflowSource.type !== 'template') return;
    try {
      const data = await loadTemplateWorkflow(workflowSource.moduleName, workflowSource.templateName);
      loadWorkflow(data, `${workflowSource.moduleName}/${workflowSource.templateName}`, { fresh: true, source: workflowSource });
    } catch (err) {
      console.error('Failed to reload template:', err);
    }
    closeMenu();
  };

  const handleReloadHistoryClick = () => {
    if (!workflowSource || workflowSource.type !== 'history') return;
    const historyItem = history.find(h => h.prompt_id === workflowSource.promptId);
    if (historyItem?.workflow) {
      loadWorkflow(
        historyItem.workflow,
        `history-${workflowSource.promptId}.json`,
        { source: workflowSource }
      );
    }
    closeMenu();
  };

  const handleClearWorkflowCacheClick = () => {
    onHandleDirtyAction('clearWorkflowCache');
  };

  const handleUnloadWorkflowClick = () => {
    onHandleDirtyAction('unload');
  };

  const handleClearAllCacheClick = () => {
    onHandleDirtyAction('clearAllCache');
  };

  return (
    <div id="workflow-menu-container" className="relative">
      <button
        ref={buttonRef}
        onClick={onToggle}
        className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100"
        aria-label="Workflow options"
      >
        <EllipsisVerticalIcon className="w-5 h-5 -rotate-90" />
      </button>
      {!open ? null : (
        <div
          id="workflow-options-dropdown"
          ref={menuRef}
          className="absolute right-0 top-11 z-50 w-52 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
        >
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleGoToQueueClick}
          >
            <ArrowRightIcon className="w-3 h-3 text-gray-500" />
            Go to queue
          </button>
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleGoToOutputsClick}
          >
            <ArrowRightIcon className="w-3 h-3 text-gray-500 rotate-180" />
            Go to outputs
          </button>
          {!searchOpen && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleSearchClick}
            >
              <SearchIcon className="w-4 h-4 text-gray-500" />
              Search
            </button>
          )}
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleToggleConnectionsClick}
          >
            {connectionButtonsVisible ? (
              <EyeOffIcon className="w-4 h-4 text-gray-500" />
            ) : (
              <EyeIcon className="w-4 h-4 text-gray-500" />
            )}
            {connectionButtonsVisible ? 'Hide connection buttons' : 'Show connection buttons'}
          </button>
          {hasUnfoldedVisibleItem && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleFoldAllClick}
            >
              <CaretRightIcon className="w-6 h-6 -ml-1 text-gray-500" />
              Fold all
            </button>
          )}
          {hasFoldedVisibleItem && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleUnfoldAllClick}
            >
              <CaretDownIcon className="w-6 h-6 -ml-1 text-gray-500" />
              Unfold all
            </button>
          )}
          {staticNodeCount > 0 && hiddenStaticCount < staticNodeCount && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleHideStaticClick}
            >
              <EyeOffIcon className="w-4 h-4 text-gray-500" />
              Hide static nodes ({staticNodeCount})
            </button>
          )}
          {bypassedNodeCount > 0 && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleToggleBypassedClick}
            >
              {hiddenBypassedCount > 0 ? (
                <EyeIcon className="w-4 h-4 text-gray-500" />
              ) : (
                <EyeOffIcon className="w-4 h-4 text-gray-500" />
              )}
              {hiddenBypassedCount > 0 ? 'Show bypassed nodes' : 'Hide bypassed nodes'} ({bypassedNodeCount})
            </button>
          )}
          {showAllHiddenNodesButton && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleShowAllHiddenClick}
            >
              <EyeIcon className="w-4 h-4 text-gray-500" />
              Show all hidden nodes
            </button>
          )}
          {bookmarkedNodeIds.length > 0 && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleClearBookmarksClick}
            >
              <TrashIcon className="w-4 h-4 text-gray-500" />
              Clear bookmarks
            </button>
          )}
          {workflowSource && (
            workflowSource.type === 'user' ? (
              <button
                className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                onClick={handleReloadUserClick}
              >
                <ReloadIcon className="w-4 h-4 text-gray-500" />
                Reload workflow
              </button>
            ) : workflowSource.type === 'template' ? (
              <button
                className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                onClick={handleReloadTemplateClick}
              >
                <ReloadIcon className="w-4 h-4 text-gray-500" />
                Reload workflow
              </button>
            ) : workflowSource.type === 'history' ? (
              history.find(h => h.prompt_id === workflowSource.promptId)?.workflow ? (
                <button
                  className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={handleReloadHistoryClick}
                >
                  <ReloadIcon className="w-4 h-4 text-gray-500" />
                  Reload workflow
                </button>
              ) : null
            ) : null
          )}
          {hasWorkflow && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleClearWorkflowCacheClick}
            >
              <TrashIcon className="w-4 h-4 text-gray-500" />
              Clear workflow cache
            </button>
          )}
          {hasWorkflow && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-600"
              onClick={handleUnloadWorkflowClick}
            >
              <LogoutIcon className="w-4 h-4" />
              Unload workflow
            </button>
          )}
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-600"
            onClick={handleClearAllCacheClick}
          >
            <TrashIcon className="w-4 h-4" />
            Clear all cache
          </button>
        </div>
      )}
    </div>
  );
}
