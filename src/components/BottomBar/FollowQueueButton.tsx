import { useCallback, useMemo } from "react";
import { ProgressRing, QueueStackIcon } from "@/components/icons";
import { appChromeIconButtonClassName, chromeBarButtonClassName } from "@/components/chromeStyles";

interface FollowQueueButtonProps {
  viewerOpen: boolean;
  followQueue: boolean;
  queueSize: number;
  overallProgress: number | null;
  showIdleProgress?: boolean;
  onToggleFollowQueue?: () => void;
  onOpenFollowQueue?: () => void;
}

export function FollowQueueButton({
  viewerOpen,
  followQueue,
  queueSize,
  overallProgress,
  showIdleProgress = false,
  onToggleFollowQueue,
  onOpenFollowQueue,
}: FollowQueueButtonProps) {
  const handleClick = useCallback(() => {
    if (viewerOpen) {
      onToggleFollowQueue?.();
    } else {
      onOpenFollowQueue?.();
    }
  }, [viewerOpen, onToggleFollowQueue, onOpenFollowQueue]);

  const ariaLabel = useMemo(() => {
    if (!viewerOpen) return "Open image viewer";
    return followQueue ? "Disable follow queue" : "Enable follow queue";
  }, [viewerOpen, followQueue]);

  const buttonClassName = useMemo(() => {
    if (!viewerOpen) return appChromeIconButtonClassName;
    return followQueue
      ? "bg-emerald-500 border border-emerald-500 text-white"
      : appChromeIconButtonClassName;
  }, [viewerOpen, followQueue]);

  return (
    <button
      onClick={handleClick}
      className={`${chromeBarButtonClassName} ${buttonClassName}`}
      aria-label={ariaLabel}
    >
      <span className="absolute inset-0 flex items-center justify-center">
        <QueueStackIcon
          className="w-6 h-6"
          showSlash={viewerOpen && !followQueue}
        />
      </span>
      {(queueSize > 0 || (showIdleProgress && overallProgress !== null)) && (
        <div
          className="queue-badge absolute top-0 right-0 translate-x-[18px] -translate-y-[18px] w-6 h-6 rounded-full bg-slate-900/95 border border-white/10 text-slate-100 shadow-sm flex items-center justify-center font-bold text-xs relative z-20"
        >
          {overallProgress !== null && (
            <ProgressRing
              className="absolute z-10 pointer-events-none"
              width="24"
              height="24"
              style={{
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%) rotate(-90deg)",
              }}
              progress={overallProgress}
            />
          )}
          {queueSize}
        </div>
      )}
    </button>
  );
}
