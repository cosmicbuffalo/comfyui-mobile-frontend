import { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { LoadingSpinner } from './components/LoadingSpinner';
import { WorkflowPanel } from './components/WorkflowPanel';
import { BottomBar } from './components/BottomBar';
import { QueuePanel } from './components/QueuePanel';
import { ImageViewer } from './components/ImageViewer';
import { ConnectionLostOverlay } from './components/BackendStatusOverlay';
import { NoWorkflowImageDialog } from './components/modals/NoWorkflowImageDialog';
import { useWebSocket } from './hooks/useWebSocket';
import { useWorkflowStore } from './hooks/useWorkflow';
import { useNavigationStore } from './hooks/useNavigation';
import { useAppMenuStore } from './hooks/useAppMenu';
import { useImageViewerStore } from './hooks/useImageViewer';
import { useQueueStore } from './hooks/useQueue';
import { useHistoryStore } from './hooks/useHistory';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';
import { useAnimatedFavicon } from './hooks/useAnimatedFavicon';
import { useHistoryBackClose } from './hooks/useHistoryBackClose';
import { useWorkflowErrorsStore } from './hooks/useWorkflowErrors';
import { useTextareaFocus } from './hooks/useTextareaFocus';
import { useBookmarksStore } from './hooks/useBookmarks';
import * as api from './api/client';
import { getCachedNodeTypes, setCachedNodeTypes } from './utils/nodeTypesCache';
import { buildOutputPreferredViewerImages, type ViewerImage } from './utils/viewerImages';
import { OutputsPanel } from './components/OutputsPanel';
import { useOutputsStore } from './hooks/useOutputs';

function App() {
  const currentPanel = useNavigationStore((s) => s.currentPanel);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const appMenuOpen = useAppMenuStore((s) => s.appMenuOpen);
  const setAppMenuOpen = useAppMenuStore((s) => s.setAppMenuOpen);
  const viewerOpen = useImageViewerStore((s) => s.viewerOpen);
  const setViewerState = useImageViewerStore((s) => s.setViewerState);
  const followQueue = useWorkflowStore((s) => s.followQueue);

  // The workflow store hydrates asynchronously from IndexedDB; gate the UI on it
  // so a refresh doesn't flash an empty workflow before the saved one restores.
  // (With the synchronous localStorage fallback, hasHydrated() is already true.)
  const [storeHydrated, setStoreHydrated] = useState(
    () => useWorkflowStore.persist?.hasHydrated() ?? true,
  );
  useEffect(() => {
    const persist = useWorkflowStore.persist;
    if (!persist || persist.hasHydrated()) {
      setStoreHydrated(true);
      return;
    }
    const unsub = persist.onFinishHydration(() => setStoreHydrated(true));
    // Safety net: if hydration never signals completion (a throw mid-rehydrate
    // suppresses zustand's finish listeners; a wedged IndexedDB read never
    // resolves), reveal the app anyway instead of stranding it on the spinner.
    // Normal hydration is sub-second, so this only fires in the broken case.
    const fallback = window.setTimeout(() => setStoreHydrated(true), 8000);
    return () => {
      unsub?.();
      window.clearTimeout(fallback);
    };
  }, []);
  const setFollowQueue = useWorkflowStore((s) => s.setFollowQueue);
  const bookmarkRepositioningActive = useBookmarksStore(
    (s) => s.bookmarkRepositioningActive,
  );
  const mainRef = useRef<HTMLDivElement>(null);
  const { isInputFocused } = useTextareaFocus();
  const outputsViewerOpen = useOutputsStore((s) => s.outputsViewerOpen);
  const setOutputsViewerOpen = useOutputsStore((s) => s.setOutputsViewerOpen);
  const outputsSelectionMode = useOutputsStore((s) => s.selectionMode);
  const outputsFilterModalOpen = useOutputsStore((s) => s.filterModalOpen);
  const outputsSelectionActionOpen = useOutputsStore((s) => s.selectionActionOpen);
  const outputsCurrentFolder = useOutputsStore((s) => s.currentFolder);
  const outputsNavigateUp = useOutputsStore((s) => s.navigateUp);

  useWebSocket();

  // Tab favicon: pulsing green while anything is generating, solid cyan idle.
  const isGenerating = useQueueStore((s) => s.running.length > 0);
  useAnimatedFavicon(isGenerating);

  const handleSwipeLeft = useCallback(() => {
    if (currentPanel === 'workflow') setCurrentPanel('queue');
    else if (currentPanel === 'outputs') setCurrentPanel('workflow');
  }, [currentPanel, setCurrentPanel]);

  const handleSwipeRight = useCallback(() => {
    if (currentPanel === 'outputs' && outputsCurrentFolder) {
      outputsNavigateUp();
    } else if (currentPanel === 'workflow') {
      setCurrentPanel('outputs');
    } else if (currentPanel === 'queue') {
      setCurrentPanel('workflow');
    }
  }, [currentPanel, outputsCurrentFolder, outputsNavigateUp, setCurrentPanel]);

  const canSwipeLeft = currentPanel === 'workflow' || currentPanel === 'outputs';
  const canSwipeRight = currentPanel === 'workflow'
    || currentPanel === 'queue'
    || (currentPanel === 'outputs' && Boolean(outputsCurrentFolder));
  const { setSwipeEnabled, resetSwipeState } = useSwipeNavigation({
    onSwipeLeft: canSwipeLeft ? handleSwipeLeft : undefined,
    onSwipeRight: canSwipeRight ? handleSwipeRight : undefined,
    enabled:
      !isInputFocused &&
      !viewerOpen &&
      !appMenuOpen &&
      !outputsViewerOpen &&
      !bookmarkRepositioningActive &&
      !outputsSelectionMode &&
      !outputsFilterModalOpen &&
      !outputsSelectionActionOpen
  });
  const setNodeTypes = useWorkflowStore((s) => s.setNodeTypes);
  const ensureHierarchicalKeysAndRepair = useWorkflowStore((s) => s.ensureHierarchicalKeysAndRepair);
  const workflowLoadedAt = useWorkflowStore((s) => s.workflowLoadedAt);
  const fetchQueue = useQueueStore((s) => s.fetchQueue);

  useEffect(() => {
    if (outputsViewerOpen) {
      resetSwipeState();
    }
  }, [outputsViewerOpen, resetSwipeState]);

  const handleImageViewerClose = useCallback(() => {
    setViewerState({ viewerOpen: false });
    setFollowQueue(false);
    setSwipeEnabled(true);
    resetSwipeState();
  }, [setViewerState, setFollowQueue, setSwipeEnabled, resetSwipeState]);

  // Hardware/browser Back closes the topmost overlay instead of leaving the
  // app — the most instinctive gesture in a fullscreen gallery on Android.
  useHistoryBackClose(viewerOpen, handleImageViewerClose);
  useHistoryBackClose(outputsViewerOpen, () => setOutputsViewerOpen(false));
  useHistoryBackClose(appMenuOpen, () => setAppMenuOpen(false));

  // Load node types on mount, cache-first. `/api/object_info` can be several MB
  // with many custom node packs, so we render immediately from the IndexedDB
  // cache and revalidate from the network in the background (stale-while-
  // revalidate). First-ever load still pays the full fetch once.
  useEffect(() => {
    let cancelled = false;

    getCachedNodeTypes()
      .then((cached) => {
        // Don't clobber fresh data if the network already won the race.
        if (cancelled || !cached) return;
        if (!useWorkflowStore.getState().nodeTypes) setNodeTypes(cached);
      })
      .catch(() => {});

    api.getNodeTypes()
      .then((types) => {
        if (cancelled) return;
        setNodeTypes(types);
        void setCachedNodeTypes(types);
      })
      .catch((err) => {
        console.error('Failed to load node types:', err);
        if (cancelled) return;
        // With no cache (first visit) widgets render degraded and queueing
        // fails later with a confusing message — say what's wrong now.
        if (!useWorkflowStore.getState().nodeTypes) {
          useWorkflowErrorsStore
            .getState()
            .setError(
              'Failed to load node definitions from the server. Widgets may be missing or wrong — check the connection and reload the page.',
            );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setNodeTypes]);

  // Fetch initial queue state
  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // Memoized so it's a stable prop for the memoized QueueCard/WorkflowPanel —
  // otherwise every App render reconciles the whole queue list. All deps are
  // stable store actions / useCallback'd hook setters.
  const openViewer = useCallback((images: Array<ViewerImage>, index: number, enableFollowQueue = true) => {
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

    setFollowQueue(enableFollowQueue);
  }, [setSwipeEnabled, resetSwipeState, setViewerState, setFollowQueue]);

  // Global `q` shortcut: open Follow Queue mode from the workflow or queue
  // panel. Ignored when a text input is focused, the app menu is open, the
  // viewer is already open (MediaViewer has its own `q` handler that toggles
  // follow mode), or while reposition mode is active. Outputs panel is
  // excluded because it has its own viewer that doesn't use follow queue.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'q' && event.key !== 'Q') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInputFocused) return;
      if (viewerOpen || outputsViewerOpen) return;
      if (appMenuOpen || bookmarkRepositioningActive) return;
      if (currentPanel !== 'workflow' && currentPanel !== 'queue') return;
      event.preventDefault();
      openFollowQueueViewer();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
    // openFollowQueueViewer captures stable store actions and refs; the
    // identity changes every render but the body uses fresh store reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPanel, viewerOpen, outputsViewerOpen, appMenuOpen, isInputFocused, bookmarkRepositioningActive]);

  // Open viewer in follow queue mode (from bottom bar button)
  const openFollowQueueViewer = () => {
    // Read history fresh from the store so the keydown handler (whose effect
    // intentionally doesn't re-register on every history change) never opens
    // with a stale closed-over snapshot.
    const allImages = buildOutputPreferredViewerImages(
      useHistoryStore.getState().history,
      { alt: 'Generation' },
    );

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
    setFollowQueue(true);
  };

  useEffect(() => {
    if (!workflowLoadedAt) return;
    queueMicrotask(() => {
      setFollowQueue(false);
    });
  }, [workflowLoadedAt, setFollowQueue]);

  useEffect(() => {
    if (!workflowLoadedAt) return;
    ensureHierarchicalKeysAndRepair();
  }, [workflowLoadedAt, ensureHierarchicalKeysAndRepair]);

  if (!storeHydrated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div id="app-root" className="min-h-screen bg-slate-950">
      <TopBar mode={currentPanel} />

      <main
        id="main-content"
        ref={mainRef}
        className="min-h-screen relative"
        style={{
          paddingTop: "var(--top-bar-offset, 69px)",
          paddingBottom: "var(--bottom-bar-offset, 80px)",
        }}
      >
        <>
          <OutputsPanel visible={currentPanel === 'outputs'} />
          <WorkflowPanel visible={currentPanel === 'workflow'} onImageClick={openViewer} />
          <QueuePanel visible={currentPanel === 'queue'} onImageClick={openViewer} />
        </>
        <div
          id="bottom-bar-spacer"
          className="fixed inset-x-0 bottom-0 bg-slate-950 pointer-events-none z-[1500]"
          style={{ height: 'var(--bottom-bar-offset, 80px)' }}
        />
      </main>

      <BottomBar
        currentPanel={currentPanel}
        viewerOpen={viewerOpen}
        followQueue={followQueue}
        onToggleFollowQueue={() => setFollowQueue(!followQueue)}
        onOpenFollowQueue={openFollowQueueViewer}
      />

      <ImageViewer
        onClose={handleImageViewerClose}
      />

      <ConnectionLostOverlay />
      <NoWorkflowImageDialog />
    </div>
  );
}

export default App;
