import type { RefObject } from 'react';
import { useMemo } from 'react';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { CancelCircleIcon, CaretDownIcon, CaretRightIcon, ClockIcon, DocumentLinesIcon, EyeIcon, EyeOffIcon, InfoIcon, ArrowRightIcon, TrashIcon } from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { appChromeIconButtonBareClassName } from '@/components/chromeStyles';

interface QueueTopBarMenuProps {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onGoToWorkflow: () => void;
  onOpenClearHistoryConfirm: () => void;
  onOpenCancelPendingConfirm: () => void;
}

export function QueueTopBarMenu({
  open,
  buttonRef,
  menuRef,
  onToggle,
  onClose,
  onGoToWorkflow,
  onOpenClearHistoryConfirm,
  onOpenCancelPendingConfirm
}: QueueTopBarMenuProps) {
  const setQueueItemExpanded = useQueueStore((s) => s.setQueueItemExpanded);
  const queueItemExpanded = useQueueStore((s) => s.queueItemExpanded);
  const showQueueMetadata = useQueueStore((s) => s.showQueueMetadata);
  const toggleShowQueueMetadata = useQueueStore((s) => s.toggleShowQueueMetadata);
  const showQueueTimestamps = useQueueStore((s) => s.showQueueTimestamps);
  const toggleShowQueueTimestamps = useQueueStore((s) => s.toggleShowQueueTimestamps);
  const showPromptPreview = useQueueStore((s) => s.showPromptPreview);
  const toggleShowPromptPreview = useQueueStore((s) => s.toggleShowPromptPreview);
  const previewVisibility = useQueueStore((s) => s.previewVisibility);
  const setPreviewVisibility = useQueueStore((s) => s.setPreviewVisibility);
  const previewVisibilityDefault = useQueueStore((s) => s.previewVisibilityDefault);
  const setPreviewVisibilityDefault = useQueueStore((s) => s.setPreviewVisibilityDefault);
  const pending = useQueueStore((s) => s.pending);
  const running = useQueueStore((s) => s.running);
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

  // Cancelling a queue of pending generations is at least as destructive as
  // clearing history — both confirm.
  const handleCancelPendingClick = () => {
    onClose();
    onOpenCancelPendingConfirm();
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

  const handleToggleTimestampsClick = () => {
    toggleShowQueueTimestamps();
    onClose();
  };

  const handleTogglePromptPreviewClick = () => {
    toggleShowPromptPreview();
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
        className={`transition-colors ${appChromeIconButtonBareClassName}`}
      />
      {!open ? null : (
        <div
          id="queue-options-dropdown"
          ref={menuRef}
          className="absolute right-0 top-11 z-50 w-56"
        >
          <ContextMenuBuilder
            items={[
              {
                key: 'go-to-workflow',
                label: 'Workflow Panel',
                icon: <ArrowRightIcon className="w-4 h-4 rotate-180" />,
                onClick: handleGoToWorkflowClick
              },
              {
                key: 'cancel-pending',
                label: 'Cancel All Pending',
                icon: <CancelCircleIcon className="w-4 h-4" />,
                onClick: handleCancelPendingClick,
                hidden: !hasPending
              },
              {
                key: 'fold-all',
                label: 'Fold All',
                icon: <CaretRightIcon className="w-5 h-5" />,
                onClick: handleFoldAllClick,
                hidden: !hasUnfoldedQueueItem
              },
              {
                key: 'unfold-all',
                label: 'Unfold All',
                icon: <CaretDownIcon className="w-5 h-5" />,
                onClick: handleUnfoldAllClick,
                hidden: !hasFoldedQueueItem
              },
              {
                key: 'toggle-prompt-preview',
                label: showPromptPreview ? 'Hide Prompt Preview' : 'Show Prompt Preview',
                icon: <DocumentLinesIcon className="w-5 h-5" />,
                onClick: handleTogglePromptPreviewClick
              },
              {
                key: 'toggle-metadata',
                label: showQueueMetadata ? 'Hide Metadata' : 'Show Metadata',
                icon: <InfoIcon className="w-4 h-4" />,
                onClick: handleToggleMetadataClick,
                hidden: !hasHistory
              },
              {
                key: 'toggle-timestamps',
                label: showQueueTimestamps ? 'Hide Timestamps' : 'Show Timestamps',
                icon: <ClockIcon className="w-4 h-4" />,
                onClick: handleToggleTimestampsClick
              },
              {
                key: 'toggle-previews',
                label: previewsVisible ? 'Hide Previews' : 'Show Previews',
                icon: previewsVisible
                  ? <EyeOffIcon className="w-4 h-4" />
                  : <EyeIcon className="w-4 h-4" />,
                onClick: handleTogglePreviewClick,
                hidden: !hasPreviewToggle
              },
              {
                key: 'clear-empty',
                label: 'Clear Empty Items',
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleClearEmptyClick,
                color: 'muted',
                hidden: !hasEmptyHistory
              },
              {
                key: 'clear-history',
                label: 'Clear History',
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
