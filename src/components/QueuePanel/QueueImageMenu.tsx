import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Workflow } from '@/api/types';
import type { ItemStatus, UnifiedItem } from './types';
import { ArrowRightIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, ProgressRingWithTrack, ReloadIcon, TrashIcon, WorkflowIcon, XMarkIcon } from '@/components/icons';
import { useQueueStore } from '@/hooks/useQueue';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface QueueImageMenuProps {
  menuState: {
    open: boolean;
    top: number;
    right: number;
    imageSrc: string;
    imageSources?: string[];
    status?: ItemStatus;
    workflow?: Workflow;
    openWorkflowSessionId?: string;
    workflowLabel?: string;
    promptId?: string;
    hasVideoOutputs?: boolean;
    hasImageOutputs?: boolean;
    canReenqueue?: boolean;
  } | null;
  unifiedList: UnifiedItem[];
  onClose: () => void;
  onLoadWorkflow: (workflow: Workflow, promptId: string) => void;
  onShowWorkflowPanel: () => void;
  onGoToOpenWorkflow: (sessionId: string) => void;
  onCopyWorkflow: (workflow?: Workflow) => void;
  onDownload: (src: string) => Promise<void>;
  onBatchDownload: (sources: string[]) => Promise<void>;
  onRemoveItem: (promptId: string, status: ItemStatus) => void;
  onReenqueue: (promptId: string) => Promise<void>;
  getBatchSources: (promptId: string, list: UnifiedItem[]) => string[];
}

export function QueueImageMenu({
  menuState,
  unifiedList,
  onClose,
  onLoadWorkflow,
  onShowWorkflowPanel,
  onGoToOpenWorkflow,
  onCopyWorkflow,
  onDownload,
  onBatchDownload,
  onRemoveItem,
  onReenqueue,
  getBatchSources
}: QueueImageMenuProps) {
  const promptId = menuState?.promptId ?? '';
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [loadWorkflowProgress, setLoadWorkflowProgress] = useState(0);
  const queueItemHideImages = useQueueStore((s) => s.queueItemHideImages[promptId]);
  const toggleQueueItemHideImages = useQueueStore((s) => s.toggleQueueItemHideImages);
  const status = menuState?.status ?? 'done';
  const explicitImageSources = menuState?.imageSources ?? [];
  const batchSources = explicitImageSources.length > 0
    ? explicitImageSources
    : menuState?.promptId
      ? getBatchSources(menuState.promptId, unifiedList)
      : [];
  const canDownload = batchSources.length > 0 || Boolean(menuState?.imageSrc);
  const removeLabel = status === 'running'
    ? 'Stop'
    : status === 'pending'
      ? 'Cancel'
      : 'Delete';

  const handleLoadWorkflowClick = async () => {
    if (!menuState?.workflow || !menuState.promptId || loadingWorkflow) return;
    setLoadingWorkflow(true);
    setLoadWorkflowProgress(12);
    try {
      await waitForPaint();
      setLoadWorkflowProgress(55);
      await waitForPaint();
      onLoadWorkflow(menuState.workflow, menuState.promptId);
      setLoadWorkflowProgress(100);
      await waitForPaint();
      await sleep(90);
      onClose();
      onShowWorkflowPanel();
    } finally {
      // Always reset so a failure mid-load can't strand the menu disabled.
      setLoadingWorkflow(false);
      setLoadWorkflowProgress(0);
    }
  };

  const handleGoToOpenWorkflowClick = () => {
    if (loadingWorkflow || !menuState?.openWorkflowSessionId) return;
    onGoToOpenWorkflow(menuState.openWorkflowSessionId);
    onClose();
  };

  const handleCopyWorkflowClick = () => {
    if (loadingWorkflow) return;
    onCopyWorkflow(menuState?.workflow);
    onClose();
  };

  const handleDownloadClick = async () => {
    if (loadingWorkflow) return;
    if (batchSources.length > 1) {
      await onBatchDownload(batchSources);
    } else if (menuState) {
      await onDownload(batchSources[0] ?? menuState.imageSrc);
    }
    onClose();
  };

  const handleToggleHideImagesClick = () => {
    if (loadingWorkflow) return;
    toggleQueueItemHideImages(promptId);
    onClose();
  };

  const handleDeleteClick = () => {
    if (loadingWorkflow) return;
    if (menuState?.promptId) {
      onRemoveItem(menuState.promptId, status);
    }
    onClose();
  };

  const handleReenqueueClick = async () => {
    if (loadingWorkflow || !menuState?.promptId) return;
    onClose();
    await onReenqueue(menuState.promptId);
  };

  if (!menuState?.open) return null;

  return createPortal(
    <div
      id="queue-image-menu"
      className="fixed z-[1200] w-44"
      style={{ top: menuState.top, right: menuState.right }}
    >
      <ContextMenuBuilder
        items={[
          {
            key: 'go-to-open-workflow',
            label: 'Go to open workflow',
            icon: <ArrowRightIcon className="w-4 h-4 rotate-180" />,
            onClick: handleGoToOpenWorkflowClick,
            disabled: loadingWorkflow,
            hidden: !menuState.openWorkflowSessionId
          },
          {
            key: 'load-workflow',
            label: 'Load workflow',
            icon: <WorkflowIcon className="w-4 h-4" />,
            onClick: handleLoadWorkflowClick,
            disabled: !menuState.workflow,
            rightSlot: loadingWorkflow ? (
              <ProgressRingWithTrack
                progress={loadWorkflowProgress}
                className="w-5 h-5 -rotate-90"
              />
            ) : null
          },
          {
            key: 'copy-workflow',
            label: 'Copy workflow',
            icon: <CopyIcon className="w-4 h-4" />,
            onClick: handleCopyWorkflowClick,
            disabled: !menuState.workflow || loadingWorkflow
          },
          {
            key: 'download',
            label: batchSources.length > 1
              ? 'Download batch'
              : 'Download',
            icon: <DownloadIcon className="w-4 h-4" />,
            onClick: handleDownloadClick,
            disabled: loadingWorkflow,
            hidden: !canDownload
          },
          {
            key: 'toggle-images',
            label: queueItemHideImages ? 'Show images' : 'Hide images',
            icon: queueItemHideImages
              ? <EyeIcon className="w-4 h-4" />
              : <EyeOffIcon className="w-4 h-4" />,
            onClick: handleToggleHideImagesClick,
            disabled: loadingWorkflow,
            hidden: !(menuState.hasVideoOutputs && menuState.hasImageOutputs && menuState.promptId)
          },
          {
            key: 're-enqueue',
            label: 'Re-enqueue',
            icon: <ReloadIcon className="w-4 h-4" />,
            onClick: handleReenqueueClick,
            disabled: loadingWorkflow,
            hidden: !menuState.canReenqueue || !menuState.promptId
          },
          {
            key: 'delete',
            label: removeLabel,
            icon: status === 'done'
              ? <TrashIcon className="w-4 h-4" />
              : <XMarkIcon className="w-4 h-4" />,
            onClick: handleDeleteClick,
            disabled: loadingWorkflow,
            color: 'danger'
          }
        ]}
      />
    </div>,
    document.body
  );
}
