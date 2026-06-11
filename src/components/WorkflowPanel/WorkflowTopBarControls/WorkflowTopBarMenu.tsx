import type { RefObject } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useWorkflowStore, getInputWidgetDefinitions, getWidgetDefinitions } from '@/hooks/useWorkflow';
import { useBookmarksStore } from '@/hooks/useBookmarks';
import { useHistoryStore } from '@/hooks/useHistory';
import { CaretDownIcon, CaretRightIcon, EyeIcon, EyeOffIcon, ArrowRightIcon, ReloadIcon, SearchIcon, TrashIcon, PlusIcon, WorkflowIcon } from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { requireHierarchicalKey } from '@/utils/itemKeys';
import { appChromeIconButtonBareClassName } from '@/components/chromeStyles';
import { useWorkflowHiddenStore } from '@/hooks/useWorkflowHidden';
import { isHiddenWorkflowPath, isManuallyHiddenWorkflowPath } from '@/components/AppMenu/userWorkflowHelpers';

interface WorkflowTopBarMenuProps {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onGoToQueue: () => void;
  onGoToOutputs: () => void;
  onAddNode: () => void;
  onAddGroup: () => void;
  onOpenWorkflowActions: () => void;
  // Reloads the workflow from its source in the CURRENT tab, prompting to
  // confirm if there are unsaved changes. Owned by the parent so it reuses the
  // shared dirty-confirm flow.
  onReloadWorkflow: () => void;
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
  onAddGroup,
  onOpenWorkflowActions,
  onReloadWorkflow
}: WorkflowTopBarMenuProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const setItemCollapsed = useWorkflowStore((s) => s.setItemCollapsed);
  const setItemHidden = useWorkflowStore((s) => s.setItemHidden);
  const showAllHiddenNodes = useWorkflowStore((s) => s.showAllHiddenNodes);
  const hiddenItems = useWorkflowStore((s) => s.hiddenItems);
  const bookmarkedItems = useBookmarksStore((s) => s.bookmarkedItems);
  const clearBookmarks = useBookmarksStore((s) => s.clearBookmarks);
  const collapsedItems = useWorkflowStore((s) => s.collapsedItems);
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const hiddenWorkflowPaths = useWorkflowHiddenStore((s) => s.hidden);
  const toggleWorkflowHidden = useWorkflowHiddenStore((s) => s.toggleHidden);
  const searchOpen = useWorkflowStore((s) => s.searchOpen);
  const setSearchOpen = useWorkflowStore((s) => s.setSearchOpen);
  const setSearchQuery = useWorkflowStore((s) => s.setSearchQuery);
  const connectionButtonsVisible = useWorkflowStore((s) => s.connectionButtonsVisible);
  const toggleConnectionButtonsVisible = useWorkflowStore(
    (s) => s.toggleConnectionButtonsVisible,
  );
  const history = useHistoryStore((s) => s.history);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  // Mirror reloadFromSource: user/template/file sources always re-fetch, history
  // reloads only if the run still has an embedded workflow, and everything else
  // ('other' source or no source) falls back to the in-memory originalWorkflow.
  // Hide the menu item entirely when a reload would be a no-op.
  const canReload = (() => {
    if (!workflowSource) return Boolean(originalWorkflow);
    switch (workflowSource.type) {
      case 'user':
      case 'template':
      case 'file':
        return true;
      case 'history':
        return Boolean(history.find((h) => h.prompt_id === workflowSource.promptId)?.workflow);
      default:
        return Boolean(originalWorkflow);
    }
  })();
  const hasStableFlag = useCallback(
    (state: Record<string, boolean>, itemKey: string): boolean =>
      Boolean(state[itemKey]),
    [],
  );

  const hasWorkflow = Boolean(workflow);

  // Whole-workflow hide toggle (declutters it from the workflow lists). Keyed on
  // currentFilename (the workflows-dir-relative path) to match how isWorkflowHidden
  // and the TopBar identify the open workflow — a saved workflow can be open with a
  // non-'user' source. Hidden for unsaved workflows (no path) and dot-prefixed
  // paths, which are always hidden structurally and can't be toggled off here.
  const canToggleWorkflowHidden =
    Boolean(currentFilename) && !isHiddenWorkflowPath(currentFilename ?? '');
  const workflowIsHidden = currentFilename
    ? isManuallyHiddenWorkflowPath(currentFilename, hiddenWorkflowPaths)
    : false;

  // Nodes and groups for the currently-visible scope (root or a subgraph).
  // Fold-all / unfold-all should operate on visible items only.
  const currentScopeNodes = useMemo(() => {
    const top = scopeStack[scopeStack.length - 1];
    if (top?.type === 'subgraph' && workflow) {
      const sg = workflow.definitions?.subgraphs?.find((s) => s.id === top.id);
      if (sg) return sg.nodes ?? [];
    }
    return workflow?.nodes ?? [];
  }, [scopeStack, workflow]);

  const currentScopeGroups = useMemo(() => {
    const top = scopeStack[scopeStack.length - 1];
    if (top?.type === 'subgraph' && workflow) {
      const sg = workflow.definitions?.subgraphs?.find((s) => s.id === top.id);
      if (sg) return sg.groups ?? [];
    }
    return workflow?.groups ?? [];
  }, [scopeStack, workflow]);

  const allWorkflowNodeHierarchicalKeys = useMemo(() => (
    currentScopeNodes
      .map((node) => requireHierarchicalKey(node.itemKey, `node ${node.id}`))
  ), [currentScopeNodes]);
  const allGroupTargets = useMemo(() => {
    // For fold/unfold, use current scope's groups only.
    // (Button visibility uses these same keys, which is fine — reflects what's visible.)
    return currentScopeGroups
      .map((group) => requireHierarchicalKey(group.itemKey, `group ${group.id}`));
  }, [currentScopeGroups]);
  // Subgraph accordion containers only exist at root scope.
  const allSubgraphHierarchicalKeys = useMemo(() => {
    const top = scopeStack[scopeStack.length - 1];
    if (top?.type !== 'root') return [];
    return workflow?.definitions?.subgraphs?.map((subgraph) =>
      requireHierarchicalKey(subgraph.itemKey, `subgraph ${subgraph.id}`)
    ) ?? [];
  }, [scopeStack, workflow]);

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
          const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
          return hiddenItems[itemKey];
        })()
      ).length,
    [bypassedNodes, hiddenItems]
  );
  const hiddenStaticCount = useMemo(
    () =>
      staticNodes.filter((node) =>
        (() => {
          const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
          return hiddenItems[itemKey];
        })()
      ).length,
    [staticNodes, hiddenItems]
  );

  const visibleNodes = useMemo(() => (
    currentScopeNodes.filter((node) => {
      const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
      return !hiddenItems[itemKey];
    })
  ), [currentScopeNodes, hiddenItems]);

  const hasFoldedVisibleNode = useMemo(
    () =>
      visibleNodes.some((node) => {
        const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
        return collapsedItems[itemKey] === true;
      }),
    [collapsedItems, visibleNodes]
  );
  const hasUnfoldedVisibleNode = useMemo(
    () =>
      visibleNodes.some((node) => {
        const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
        return collapsedItems[itemKey] !== true;
      }),
    [collapsedItems, visibleNodes]
  );
  const hasCollapsedGroup = useMemo(
    () => allGroupTargets.some((itemKey) => collapsedItems[itemKey] === true),
    [allGroupTargets, collapsedItems]
  );
  const hasExpandedGroup = useMemo(
    () => allGroupTargets.some((itemKey) => (collapsedItems[itemKey] ?? false) === false),
    [allGroupTargets, collapsedItems]
  );
  const hasCollapsedSubgraph = useMemo(
    () => allSubgraphHierarchicalKeys.some((itemKey) =>
      (collapsedItems[itemKey] ?? false)
    ),
    [allSubgraphHierarchicalKeys, collapsedItems]
  );
  const hasExpandedSubgraph = useMemo(
    () => allSubgraphHierarchicalKeys.some((itemKey) =>
      (collapsedItems[itemKey] ?? false) === false
    ),
    [allSubgraphHierarchicalKeys, collapsedItems]
  );
  const hasFoldedVisibleItem = hasFoldedVisibleNode || hasCollapsedGroup || hasCollapsedSubgraph;
  const hasUnfoldedVisibleItem = hasUnfoldedVisibleNode || hasExpandedGroup || hasExpandedSubgraph;
  const showAllHiddenNodesButton = useMemo(() => {
    if (manuallyHiddenCount > 0) return true;
    const anyHiddenGroup = allGroupTargets.some((itemKey) => hasStableFlag(hiddenItems, itemKey));
    if (anyHiddenGroup) return true;
    return allSubgraphHierarchicalKeys.some((itemKey) => hiddenItems[itemKey] === true);
  }, [manuallyHiddenCount, hiddenItems, allGroupTargets, allSubgraphHierarchicalKeys, hasStableFlag]);

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

  const handleAddGroupClick = () => {
    onAddGroup();
    closeMenu();
  };

  const handleFoldAllClick = () => {
    allWorkflowNodeHierarchicalKeys.forEach((itemKey) => setItemCollapsed(itemKey, true));
    allGroupTargets.forEach((itemKey) => setItemCollapsed(itemKey, true));
    allSubgraphHierarchicalKeys.forEach((itemKey) => setItemCollapsed(itemKey, true));
    closeMenu();
  };

  const handleUnfoldAllClick = () => {
    allWorkflowNodeHierarchicalKeys.forEach((itemKey) => setItemCollapsed(itemKey, false));
    allGroupTargets.forEach((itemKey) => setItemCollapsed(itemKey, false));
    allSubgraphHierarchicalKeys.forEach((itemKey) => setItemCollapsed(itemKey, false));
    closeMenu();
  };

  const handleShowAllHiddenClick = () => {
    showAllHiddenNodes();
    allGroupTargets.forEach((itemKey) => setItemHidden(itemKey, false));
    allSubgraphHierarchicalKeys.forEach((itemKey) => setItemHidden(itemKey, false));
  };

  const handleClearBookmarksClick = () => {
    clearBookmarks();
    closeMenu();
  };

  const handleReloadWorkflowClick = () => {
    closeMenu();
    // Parent reloads in the current tab and confirms if there are unsaved changes.
    onReloadWorkflow();
  };

  return (
    <div id="workflow-menu-container" className="relative">
      <ContextMenuButton
        buttonRef={buttonRef}
        onClick={onToggle}
        ariaLabel="Workflow options"
        className={`transition-colors ${appChromeIconButtonBareClassName}`}
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
                key: 'add-group',
                label: 'Add group',
                icon: <PlusIcon className="w-4 h-4" />,
                onClick: handleAddGroupClick,
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
                onClick: handleReloadWorkflowClick,
                hidden: !canReload
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
            className="w-full max-w-sm bg-slate-900 border border-white/10 text-slate-100 rounded-xl shadow-lg overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 text-sm font-semibold text-slate-100 border-b border-white/10">
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
                          const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
                          setItemHidden(itemKey, true);
                        });
                      } else {
                        staticNodes.forEach((node) => {
                          const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
                          setItemHidden(itemKey, false);
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
                          const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
                          setItemHidden(itemKey, false);
                        });
                      } else {
                        bypassedNodes.forEach((node) => {
                          const itemKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
                          setItemHidden(itemKey, true);
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
                  },
                  {
                    key: 'toggle-workflow-hidden',
                    label: workflowIsHidden ? 'Unhide this workflow' : 'Hide this workflow',
                    icon: workflowIsHidden
                      ? <EyeIcon className="w-4 h-4" />
                      : <EyeOffIcon className="w-4 h-4" />,
                    onClick: () => {
                      if (currentFilename) toggleWorkflowHidden(currentFilename);
                      setVisibilityModalOpen(false);
                    },
                    hidden: !canToggleWorkflowHidden
                  }
                ]}
              />
            </div>
            <div className="px-4 py-3 border-t border-white/10 flex justify-end">
              <button
                className="px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 rounded-lg"
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
