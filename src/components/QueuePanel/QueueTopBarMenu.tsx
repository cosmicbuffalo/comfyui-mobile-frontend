import type { RefObject } from 'react';
import { useMemo } from 'react';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { CancelCircleIcon, CaretDownIcon, CaretRightIcon, EyeIcon, EyeOffIcon, InfoIcon, ArrowRightIcon, TrashIcon } from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';

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
      <ContextMenuButton
        buttonRef={buttonRef}
        onClick={onToggle}
        ariaLabel="Queue options"
      />
      {!open ? null : (
        <div
          id="queue-options-dropdown"
          ref={menuRef}
          className="absolute right-0 top-11 z-50 w-48"
        >
          <ContextMenuBuilder
            items={[
              {
                key: 'go-to-workflow',
                label: 'Go to workflow',
                icon: <ArrowRightIcon className="w-3 h-3 rotate-180" />,
                onClick: handleGoToWorkflowClick
              },
              {
                key: 'cancel-pending',
                label: 'Cancel all pending',
                icon: <CancelCircleIcon className="w-4 h-4" />,
                onClick: handleCancelPendingClick,
                hidden: !hasPending
              },
              {
                key: 'fold-all',
                label: 'Fold all',
                icon: <CaretRightIcon className="w-7 h-7 -ml-1" />,
                onClick: handleFoldAllClick,
                hidden: !hasUnfoldedQueueItem
              },
              {
                key: 'unfold-all',
                label: 'Unfold all',
                icon: <CaretDownIcon className="w-7 h-7 -ml-1" />,
                onClick: handleUnfoldAllClick,
                hidden: !hasFoldedQueueItem
              },
              {
                key: 'toggle-metadata',
                label: showQueueMetadata ? 'Hide metadata' : 'Show metadata',
                icon: <InfoIcon className="w-4 h-4" />,
                onClick: handleToggleMetadataClick,
                hidden: !hasHistory
              },
              {
                key: 'toggle-previews',
                label: previewsVisible ? 'Hide previews' : 'Show previews',
                icon: previewsVisible
                  ? <EyeOffIcon className="w-4 h-4" />
                  : <EyeIcon className="w-4 h-4" />,
                onClick: handleTogglePreviewClick,
                hidden: !hasPreviewToggle
              },
              {
                key: 'clear-empty',
                label: 'Clear empty items',
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleClearEmptyClick,
                color: 'muted',
                hidden: !hasEmptyHistory
              },
              {
                key: 'clear-history',
                label: 'Clear history',
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleClearHistoryClick,
                color: 'danger',
                hidden: !hasHistory
              }
            ]}
          />
        </div>
      )}
    </div>
  );
}
