import type { RefObject } from 'react';
import { useMemo } from 'react';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { QUEUE_REJECT_SOURCES, rejectedIdsForSources } from '@/utils/deleteRejectedOutputs';
import { useOutputsStore } from '@/hooks/useOutputs';
import { CancelCircleIcon, CaretDownIcon, CaretRightIcon, ClockIcon, DocumentLinesIcon, EyeIcon, EyeOffIcon, InfoIcon, ArrowRightIcon, QueueStackIcon, TrashIcon } from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { appChromeIconButtonBareClassName } from '@/components/chromeStyles';
import { useT } from '@/i18n';

interface QueueTopBarMenuProps {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onGoToWorkflow: () => void;
  onOpenClearHistoryConfirm: () => void;
  onOpenCancelPendingConfirm: () => void;
  onOpenDeleteRejectedConfirm: () => void;
}

export function QueueTopBarMenu({
  open,
  buttonRef,
  menuRef,
  onToggle,
  onClose,
  onGoToWorkflow,
  onOpenClearHistoryConfirm,
  onOpenCancelPendingConfirm,
  onOpenDeleteRejectedConfirm
}: QueueTopBarMenuProps) {
  const t = useT();
  // Scoped to what the QUEUE shows — generated output/temp media. An input the
  // user rejected while browsing uploads is not this menu's to delete.
  const rejectedCount = useOutputsStore(
    (s) => rejectedIdsForSources(s.rejected, QUEUE_REJECT_SOURCES).length,
  );
  const setQueueItemExpanded = useQueueStore((s) => s.setQueueItemExpanded);
  const setQueueItemUserToggled = useQueueStore((s) => s.setQueueItemUserToggled);
  const queueItemExpanded = useQueueStore((s) => s.queueItemExpanded);
  const showQueueMetadata = useQueueStore((s) => s.showQueueMetadata);
  const toggleShowQueueMetadata = useQueueStore((s) => s.toggleShowQueueMetadata);
  const showQueueTimestamps = useQueueStore((s) => s.showQueueTimestamps);
  const toggleShowQueueTimestamps = useQueueStore((s) => s.toggleShowQueueTimestamps);
  const showPromptPreview = useQueueStore((s) => s.showPromptPreview);
  const toggleShowPromptPreview = useQueueStore((s) => s.toggleShowPromptPreview);
  const queueOutputLayout = useQueueStore((s) => s.queueOutputLayout);
  const toggleQueueOutputLayout = useQueueStore((s) => s.toggleQueueOutputLayout);
  const previewVisibility = useQueueStore((s) => s.previewVisibility);
  const setPreviewVisibility = useQueueStore((s) => s.setPreviewVisibility);
  const previewVisibilityDefault = useQueueStore((s) => s.previewVisibilityDefault);
  const setPreviewVisibilityDefault = useQueueStore((s) => s.setPreviewVisibilityDefault);
  const pending = useQueueStore((s) => s.pending);
  const running = useQueueStore((s) => s.running);
  const completing = useQueueStore((s) => s.completing);
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
    // Items in the running→done hand-off window live only in `completing`
    // (removeRunning already dropped them); QueuePanel renders them as running
    // cards, so fold/unfold must reach them too.
    completing.forEach((item) => ids.add(item.prompt_id));
    history.forEach((item) => {
      if (item.prompt_id) ids.add(String(item.prompt_id));
    });
    return Array.from(ids);
  }, [pending, running, completing, history]);

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
    allQueuePromptIds.forEach((id) => {
      // Record the global fold as explicit user intent on every card so no
      // auto-open path (prompt preview, live media, completion) re-expands it.
      // Deriving exactly which cards are "active" here is a trap: cards render
      // as running via the `completing` hand-off and the executing-prompt
      // override too, and any missed set pops back open. Marking done cards is
      // harmless — they have no auto-open path — and the maps are pruned of
      // departed ids by the queue panel.
      setQueueItemUserToggled(id, true);
      setQueueItemExpanded(id, false);
    });
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

  const handleToggleOutputLayoutClick = () => {
    toggleQueueOutputLayout();
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

  const handleDeleteRejectedClick = () => {
    onClose();
    onOpenDeleteRejectedConfirm();
  };

  return (
    <div id="queue-menu-container" className="relative">
      <ContextMenuButton
        buttonRef={buttonRef}
        onClick={onToggle}
        ariaLabel={t('Queue options')}
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
                label: t('Workflow Panel'),
                icon: <ArrowRightIcon className="w-4 h-4 rotate-180" />,
                onClick: handleGoToWorkflowClick
              },
              {
                key: 'cancel-pending',
                label: t('Cancel All Pending'),
                icon: <CancelCircleIcon className="w-4 h-4" />,
                onClick: handleCancelPendingClick,
                hidden: !hasPending
              },
              {
                key: 'fold-all',
                label: t('Fold All'),
                icon: <CaretRightIcon className="w-5 h-5" />,
                onClick: handleFoldAllClick,
                hidden: !hasUnfoldedQueueItem
              },
              {
                key: 'unfold-all',
                label: t('Unfold All'),
                icon: <CaretDownIcon className="w-5 h-5" />,
                onClick: handleUnfoldAllClick,
                hidden: !hasFoldedQueueItem
              },
              {
                key: 'toggle-prompt-preview',
                label: showPromptPreview ? t('Hide Prompt Preview') : t('Show Prompt Preview'),
                icon: <DocumentLinesIcon className="w-5 h-5" />,
                onClick: handleTogglePromptPreviewClick
              },
              {
                key: 'toggle-output-layout',
                label: queueOutputLayout === 'tabbed' ? t('Stack Outputs') : t('Tab Outputs'),
                icon: <QueueStackIcon className="w-4 h-4" />,
                onClick: handleToggleOutputLayoutClick,
                hidden: !hasHistory
              },
              {
                key: 'toggle-metadata',
                label: showQueueMetadata ? t('Hide Metadata') : t('Show Metadata'),
                icon: <InfoIcon className="w-4 h-4" />,
                onClick: handleToggleMetadataClick,
                hidden: !hasHistory
              },
              {
                key: 'toggle-timestamps',
                label: showQueueTimestamps ? t('Hide Timestamps') : t('Show Timestamps'),
                icon: <ClockIcon className="w-4 h-4" />,
                onClick: handleToggleTimestampsClick
              },
              {
                key: 'toggle-previews',
                label: previewsVisible ? t('Hide Previews') : t('Show Previews'),
                icon: previewsVisible
                  ? <EyeOffIcon className="w-4 h-4" />
                  : <EyeIcon className="w-4 h-4" />,
                onClick: handleTogglePreviewClick,
                hidden: !hasPreviewToggle
              },
              {
                key: 'delete-rejected',
                label: t('Delete Rejected ({count})', { count: rejectedCount }),
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleDeleteRejectedClick,
                color: 'danger',
                hidden: rejectedCount === 0
              },
              {
                key: 'clear-empty',
                label: t('Clear Empty Items'),
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleClearEmptyClick,
                color: 'muted',
                hidden: !hasEmptyHistory
              },
              {
                key: 'clear-history',
                label: t('Clear History'),
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
