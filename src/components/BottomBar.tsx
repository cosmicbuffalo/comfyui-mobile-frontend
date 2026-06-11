import { useEffect, useRef } from "react";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useImageViewerStore } from "@/hooks/useImageViewer";
import { useOverallProgress } from "@/hooks/useOverallProgress";
import { useQueueStore } from "@/hooks/useQueue";
import { useGenerationSettingsStore } from "@/hooks/useGenerationSettings";
import { BottomStatusOverlay } from "./BottomBar/BottomStatusOverlay";
import { FollowQueueButton } from "./BottomBar/FollowQueueButton";
import { InfiniteLoopToggle } from "./BottomBar/InfiniteLoopToggle";
import { PinnedWidgetOverlayModal } from "./BottomBar/PinnedWidgetOverlayModal";
import { OutputsActionButton } from "./BottomBar/OutputsActionButton";
import { PinnedWidgetButton } from "./BottomBar/PinnedWidgetButton";
import { RunButton } from "./BottomBar/RunButton";
import { RunCountSelector } from "./BottomBar/RunCountSelector";
import { SkipButton } from "./BottomBar/SkipButton";

export type BottomBarProps = {
  currentPanel: 'workflow' | 'queue' | 'outputs';
  viewerOpen?: boolean;
  followQueue?: boolean;
  onToggleFollowQueue?: () => void;
  onOpenFollowQueue?: () => void;
};

export function BottomBar(props: BottomBarProps) {
  const {
    currentPanel,
    viewerOpen = false,
    followQueue = false,
    onToggleFollowQueue,
    onOpenFollowQueue,
  } = props;
  const isOutputsPanel = currentPanel === 'outputs';
  // Optionally fade the bar out together with the viewer overlays once they go idle.
  // `viewerIdle` is only true while a MediaViewer is open and idle (it's reset
  // on close/unmount), so it already implies a viewer is showing — this covers
  // both the app-level viewer and the outputs panel's own MediaViewer instance,
  // which uses a separate open flag (useOutputsStore.outputsViewerOpen).
  const viewerIdle = useImageViewerStore((s) => s.viewerIdle);
  const workflow = useWorkflowStore((s) => s.workflow);
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const setInfiniteLoop = useWorkflowStore((s) => s.setInfiniteLoop);
  const isStopping = useWorkflowStore((s) => s.isStopping);
  const infiniteModeEnabled = useGenerationSettingsStore((s) => s.infiniteModeEnabled);
  const hideBottomBarWhenViewerIdle = useGenerationSettingsStore(
    (s) => s.hideBottomBarWhenViewerIdle,
  );
  const fadeWithViewer = hideBottomBarWhenViewerIdle && viewerIdle;
  // Infinite-loop re-enqueue is driven from the websocket execution-finished
  // handler (per session), not a React effect here.
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const workflowDurationStats = useWorkflowStore(
    (s) => s.workflowDurationStats,
  );
  const pending = useQueueStore((s) => s.pending);
  const running = useQueueStore((s) => s.running);
  const barRef = useRef<HTMLDivElement>(null);

  const queueSize = pending.length + running.length;
  const runKey = executingPromptId || (running[0]?.prompt_id ?? null);
  const overallProgress = useOverallProgress({
    workflow,
    runKey,
    isRunning: isExecuting || running.length > 0,
    workflowDurationStats,
    holdCompleteWhileIdle: infiniteLoop,
  });

  // Get pinned widget's current value from workflow

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      document.documentElement.style.setProperty(
        "--bottom-bar-offset",
        `${rect.height}px`,
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!infiniteModeEnabled && infiniteLoop) {
      setInfiniteLoop(false);
    }
  }, [infiniteModeEnabled, infiniteLoop, setInfiniteLoop]);

  return (
    <div
      id="bottom-bar-root"
      ref={barRef}
      className={`fixed bottom-0 left-0 right-0 bg-slate-950/88 border-t border-white/10 shadow-lg safe-area-bottom z-[2200] transition-opacity duration-300 ${
        fadeWithViewer ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div
        id="bottom-bar-content"
        className="flex items-center gap-2 px-1.5 py-2 max-w-lg mx-auto"
      >
        {!infiniteLoop && !isStopping && <RunCountSelector />}

        <SkipButton />

        <RunButton />

        {infiniteModeEnabled && <InfiniteLoopToggle />}

        {isOutputsPanel && <OutputsActionButton />}

        {!isOutputsPanel && <PinnedWidgetButton />}

        <FollowQueueButton
          viewerOpen={viewerOpen}
          followQueue={followQueue}
          queueSize={queueSize}
          overallProgress={overallProgress}
          showIdleProgress={infiniteLoop}
          onToggleFollowQueue={onToggleFollowQueue}
          onOpenFollowQueue={onOpenFollowQueue}
        />
      </div>

      <PinnedWidgetOverlayModal />

      <BottomStatusOverlay />
    </div>
  );
}
