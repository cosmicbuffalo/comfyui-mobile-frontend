import { useEffect, useRef } from "react";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useOverallProgress } from "@/hooks/useOverallProgress";
import { useQueueStore } from "@/hooks/useQueue";
import { BottomStatusOverlay } from "./BottomBar/BottomStatusOverlay";
import { FollowQueueButton } from "./BottomBar/FollowQueueButton";
import { PinnedWidgetOverlayModal } from "./BottomBar/PinnedWidgetOverlayModal";
import { OutputsActionButton } from "./BottomBar/OutputsActionButton";
import { PinnedWidgetButton } from "./BottomBar/PinnedWidgetButton";
import { RunButton } from "./BottomBar/RunButton";
import { RunCountSelector } from "./BottomBar/RunCountSelector";

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
  const workflow = useWorkflowStore((s) => s.workflow);
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

  return (
    <div
      id="bottom-bar-root"
      ref={barRef}
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg safe-area-bottom z-[2200]"
    >
      <div
        id="bottom-bar-content"
        className="flex items-center gap-3 px-3 py-2 max-w-lg mx-auto"
      >
        <RunCountSelector />

        <RunButton />

        {isOutputsPanel && <OutputsActionButton />}

        {!isOutputsPanel && <PinnedWidgetButton />}

        <FollowQueueButton
          viewerOpen={viewerOpen}
          followQueue={followQueue}
          queueSize={queueSize}
          overallProgress={overallProgress}
          onToggleFollowQueue={onToggleFollowQueue}
          onOpenFollowQueue={onOpenFollowQueue}
        />
      </div>

      <PinnedWidgetOverlayModal />

      <BottomStatusOverlay />
    </div>
  );
}
