import type { RefObject } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useWorkflowStore, getInputWidgetDefinitions, getWidgetDefinitions } from '@/hooks/useWorkflow';
import { useBookmarksStore } from '@/hooks/useBookmarks';
import { useHistoryStore } from '@/hooks/useHistory';
import { loadTemplateWorkflow, loadUserWorkflow } from '@/api/client';
import { CaretDownIcon, CaretRightIcon, EyeIcon, EyeOffIcon, ArrowRightIcon, ReloadIcon, SearchIcon, TrashIcon, PlusIcon, WorkflowIcon } from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { requireStableKey } from '@/utils/stableKeys';

interface WorkflowTopBarMenuProps {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onGoToQueue: () => void;
  onGoToOutputs: () => void;
  onAddNode: () => void;
  onOpenWorkflowActions: () => void;
}

export function WorkflowTopBarMenu({
  open,
  buttonRef,
  menuRef,
  onToggle,
  onClose,
  onGoToQueue,
  onGoToOutputs,
  onAddNode,
  onOpenWorkflowActions
}: WorkflowTopBarMenuProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const setItemCollapsed = useWorkflowStore((s) => s.setItemCollapsed);
  const setItemHidden = useWorkflowStore((s) => s.setItemHidden);
  const showAllHiddenNodes = useWorkflowStore((s) => s.showAllHiddenNodes);
  const hiddenItems = useWorkflowStore((s) => s.hiddenItems);
  const bookmarkedItems = useBookmarksStore((s) => s.bookmarkedItems);
  const clearBookmarks = useBookmarksStore((s) => s.clearBookmarks);
  const collapsedItems = useWorkflowStore((s) => s.collapsedItems);
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
  const hasStableFlag = useCallback(
    (state: Record<string, boolean>, stableKey: string): boolean =>
      Boolean(state[stableKey]),
    [],
  );

  const hasWorkflow = Boolean(workflow);
  const allWorkflowNodeStableKeys = useMemo(() => (
    workflow?.nodes
      .map((node) => requireStableKey(node.stableKey, `node ${node.id}`)) ?? []
  ), [workflow]);
  const allGroupTargets = useMemo(() => {
    const groups = [
      ...(workflow?.groups ?? []),
      ...((workflow?.definitions?.subgraphs ?? []).flatMap((subgraph) => subgraph.groups ?? [])),
    ];
    return groups
      .map((group) => requireStableKey(group.stableKey, `group ${group.id}`));
  }, [workflow]);
  const allSubgraphStableKeys = useMemo(() => (
    (workflow?.definitions?.subgraphs?.map((subgraph) => requireStableKey(subgraph.stableKey, `subgraph ${subgraph.id}`)) ?? [])
  ), [workflow]);

  const bypassedNodes = useMemo(() => (
    workflow?.nodes.filter((node) => node.mode === 4) ?? []
  ), [workflow]);
  const staticNodes = useMemo(() => {
    if (!workflow || !nodeTypes) return [];
    return workflow.nodes.filter((node) => {
      if (node.type === 'Fast Groups Bypasser (rgthree)') return false;
      const widgetDefs = getWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      return widgetDefs.length === 0 && inputWidgetDefs.length === 0;
    });
  }, [workflow, nodeTypes]);
  const bypassedNodeCount = bypassedNodes.length;
  const staticNodeCount = staticNodes.length;
  const manuallyHiddenCount = useMemo(
    () => Object.values(hiddenItems).filter(Boolean).length,
    [hiddenItems]
  );
  const hiddenBypassedCount = useMemo(
    () =>
      bypassedNodes.filter((node) =>
        (() => {
          const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
          return hiddenItems[stableKey];
        })()
      ).length,
    [bypassedNodes, hiddenItems]
  );
  const hiddenStaticCount = useMemo(
    () =>
      staticNodes.filter((node) =>
        (() => {
          const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
          return hiddenItems[stableKey];
        })()
      ).length,
    [staticNodes, hiddenItems]
  );

  const visibleNodes = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes.filter(
      (node) =>
        (() => {
          const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
          return !hiddenItems[stableKey];
        })()
    );
  }, [workflow, hiddenItems]);

  const hasFoldedVisibleNode = useMemo(
    () =>
      visibleNodes.some((node) => {
        const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
        return collapsedItems[stableKey] === true;
      }),
    [collapsedItems, visibleNodes]
  );
  const hasUnfoldedVisibleNode = useMemo(
    () =>
      visibleNodes.some((node) => {
        const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
        return collapsedItems[stableKey] !== true;
      }),
    [collapsedItems, visibleNodes]
  );
  const hasCollapsedGroup = useMemo(
    () => allGroupTargets.some((stableKey) => collapsedItems[stableKey] === true),
    [allGroupTargets, collapsedItems]
  );
  const hasExpandedGroup = useMemo(
    () => allGroupTargets.some((stableKey) => (collapsedItems[stableKey] ?? false) === false),
    [allGroupTargets, collapsedItems]
  );
  const hasCollapsedSubgraph = useMemo(
    () => allSubgraphStableKeys.some((stableKey) =>
      (collapsedItems[stableKey] ?? false)
    ),
    [allSubgraphStableKeys, collapsedItems]
  );
  const hasExpandedSubgraph = useMemo(
    () => allSubgraphStableKeys.some((stableKey) =>
      (collapsedItems[stableKey] ?? false) === false
    ),
    [allSubgraphStableKeys, collapsedItems]
  );
  const hasFoldedVisibleItem = hasFoldedVisibleNode || hasCollapsedGroup || hasCollapsedSubgraph;
  const hasUnfoldedVisibleItem = hasUnfoldedVisibleNode || hasExpandedGroup || hasExpandedSubgraph;
  const showAllHiddenNodesButton = useMemo(() => {
    if (manuallyHiddenCount > 0) return true;
    const anyHiddenGroup = allGroupTargets.some((stableKey) => hasStableFlag(hiddenItems, stableKey));
    if (anyHiddenGroup) return true;
    return allSubgraphStableKeys.some((stableKey) => hiddenItems[stableKey] === true);
  }, [manuallyHiddenCount, hiddenItems, allGroupTargets, allSubgraphStableKeys, hasStableFlag]);

  const [visibilityModalOpen, setVisibilityModalOpen] = useState(false);

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

  const handleAddNodeClick = () => {
    onAddNode();
    closeMenu();
  };

  const handleFoldAllClick = () => {
    allWorkflowNodeStableKeys.forEach((stableKey) => setItemCollapsed(stableKey, true));
    allGroupTargets.forEach((stableKey) => setItemCollapsed(stableKey, true));
    allSubgraphStableKeys.forEach((stableKey) => setItemCollapsed(stableKey, true));
    closeMenu();
  };

  const handleUnfoldAllClick = () => {
    allWorkflowNodeStableKeys.forEach((stableKey) => setItemCollapsed(stableKey, false));
    allGroupTargets.forEach((stableKey) => setItemCollapsed(stableKey, false));
    allSubgraphStableKeys.forEach((stableKey) => setItemCollapsed(stableKey, false));
    closeMenu();
  };

  const handleShowAllHiddenClick = () => {
    showAllHiddenNodes();
    allGroupTargets.forEach((stableKey) => setItemHidden(stableKey, false));
    allSubgraphStableKeys.forEach((stableKey) => setItemHidden(stableKey, false));
  };

  const handleClearBookmarksClick = () => {
    clearBookmarks();
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

  return (
    <div id="workflow-menu-container" className="relative">
      <ContextMenuButton
        buttonRef={buttonRef}
        onClick={onToggle}
        ariaLabel="Workflow options"
      />
      {!open ? null : (
        <div
          id="workflow-options-dropdown"
          ref={menuRef}
          className="absolute right-0 top-11 z-50 w-52"
        >
          <ContextMenuBuilder
            items={[
              {
                key: 'go-to-queue',
                label: 'Go to queue',
                icon: <ArrowRightIcon className="w-3 h-3" />,
                onClick: handleGoToQueueClick
              },
              {
                key: 'go-to-outputs',
                label: 'Go to outputs',
                icon: <ArrowRightIcon className="w-3 h-3 rotate-180" />,
                onClick: handleGoToOutputsClick
              },
              {
                key: 'search',
                label: 'Search',
                icon: <SearchIcon className="w-4 h-4" />,
                onClick: handleSearchClick,
                hidden: searchOpen
              },
              {
                key: 'add-node',
                label: 'Add node',
                icon: <PlusIcon className="w-4 h-4" />,
                onClick: handleAddNodeClick,
                hidden: !hasWorkflow
              },
              {
                key: 'hide-show',
                label: 'Hide / Show',
                icon: <EyeIcon className="w-4 h-4" />,
                onClick: () => { setVisibilityModalOpen(true); closeMenu(); }
              },
              {
                key: 'fold-all',
                label: 'Fold all',
                icon: <CaretRightIcon className="w-6 h-6 -ml-1" />,
                onClick: handleFoldAllClick,
                hidden: !hasUnfoldedVisibleItem
              },
              {
                key: 'unfold-all',
                label: 'Unfold all',
                icon: <CaretDownIcon className="w-6 h-6 -ml-1" />,
                onClick: handleUnfoldAllClick,
                hidden: !hasFoldedVisibleItem
              },
              {
                key: 'clear-bookmarks',
                label: 'Clear bookmarks',
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleClearBookmarksClick,
                hidden: bookmarkedItems.length === 0
              },
              {
                key: 'reload-workflow',
                label: 'Reload workflow',
                icon: <ReloadIcon className="w-4 h-4" />,
                onClick: workflowSource?.type === 'user'
                  ? handleReloadUserClick
                  : workflowSource?.type === 'template'
                    ? handleReloadTemplateClick
                    : workflowSource?.type === 'history' && history.find((h) => h.prompt_id === workflowSource.promptId)?.workflow
                      ? handleReloadHistoryClick
                      : undefined,
                hidden: !workflowSource || (
                  workflowSource.type === 'history' &&
                  !history.find((h) => h.prompt_id === workflowSource.promptId)?.workflow
                )
              },
              {
                key: 'workflow-actions',
                label: 'Workflow actions',
                icon: <WorkflowIcon className="w-4 h-4" />,
                onClick: () => {
                  onOpenWorkflowActions();
                  closeMenu();
                }
              }
            ]}
          />
        </div>
      )}
      {visibilityModalOpen && (
        <div
          className="fixed inset-0 z-[2150] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setVisibilityModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
              Hide / Show
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              <ContextMenuBuilder
                itemClassName="px-4 py-3"
                items={[
                  {
                    key: 'static-nodes',
                    label: hiddenStaticCount < staticNodeCount
                      ? `Hide static nodes (${staticNodeCount})`
                      : `Show static nodes (${staticNodeCount})`,
                    icon: hiddenStaticCount < staticNodeCount
                      ? <EyeOffIcon className="w-4 h-4" />
                      : <EyeIcon className="w-4 h-4" />,
                    onClick: () => {
                      if (hiddenStaticCount < staticNodeCount) {
                        staticNodes.forEach((node) => {
                          const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
                          setItemHidden(stableKey, true);
                        });
                      } else {
                        staticNodes.forEach((node) => {
                          const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
                          setItemHidden(stableKey, false);
                        });
                      }
                    },
                    hidden: staticNodeCount === 0
                  },
                  {
                    key: 'bypassed-nodes',
                    label: hiddenBypassedCount > 0
                      ? `Show bypassed nodes (${bypassedNodeCount})`
                      : `Hide bypassed nodes (${bypassedNodeCount})`,
                    icon: hiddenBypassedCount > 0
                      ? <EyeIcon className="w-4 h-4" />
                      : <EyeOffIcon className="w-4 h-4" />,
                    onClick: () => {
                      if (hiddenBypassedCount > 0) {
                        bypassedNodes.forEach((node) => {
                          const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
                          setItemHidden(stableKey, false);
                        });
                      } else {
                        bypassedNodes.forEach((node) => {
                          const stableKey = requireStableKey(node.stableKey, `node ${node.id}`);
                          setItemHidden(stableKey, true);
                        });
                      }
                    },
                    hidden: bypassedNodeCount === 0
                  },
                  {
                    key: 'toggle-connection-buttons',
                    label: connectionButtonsVisible ? 'Hide connection buttons' : 'Show connection buttons',
                    icon: connectionButtonsVisible
                      ? <EyeOffIcon className="w-4 h-4" />
                      : <EyeIcon className="w-4 h-4" />,
                    onClick: toggleConnectionButtonsVisible
                  },
                  {
                    key: 'show-all-hidden',
                    label: 'Show all hidden nodes',
                    icon: <EyeIcon className="w-4 h-4" />,
                    onClick: handleShowAllHiddenClick,
                    hidden: !showAllHiddenNodesButton
                  }
                ]}
              />
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
              <button
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setVisibilityModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
