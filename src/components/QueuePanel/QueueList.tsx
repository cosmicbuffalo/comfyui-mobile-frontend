import type { HistoryOutputImage, Workflow } from '@/api/types';
import type { UnifiedItem, ViewerImage } from './types';
import { QueueCard } from './QueueCard';
import { InboxIcon } from '@/components/icons';
import { LoadingSpinner } from '@/components/LoadingSpinner';

interface QueueListProps {
  listRef: React.RefObject<HTMLDivElement | null>;
  unifiedList: UnifiedItem[];
  visibleCount: number;
  hasLoadedOnce: boolean;
  effectiveExecutingId: string | null;
  progress: number;
  overallProgress?: number | null;
  executingNodeLabel?: string | null;
  onDeleteItem: (item: UnifiedItem) => void;
  onStop: () => void;
  onImageClick?: (images: Array<ViewerImage>, index: number, enableFollowQueue?: boolean) => void;
  viewerImages: Array<ViewerImage>;
  promptOutputs: Record<string, HistoryOutputImage[]>;
  onOpenMenu: (payload: { top: number; right: number; imageSrc: string; workflow?: Workflow; promptId?: string; hasVideoOutputs?: boolean; hasImageOutputs?: boolean }) => void;
  downloaded: Record<string, boolean>;
  firstDoneItemId: string | null;
  onScroll: () => void;
}

export function QueueList({
  listRef,
  unifiedList,
  visibleCount,
  hasLoadedOnce,
  effectiveExecutingId,
  progress,
  overallProgress,
  executingNodeLabel,
  onDeleteItem,
  onStop,
  onImageClick,
  viewerImages,
  promptOutputs,
  onOpenMenu,
  downloaded,
  firstDoneItemId,
  onScroll
}: QueueListProps) {
  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain scroll-container"
      data-queue-list="true"
      onScroll={onScroll}
    >
      {unifiedList.length === 0 && !hasLoadedOnce && (
        <div className="flex items-center justify-center min-h-[calc(100vh-180px)] text-gray-400">
          <div className="text-center">
            <LoadingSpinner size="lg" color="gray" className="mx-auto mb-4" />
            <p className="text-lg">Loading...</p>
          </div>
        </div>
      )}
      {unifiedList.length === 0 && hasLoadedOnce && (
        <div className="flex items-center justify-center min-h-[calc(100vh-180px)] text-gray-500">
          <div className="text-center p-8">
            <div className="flex items-center justify-center mb-4">
              <InboxIcon className="w-10 h-10 text-gray-300" />
            </div>
            <p className="text-lg font-medium">Queue is empty</p>
            <p className="text-sm mt-2">
              Run a workflow to see items here
            </p>
          </div>
        </div>
      )}

      {unifiedList.slice(0, visibleCount).map((item) => (
        <QueueCard
          key={item.id}
          item={item}
          isActuallyRunning={item.id === effectiveExecutingId}
          progress={progress}
          overallProgress={overallProgress}
          executingNodeLabel={executingNodeLabel}
          onDelete={() => onDeleteItem(item)}
          onStop={onStop}
          onImageClick={onImageClick}
          viewerImages={viewerImages}
          runningImages={promptOutputs[item.id] ?? []}
          onOpenMenu={onOpenMenu}
          downloaded={downloaded}
          isTopDoneItem={item.id === firstDoneItemId}
        />
      ))}
      <div className="h-20" />
    </div>
  );
}
