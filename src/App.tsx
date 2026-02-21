import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { WorkflowPanel } from './components/WorkflowPanel';
import { BottomBar } from './components/BottomBar';
import { QueuePanel } from './components/QueuePanel';
import { ImageViewer } from './components/ImageViewer';
import { useWebSocket } from './hooks/useWebSocket';
import { useWorkflowStore } from './hooks/useWorkflow';
import { useNavigationStore } from './hooks/useNavigation';
import { useThemeStore } from './hooks/useTheme';
import { useAppMenuStore } from './hooks/useAppMenu';
import { useImageViewerStore } from './hooks/useImageViewer';
import { useQueueStore } from './hooks/useQueue';
import { useHistoryStore } from './hooks/useHistory';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';
import { useTextareaFocus } from './hooks/useTextareaFocus';
import { useBookmarksStore } from './hooks/useBookmarks';
import * as api from './api/client';
import { buildViewerImages, type ViewerImage } from './utils/viewerImages';
import { OutputsPanel } from './components/OutputsPanel';
import { useOutputsStore } from './hooks/useOutputs';

function App() {
  const currentPanel = useNavigationStore((s) => s.currentPanel);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const appMenuOpen = useAppMenuStore((s) => s.appMenuOpen);
  const viewerOpen = useImageViewerStore((s) => s.viewerOpen);
  const setViewerState = useImageViewerStore((s) => s.setViewerState);
  const followQueue = useWorkflowStore((s) => s.followQueue);
  const setFollowQueue = useWorkflowStore((s) => s.setFollowQueue);
  const bookmarkRepositioningActive = useBookmarksStore(
    (s) => s.bookmarkRepositioningActive,
  );
  const mainRef = useRef<HTMLDivElement>(null);
  const { isInputFocused } = useTextareaFocus();
  const outputsViewerOpen = useOutputsStore((s) => s.outputsViewerOpen);
  const outputsSelectionMode = useOutputsStore((s) => s.selectionMode);
  const outputsFilterModalOpen = useOutputsStore((s) => s.filterModalOpen);
  const outputsSelectionActionOpen = useOutputsStore((s) => s.selectionActionOpen);
  const outputsCurrentFolder = useOutputsStore((s) => s.currentFolder);
  const outputsNavigateUp = useOutputsStore((s) => s.navigateUp);

  useWebSocket();

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
  const { swipeOffset, isSwiping, setSwipeEnabled, resetSwipeState } = useSwipeNavigation({
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
  const ensureStableKeysAndRepair = useWorkflowStore((s) => s.ensureStableKeysAndRepair);
  const theme = useThemeStore((s) => s.theme);
  const workflowLoadedAt = useWorkflowStore((s) => s.workflowLoadedAt);
  const fetchQueue = useQueueStore((s) => s.fetchQueue);
  const history = useHistoryStore((s) => s.history);

  useEffect(() => {
    if (!isSwiping && swipeOffset !== 0) {
      resetSwipeState();
    }
  }, [isSwiping, swipeOffset, resetSwipeState]);

  useEffect(() => {
    if (outputsViewerOpen) {
      resetSwipeState();
    }
  }, [outputsViewerOpen, resetSwipeState]);

  const handleImageViewerClose = () => {
    setViewerState({ viewerOpen: false });
    setFollowQueue(false);
    setSwipeEnabled(true);
    resetSwipeState();
  };

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

    setFollowQueue(enableFollowQueue);
  };

  // Open viewer in follow queue mode (from bottom bar button)
  const openFollowQueueViewer = () => {
    const allImages = buildViewerImages(history, { alt: 'Generation' });

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

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (!workflowLoadedAt) return;
    queueMicrotask(() => {
      setFollowQueue(false);
    });
  }, [workflowLoadedAt, setFollowQueue]);

  useEffect(() => {
    if (!workflowLoadedAt) return;
    ensureStableKeysAndRepair();
  }, [workflowLoadedAt, ensureStableKeysAndRepair]);

  return (
    <div id="app-root" className="min-h-screen bg-gray-100">
      <TopBar mode={currentPanel} />

      <main
        id="main-content"
        ref={mainRef}
        className="pt-[69px] pb-[80px] min-h-screen relative"
      >
        <>
          <OutputsPanel visible={currentPanel === 'outputs'} />
          <WorkflowPanel visible={currentPanel === 'workflow'} onImageClick={openViewer} />
          <QueuePanel visible={currentPanel === 'queue'} onImageClick={openViewer} />
        </>
        <div
          id="bottom-bar-spacer"
          className="fixed inset-x-0 bottom-0 bg-gray-100 pointer-events-none z-[1500]"
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
    </div>
  );
}

export default App;
