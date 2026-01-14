import { useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { NodeList } from './components/NodeList';
import { BottomBar } from './components/BottomBar';
import { HamburgerMenu } from './components/HamburgerMenu';
import { QueuePanel } from './components/QueuePanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ImageViewer } from './components/ImageViewer';
import { useWebSocket } from './hooks/useWebSocket';
import { useWorkflowStore, getInputWidgetDefinitions, getWidgetDefinitions } from './hooks/useWorkflow';
import { useOverallProgress } from './hooks/useOverallProgress';
import { useQueueStore } from './hooks/useQueue';
import { useHistoryStore } from './hooks/useHistory';
import { useDismissOnOutsideClick } from './hooks/useDismissOnOutsideClick';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';
import { useTextareaFocus } from './hooks/useTextareaFocus';
import * as api from './api/client';
import { loadUserWorkflow, loadTemplateWorkflow } from './api/client';
import type { HistoryOutputImage } from './api/types';
import { buildViewerImages, type ViewerImage } from './utils/viewerImages';
import { InfoIcon } from './components/InfoIcon';
import { CancelCircleIcon, CaretDownIcon, CaretRightIcon, EllipsisVerticalIcon, EyeIcon, EyeOffIcon, LogoutIcon, ReloadIcon, TrashIcon } from './components/icons';

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const queueOpen = useWorkflowStore((s) => s.queuePanelOpen);
  const setQueuePanelOpen = useWorkflowStore((s) => s.setQueuePanelOpen);
  const [historyOpen, setHistoryOpen] = useState(false);
  const viewerOpen = useWorkflowStore((s) => s.viewerOpen);
  const viewerImages = useWorkflowStore((s) => s.viewerImages);
  const viewerIndex = useWorkflowStore((s) => s.viewerIndex);
  const viewerScale = useWorkflowStore((s) => s.viewerScale);
  const viewerTranslate = useWorkflowStore((s) => s.viewerTranslate);
  const setViewerState = useWorkflowStore((s) => s.setViewerState);
  const [followQueue, setFollowQueue] = useState(false);
  const [viewerEntryPoint, setViewerEntryPoint] = useState<'workflow' | 'queue' | null>(null);
  const [queueMenuOpen, setQueueMenuOpen] = useState(false);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const queueMenuButtonRef = useRef<HTMLButtonElement>(null);
  const queueMenuRef = useRef<HTMLDivElement>(null);
  const workflowMenuButtonRef = useRef<HTMLButtonElement>(null);
  const workflowMenuRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const { isInputFocused } = useTextareaFocus();

  useWebSocket();
  const { swipeOffset, isSwiping, setSwipeEnabled, resetSwipeState } = useSwipeNavigation({
    queueOpen,
    setQueuePanelOpen,
    isInputFocused,
    viewerOpen,
    menuOpen,
    historyOpen
  });
  const setNodeTypes = useWorkflowStore((s) => s.setNodeTypes);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const workflow = useWorkflowStore((s) => s.workflow);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const theme = useWorkflowStore((s) => s.theme);
  const workflowLoadedAt = useWorkflowStore((s) => s.workflowLoadedAt);
  const previewVisibility = useWorkflowStore((s) => s.previewVisibility);
  const setPreviewVisibility = useWorkflowStore((s) => s.setPreviewVisibility);
  const previewVisibilityDefault = useWorkflowStore((s) => s.previewVisibilityDefault);
  const setPreviewVisibilityDefault = useWorkflowStore((s) => s.setPreviewVisibilityDefault);
  const hideStaticNodes = useWorkflowStore((s) => s.hideStaticNodes);
  const toggleHideStaticNodes = useWorkflowStore((s) => s.toggleHideStaticNodes);
  const hideBypassedNodes = useWorkflowStore((s) => s.hideBypassedNodes);
  const toggleHideBypassedNodes = useWorkflowStore((s) => s.toggleHideBypassedNodes);
  const manuallyHiddenNodes = useWorkflowStore((s) => s.manuallyHiddenNodes);
  const showAllHiddenNodes = useWorkflowStore((s) => s.showAllHiddenNodes);
  const showQueueMetadata = useWorkflowStore((s) => s.showQueueMetadata);
  const toggleShowQueueMetadata = useWorkflowStore((s) => s.toggleShowQueueMetadata);
  const clearWorkflowCache = useWorkflowStore((s) => s.clearWorkflowCache);
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const unloadWorkflow = useWorkflowStore((s) => s.unloadWorkflow);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const setQueueItemExpanded = useWorkflowStore((s) => s.setQueueItemExpanded);
  const queueItemExpanded = useWorkflowStore((s) => s.queueItemExpanded);
  const setNodeFold = useWorkflowStore((s) => s.setNodeFold);
  const fetchQueue = useQueueStore((s) => s.fetchQueue);
  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  const clearQueue = useQueueStore((s) => s.clearQueue);
  const history = useHistoryStore((s) => s.history);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const clearEmptyItems = useHistoryStore((s) => s.clearEmptyItems);
  const lastFollowPromptRef = useRef<string | null>(null);

  const followQueueSwitchId = useMemo(() => {
    if (!viewerOpen || !followQueue) return null;
    return history[0]?.prompt_id ?? null;
  }, [viewerOpen, followQueue, history]);

  const effectiveRunKey = executingPromptId || (running.length === 1 ? running[0].prompt_id : null);
  const overallProgress = useOverallProgress({
    workflow,
    runKey: effectiveRunKey,
    isRunning: isExecuting || running.length > 0,
    workflowDurationStats,
  });
  const isGenerating = isExecuting || running.length > 0;

  const isQueueMenuOpen = queueOpen && queueMenuOpen;

  useDismissOnOutsideClick({
    open: isQueueMenuOpen,
    onDismiss: () => setQueueMenuOpen(false),
    triggerRef: queueMenuButtonRef,
    contentRef: queueMenuRef,
    closeOnScroll: false
  });

  useDismissOnOutsideClick({
    open: workflowMenuOpen,
    onDismiss: () => setWorkflowMenuOpen(false),
    triggerRef: workflowMenuButtonRef,
    contentRef: workflowMenuRef,
    closeOnScroll: false
  });

  // Load node types on mount
  useEffect(() => {
    api.getNodeTypes()
      .then((types) => {
        setNodeTypes(types);
      })
      .catch((err) => {
        console.error('Failed to load node types:', err);
      });
  }, [setNodeTypes]);

  // Fetch initial queue state
  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const openViewer = (images: Array<ViewerImage>, index: number, enableFollowQueue = true) => {
    // Disable swipe navigation before opening viewer
    setSwipeEnabled(false);
    resetSwipeState();

    setViewerState({
      viewerImages: images,
      viewerIndex: index,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
      viewerOpen: true,
    });

    setViewerEntryPoint(queueOpen ? 'queue' : 'workflow');
    if (enableFollowQueue) {
      if (history.length > 0) {
        lastFollowPromptRef.current = history[0].prompt_id;
      }
      setFollowQueue(true);
    }
  };

  // Open viewer in follow queue mode (from bottom bar button)
  const openFollowQueueViewer = () => {
    const allImages = buildViewerImages(history, { onlyOutput: true, alt: 'Generation' });

    // Disable swipe navigation before opening viewer
    setSwipeEnabled(false);
    resetSwipeState();

    const firstNewImageIndex = allImages.length > 0 ? 0 : -1;

    setViewerState({
      viewerImages: allImages,
      viewerIndex: firstNewImageIndex,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
      viewerOpen: true,
    });
    setViewerEntryPoint(queueOpen ? 'queue' : 'workflow');
    setFollowQueue(true);
    lastFollowPromptRef.current = history[0]?.prompt_id ?? null;
  };

  const hasPending = pending.length > 0;
  const hasHistory = history.length > 0;
  const hasEmptyHistory = history.some((item) => item.outputs.images.length === 0);
  const hasQueueItems = pending.length + running.length + history.length > 0;
  const allWorkflowNodeIds = useMemo(() => (
    workflow?.nodes.map((node) => node.id) ?? []
  ), [workflow]);
  const bypassedNodeCount = useMemo(() => (
    workflow?.nodes.filter((node) => node.mode === 4).length ?? 0
  ), [workflow]);
  const staticNodeCount = useMemo(() => {
    if (!workflow) return 0;
    return workflow.nodes.filter((node) => {
      const widgetDefs = getWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      return widgetDefs.length === 0 && inputWidgetDefs.length === 0;
    }).length;
  }, [workflow, nodeTypes]);
  const manuallyHiddenCount = useMemo(
    () => Object.values(manuallyHiddenNodes).filter(Boolean).length,
    [manuallyHiddenNodes]
  );

  // Compute visible nodes for fold/unfold logic
  const visibleNodes = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes.filter((node) => {
      if (manuallyHiddenNodes[node.id]) return false;
      if (hideBypassedNodes && node.mode === 4) return false;
      if (hideStaticNodes) {
        const widgetDefs = getWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
        const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
        if (widgetDefs.length === 0 && inputWidgetDefs.length === 0) return false;
      }
      return true;
    });
  }, [workflow, manuallyHiddenNodes, hideBypassedNodes, hideStaticNodes, nodeTypes]);

  const hasFoldedVisibleNode = useMemo(
    () => visibleNodes.some((node) => node.flags?.collapsed),
    [visibleNodes]
  );
  const hasUnfoldedVisibleNode = useMemo(
    () => visibleNodes.some((node) => !node.flags?.collapsed),
    [visibleNodes]
  );

  // Only show "Show all hidden nodes" if there are hidden nodes beyond what specific buttons cover
  // i.e., manually hidden non-categorized nodes exist, OR both static AND bypassed nodes are hidden
  const showAllHiddenNodesButton = useMemo(() => {
    // Condition 1: At least 1 manually hidden non-static non-bypassed node
    if (manuallyHiddenCount > 0) {
      const hasManuallyHiddenNonCategorized = workflow?.nodes.some((node) => {
        if (!manuallyHiddenNodes[node.id]) return false;
        const isBypassed = node.mode === 4;
        const widgetDefs = getWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
        const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
        const isStatic = widgetDefs.length === 0 && inputWidgetDefs.length === 0;
        return !isBypassed && !isStatic;
      });
      if (hasManuallyHiddenNonCategorized) return true;
    }
    // Condition 2: At least 1 static node is hidden AND at least 1 bypassed node is hidden
    const hasHiddenStatic = hideStaticNodes && staticNodeCount > 0;
    const hasHiddenBypassed = hideBypassedNodes && bypassedNodeCount > 0;
    if (hasHiddenStatic && hasHiddenBypassed) return true;
    return false;
  }, [manuallyHiddenCount, hideStaticNodes, hideBypassedNodes, staticNodeCount, bypassedNodeCount, workflow, manuallyHiddenNodes, nodeTypes]);
  const allQueuePromptIds = useMemo(() => {
    const ids = new Set<string>();
    pending.forEach((item) => ids.add(item.prompt_id));
    running.forEach((item) => ids.add(item.prompt_id));
    history.forEach((item) => {
      if (item.prompt_id) ids.add(String(item.prompt_id));
    });
    return Array.from(ids);
  }, [pending, running, history]);

  // Compute queue fold/unfold visibility
  const hasFoldedQueueItem = useMemo(() => {
    return allQueuePromptIds.some((id) => queueItemExpanded[id] === false);
  }, [allQueuePromptIds, queueItemExpanded]);

  const hasUnfoldedQueueItem = useMemo(() => {
    // Default state is expanded, so items not in the map are considered expanded
    return allQueuePromptIds.some((id) => queueItemExpanded[id] !== false);
  }, [allQueuePromptIds, queueItemExpanded]);
  const previewPromptIds = useMemo(() => {
    const ids = new Set<string>();
    history.forEach((item) => {
      const images = item.outputs?.images ?? [];
      const hasPreviews = images.some((img: HistoryOutputImage) => img.type !== 'output');
      if (hasPreviews) {
        if (item.prompt_id) ids.add(String(item.prompt_id));
      }
    });
    return Array.from(ids);
  }, [history]);
  const hasPreviewToggle = hasQueueItems || previewPromptIds.length > 0 || previewVisibilityDefault;
  const previewsVisible = previewPromptIds.length > 0
    ? previewPromptIds.every((id) => previewVisibility[id] ?? previewVisibilityDefault)
    : previewVisibilityDefault;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (!viewerOpen || !followQueue) return;
    if (history.length === 0) return;
    const latest = history[0];
    if (lastFollowPromptRef.current === latest.prompt_id) return;
    const latestOutputImages = latest.outputs.images
      .filter((img: HistoryOutputImage) => img.type === 'output');
    if (latestOutputImages.length === 0) return;

    const allImages = buildViewerImages(history, { onlyOutput: true, alt: 'Generation' });

    // Safety check - don't update if no images
    if (allImages.length === 0) return;

    // Default to the first image from the latest generation.
    const firstNewImageIndex = 0;

    lastFollowPromptRef.current = latest.prompt_id;
    setViewerState({
      viewerImages: allImages,
      viewerIndex: firstNewImageIndex,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
    });
  }, [viewerOpen, followQueue, history, setViewerState]);

  useEffect(() => {
    if (!viewerOpen || !followQueue) {
      lastFollowPromptRef.current = null;
    }
  }, [viewerOpen, followQueue]);

  useEffect(() => {
    if (!workflowLoadedAt) return;
    queueMicrotask(() => {
      setHistoryOpen(false);
      setFollowQueue(false);
      setQueueMenuOpen(false);
      setWorkflowMenuOpen(false);
    });
  }, [workflowLoadedAt]);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top bar with hamburger menu */}
      <TopBar
        onMenuClick={() => setMenuOpen(true)}
        mode={queueOpen ? 'queue' : 'workflow'}
        rightSlot={queueOpen ? (
          <div className="relative">
            <button
              ref={queueMenuButtonRef}
              onClick={() => setQueueMenuOpen((prev) => !prev)}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100"
              aria-label="Queue options"
            >
              <EllipsisVerticalIcon className="w-5 h-5 -rotate-90" />
            </button>
            {isQueueMenuOpen && (
              <div
                ref={queueMenuRef}
                className="absolute right-0 top-11 z-50 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
              >
                {hasPending && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={async () => {
                      await clearQueue();
                      setQueueMenuOpen(false);
                    }}
                  >
                    <CancelCircleIcon className="w-4 h-4 text-gray-500" />
                    Cancel all pending
                  </button>
                )}
                {hasUnfoldedQueueItem && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      allQueuePromptIds.forEach((id) => setQueueItemExpanded(id, false));
                      setQueueMenuOpen(false);
                    }}
                  >
                    <CaretRightIcon className="w-6 h-6 -ml-1 text-gray-500" />
                    Fold all
                  </button>
                )}
                {hasFoldedQueueItem && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      allQueuePromptIds.forEach((id) => setQueueItemExpanded(id, true));
                      setQueueMenuOpen(false);
                    }}
                  >
                    <CaretDownIcon className="w-6 h-6 -ml-1 text-gray-500" />
                    Unfold all
                  </button>
                )}
                {hasHistory && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      toggleShowQueueMetadata();
                      setQueueMenuOpen(false);
                    }}
                  >
                    <InfoIcon className="w-4 h-4 text-gray-500" />
                    {showQueueMetadata ? 'Hide metadata' : 'Show metadata'}
                  </button>
                )}
                {hasPreviewToggle && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      const nextVisible = !previewsVisible;
                      setPreviewVisibilityDefault(nextVisible);
                      previewPromptIds.forEach((id) => setPreviewVisibility(id, nextVisible));
                      setQueueMenuOpen(false);
                    }}
                  >
                    {previewsVisible ? (
                      <EyeOffIcon className="w-4 h-4 text-gray-500" />
                    ) : (
                      <EyeIcon className="w-4 h-4 text-gray-500" />
                    )}
                    {previewsVisible ? 'Hide previews' : 'Show previews'}
                  </button>
                )}
                {hasEmptyHistory && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 text-gray-600"
                    onClick={async () => {
                      await clearEmptyItems();
                      setQueueMenuOpen(false);
                    }}
                  >
                    <TrashIcon className="w-4 h-4" />
                    Clear empty items
                  </button>
                )}
                {hasHistory && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-600"
                    onClick={() => {
                      setQueueMenuOpen(false);
                      setClearHistoryConfirmOpen(true);
                    }}
                  >
                    <TrashIcon className="w-4 h-4" />
                    Clear history
                  </button>
                )}
                {!hasPending && !hasHistory && !hasQueueItems && (
                  <div className="px-3 py-2 text-sm text-gray-400">No actions</div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            <button
              ref={workflowMenuButtonRef}
              onClick={() => setWorkflowMenuOpen((prev) => !prev)}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100"
              aria-label="Workflow options"
            >
              <EllipsisVerticalIcon className="w-5 h-5 -rotate-90" />
            </button>
            {workflowMenuOpen && (
              <div
                ref={workflowMenuRef}
                className="absolute right-0 top-11 z-50 w-52 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
              >
                {hasUnfoldedVisibleNode && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      allWorkflowNodeIds.forEach((id) => setNodeFold(id, true));
                      setWorkflowMenuOpen(false);
                    }}
                  >
                    <CaretRightIcon className="w-6 h-6 -ml-1 text-gray-500" />
                    Fold all
                  </button>
                )}
                {hasFoldedVisibleNode && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      allWorkflowNodeIds.forEach((id) => setNodeFold(id, false));
                      setWorkflowMenuOpen(false);
                    }}
                  >
                    <CaretDownIcon className="w-6 h-6 -ml-1 text-gray-500" />
                    Unfold all
                  </button>
                )}
                {staticNodeCount > 0 && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      toggleHideStaticNodes();
                      setWorkflowMenuOpen(false);
                    }}
                  >
                    {hideStaticNodes ? (
                      <EyeIcon className="w-4 h-4 text-gray-500" />
                    ) : (
                      <EyeOffIcon className="w-4 h-4 text-gray-500" />
                    )}
                    {hideStaticNodes ? 'Show static nodes' : 'Hide static nodes'} ({staticNodeCount})
                  </button>
                )}
                {bypassedNodeCount > 0 && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      toggleHideBypassedNodes();
                      setWorkflowMenuOpen(false);
                    }}
                  >
                    {hideBypassedNodes ? (
                      <EyeIcon className="w-4 h-4 text-gray-500" />
                    ) : (
                      <EyeOffIcon className="w-4 h-4 text-gray-500" />
                    )}
                    {hideBypassedNodes ? 'Show bypassed nodes' : 'Hide bypassed nodes'} ({bypassedNodeCount})
                  </button>
                )}
                {showAllHiddenNodesButton && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      showAllHiddenNodes();
                      setWorkflowMenuOpen(false);
                    }}
                  >
                    <EyeIcon className="w-4 h-4 text-gray-500" />
                    Show all hidden nodes
                  </button>
                )}
                {/* Reload workflow - only show if source is reloadable */}
                {workflowSource && (
                  workflowSource.type === 'user' ? (
                    <button
                      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={async () => {
                        try {
                          const data = await loadUserWorkflow(workflowSource.filename);
                          loadWorkflow(data, workflowSource.filename, { fresh: true, source: workflowSource });
                        } catch (err) {
                          console.error('Failed to reload workflow:', err);
                        }
                        setWorkflowMenuOpen(false);
                      }}
                    >
                      <ReloadIcon className="w-4 h-4 text-gray-500" />
                      Reload workflow
                    </button>
                  ) : workflowSource.type === 'template' ? (
                    <button
                      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={async () => {
                        try {
                          const data = await loadTemplateWorkflow(workflowSource.moduleName, workflowSource.templateName);
                          loadWorkflow(data, `${workflowSource.moduleName}/${workflowSource.templateName}`, { fresh: true, source: workflowSource });
                        } catch (err) {
                          console.error('Failed to reload template:', err);
                        }
                        setWorkflowMenuOpen(false);
                      }}
                    >
                      <ReloadIcon className="w-4 h-4 text-gray-500" />
                      Reload workflow
                    </button>
                  ) : workflowSource.type === 'history' ? (
                    // Check if history item still exists
                    history.find(h => h.prompt_id === workflowSource.promptId)?.workflow ? (
                      <button
                        className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => {
                          const historyItem = history.find(h => h.prompt_id === workflowSource.promptId);
                          if (historyItem?.workflow) {
                            loadWorkflow(
                              historyItem.workflow,
                              `history-${workflowSource.promptId}.json`,
                              { source: workflowSource }
                            );
                          }
                          setWorkflowMenuOpen(false);
                        }}
                      >
                        <ReloadIcon className="w-4 h-4 text-gray-500" />
                        Reload workflow
                      </button>
                    ) : null
                  ) : null
                )}
                {workflow && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                      clearWorkflowCache();
                      setWorkflowMenuOpen(false);
                    }}
                  >
                    <TrashIcon className="w-4 h-4 text-gray-500" />
                    Clear workflow cache
                  </button>
                )}
                {workflow && (
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-600"
                    onClick={() => {
                      unloadWorkflow();
                      setWorkflowMenuOpen(false);
                    }}
                  >
                    <LogoutIcon className="w-4 h-4" />
                    Unload workflow
                  </button>
                )}
                <button
                  className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-600"
                  onClick={async () => {
                    localStorage.clear();
                    sessionStorage.clear();
                    if ('caches' in window) {
                      const cacheNames = await caches.keys();
                      await Promise.all(cacheNames.map((name) => caches.delete(name)));
                    }
                    document.cookie.split(';').forEach((cookie) => {
                      const [name] = cookie.split('=');
                      document.cookie = `${name.trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
                    });
                    window.location.reload();
                  }}
                >
                  <TrashIcon className="w-4 h-4" />
                  Clear all cache
                </button>
              </div>
            )}
          </div>
        )}
      />

      {/* Main content area - scrollable node list */}
      <main
        ref={mainRef}
        className="pt-[60px] pb-[80px] min-h-screen relative"
      >
        <div
          className={`absolute inset-x-0 top-[60px] bottom-0 ${queueOpen && !isSwiping ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          style={{
            transform: isSwiping ? `translateX(${swipeOffset}px)` : undefined,
            transition: isSwiping ? 'none' : 'opacity 0.3s ease-out',
          }}
        >
          <NodeList onImageClick={openViewer} active={!queueOpen} />
        </div>
        <div
          className={`absolute inset-x-0 top-[60px] bottom-0 ${queueOpen || isSwiping ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{
            transform: isSwiping ? `translateX(${queueOpen ? swipeOffset : window.innerWidth + swipeOffset}px)` : undefined,
            transition: isSwiping ? 'none' : 'opacity 0.3s ease-out',
          }}
        >
          <QueuePanel open={queueOpen || isSwiping} onImageClick={openViewer} />
        </div>
        {/* Cover to hide content scrolling behind bottom bar */}
        <div
          className="fixed inset-x-0 bottom-0 bg-gray-100 pointer-events-none z-[1500]"
          style={{ height: 'var(--bottom-bar-offset, 80px)' }}
        />
      </main>

      {/* Bottom action bar */}
      <BottomBar
        queueOpen={queueOpen}
        viewerOpen={viewerOpen}
        followQueue={followQueue}
        onToggleFollowQueue={() => setFollowQueue((prev) => !prev)}
        onOpenFollowQueue={openFollowQueueViewer}
      />

      {/* Hamburger menu */}
      <HamburgerMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      {/* History panel */}
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} onImageClick={openViewer} />

      {clearHistoryConfirmOpen && (
        <div
          className="fixed inset-0 z-[1500] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setClearHistoryConfirmOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-gray-900 text-base font-semibold">Clear history?</div>
            <div className="text-gray-600 text-sm mt-1">
              This will permanently remove all completed generations from history. Generated files will still be present in your server's output folder.
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
                onClick={() => setClearHistoryConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700"
                onClick={async () => {
                  await clearHistory();
                  setClearHistoryConfirmOpen(false);
                }}
              >
                Clear history
              </button>
            </div>
          </div>
        </div>
      )}

      <ImageViewer
        open={viewerOpen}
        images={viewerImages}
        index={viewerIndex}
        onClose={() => {
          setViewerState({ viewerOpen: false });
          setFollowQueue(false);
          // Return to the entry point
          if (viewerEntryPoint === 'queue') {
            setQueuePanelOpen(true);
          } else {
            setQueuePanelOpen(false);
          }
          setViewerEntryPoint(null);
          // Re-enable swipe navigation
          setSwipeEnabled(true);
          resetSwipeState();
        }}
        onIndexChange={(nextIndex) => setViewerState({ viewerIndex: nextIndex })}
        initialScale={viewerScale}
        initialTranslate={viewerTranslate}
        onTransformChange={(next) => setViewerState(next)}
        followQueueActive={followQueue}
        followQueueSwitchId={followQueueSwitchId}
        overallProgress={overallProgress}
        isGenerating={isGenerating}
      />
    </div>
  );
}

export default App;
