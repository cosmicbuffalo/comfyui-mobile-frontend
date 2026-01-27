import { useCallback, useMemo } from "react";
import { ProgressRing, QueueStackIcon } from "@/components/icons";

interface FollowQueueButtonProps {
  viewerOpen: boolean;
  followQueue: boolean;
  queueSize: number;
  overallProgress: number | null;
  onToggleFollowQueue?: () => void;
  onOpenFollowQueue?: () => void;
}

export function FollowQueueButton({
  viewerOpen,
  followQueue,
  queueSize,
  overallProgress,
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
    if (!viewerOpen) return "bg-gray-100 text-gray-700 hover:bg-gray-200";
    return followQueue
      ? "bg-green-500 text-white"
      : "bg-gray-100 text-gray-700 hover:bg-gray-200";
  }, [viewerOpen, followQueue]);

  return (
    <button
      onClick={handleClick}
      className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors ${buttonClassName}`}
      aria-label={ariaLabel}
    >
      <span className="absolute inset-0 flex items-center justify-center">
        <QueueStackIcon
          className="w-6 h-6"
          showSlash={viewerOpen && !followQueue}
        />
      </span>
      {queueSize > 0 && (
        <div
          className="queue-badge absolute top-0 right-0 translate-x-[18px] -translate-y-[18px] w-6 h-6 rounded-full bg-blue-500 text-white
                     flex items-center justify-center font-bold text-xs border-2 border-white relative z-20"
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
