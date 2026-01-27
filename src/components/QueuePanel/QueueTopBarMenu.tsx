import type { RefObject } from 'react';
import { useMemo } from 'react';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { CancelCircleIcon, CaretDownIcon, CaretRightIcon, EllipsisVerticalIcon, EyeIcon, EyeOffIcon, InfoIcon, MoveIcon, TrashIcon } from '@/components/icons';

interface QueueTopBarMenuProps {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onGoToWorkflow: () => void;
  onOpenClearHistoryConfirm: () => void;
}

export function QueueTopBarMenu({
  open,
  buttonRef,
  menuRef,
  onToggle,
  onClose,
  onGoToWorkflow,
  onOpenClearHistoryConfirm
}: QueueTopBarMenuProps) {
  const setQueueItemExpanded = useQueueStore((s) => s.setQueueItemExpanded);
  const queueItemExpanded = useQueueStore((s) => s.queueItemExpanded);
  const showQueueMetadata = useQueueStore((s) => s.showQueueMetadata);
  const toggleShowQueueMetadata = useQueueStore((s) => s.toggleShowQueueMetadata);
  const previewVisibility = useQueueStore((s) => s.previewVisibility);
  const setPreviewVisibility = useQueueStore((s) => s.setPreviewVisibility);
  const previewVisibilityDefault = useQueueStore((s) => s.previewVisibilityDefault);
  const setPreviewVisibilityDefault = useQueueStore((s) => s.setPreviewVisibilityDefault);
  const pending = useQueueStore((s) => s.pending);
  const running = useQueueStore((s) => s.running);
  const clearQueue = useQueueStore((s) => s.clearQueue);
  const history = useHistoryStore((s) => s.history);
  const clearEmptyItems = useHistoryStore((s) => s.clearEmptyItems);

  const hasPending = pending.length > 0;
  const hasHistory = history.length > 0;
  const hasEmptyHistory = history.some((item) => item.outputs.images.length === 0);
  const hasQueueItems = pending.length + running.length + history.length > 0;

  const allQueuePromptIds = useMemo(() => {
    const ids = new Set<string>();
    pending.forEach((item) => ids.add(item.prompt_id));
    running.forEach((item) => ids.add(item.prompt_id));
    history.forEach((item) => {
      if (item.prompt_id) ids.add(String(item.prompt_id));
    });
    return Array.from(ids);
  }, [pending, running, history]);

  const hasFoldedQueueItem = useMemo(() => (
    allQueuePromptIds.some((id) => queueItemExpanded[id] === false)
  ), [allQueuePromptIds, queueItemExpanded]);

  const hasUnfoldedQueueItem = useMemo(() => (
    allQueuePromptIds.some((id) => queueItemExpanded[id] !== false)
  ), [allQueuePromptIds, queueItemExpanded]);

  const previewPromptIds = useMemo(() => {
    const ids = new Set<string>();
    history.forEach((item) => {
      const images = item.outputs?.images ?? [];
      const hasPreviews = images.some((img) => img.type !== 'output');
      if (hasPreviews && item.prompt_id) {
        ids.add(String(item.prompt_id));
      }
    });
    return Array.from(ids);
  }, [history]);

  const hasPreviewToggle = hasQueueItems || previewPromptIds.length > 0 || previewVisibilityDefault;
  const previewsVisible = previewPromptIds.length > 0
    ? previewPromptIds.every((id) => previewVisibility[id] ?? previewVisibilityDefault)
    : previewVisibilityDefault;

  const handleGoToWorkflowClick = () => {
    onGoToWorkflow();
    onClose();
  };

  const handleCancelPendingClick = async () => {
    await clearQueue();
    onClose();
  };

  const handleFoldAllClick = () => {
    allQueuePromptIds.forEach((id) => setQueueItemExpanded(id, false));
    onClose();
  };

  const handleUnfoldAllClick = () => {
    allQueuePromptIds.forEach((id) => setQueueItemExpanded(id, true));
    onClose();
  };

  const handleToggleMetadataClick = () => {
    toggleShowQueueMetadata();
    onClose();
  };

  const handleTogglePreviewClick = () => {
    const nextVisible = !previewsVisible;
    setPreviewVisibilityDefault(nextVisible);
    previewPromptIds.forEach((id) => setPreviewVisibility(id, nextVisible));
    onClose();
  };

  const handleClearEmptyClick = async () => {
    await clearEmptyItems();
    onClose();
  };

  const handleClearHistoryClick = () => {
    onClose();
    onOpenClearHistoryConfirm();
  };

  return (
    <div id="queue-menu-container" className="relative">
      <button
        ref={buttonRef}
        onClick={onToggle}
        className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100"
        aria-label="Queue options"
      >
        <EllipsisVerticalIcon className="w-5 h-5 -rotate-90" />
      </button>
      {!open ? null : (
        <div
          id="queue-options-dropdown"
          ref={menuRef}
          className="absolute right-0 top-11 z-50 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
        >
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleGoToWorkflowClick}
          >
            <MoveIcon className="w-3 h-3 text-gray-500 rotate-180" />
            Go to workflow
          </button>
          {hasPending && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleCancelPendingClick}
            >
              <CancelCircleIcon className="w-4 h-4 text-gray-500" />
              Cancel all pending
            </button>
          )}
          {hasUnfoldedQueueItem && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleFoldAllClick}
            >
              <CaretRightIcon className="w-7 h-7 -ml-1 text-gray-500" />
              Fold all
            </button>
          )}
          {hasFoldedQueueItem && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleUnfoldAllClick}
            >
              <CaretDownIcon className="w-7 h-7 -ml-1 text-gray-500" />
              Unfold all
            </button>
          )}
          {hasHistory && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleToggleMetadataClick}
            >
              <InfoIcon className="w-4 h-4 text-gray-500" />
              {showQueueMetadata ? 'Hide metadata' : 'Show metadata'}
            </button>
          )}
          {hasPreviewToggle && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleTogglePreviewClick}
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
              onClick={handleClearEmptyClick}
            >
              <TrashIcon className="w-4 h-4" />
              Clear empty items
            </button>
          )}
          {hasHistory && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-600"
              onClick={handleClearHistoryClick}
            >
              <TrashIcon className="w-4 h-4" />
              Clear history
            </button>
          )}
        </div>
      )}
    </div>
  );
}
