import { createPortal } from 'react-dom';
import type { Workflow } from '@/api/types';
import type { UnifiedItem } from './types';
import { CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, TrashIcon, WorkflowIcon } from '@/components/icons';
import { useQueueStore } from '@/hooks/useQueue';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';

interface QueueImageMenuProps {
  menuState: {
    open: boolean;
    top: number;
    right: number;
    imageSrc: string;
    workflow?: Workflow;
    promptId?: string;
    hasVideoOutputs?: boolean;
    hasImageOutputs?: boolean;
  } | null;
  unifiedList: UnifiedItem[];
  onClose: () => void;
  onLoadWorkflow: (workflow: Workflow, promptId: string) => void;
  onCopyWorkflow: (workflow?: Workflow) => void;
  onDownload: (src: string) => Promise<void>;
  onBatchDownload: (sources: string[]) => Promise<void>;
  onDeleteHistory: (promptId: string) => void;
  getBatchSources: (promptId: string, list: UnifiedItem[]) => string[];
}

export function QueueImageMenu({
  menuState,
  unifiedList,
  onClose,
  onLoadWorkflow,
  onCopyWorkflow,
  onDownload,
  onBatchDownload,
  onDeleteHistory,
  getBatchSources
}: QueueImageMenuProps) {
  const promptId = menuState?.promptId ?? '';
  const queueItemHideImages = useQueueStore((s) => s.queueItemHideImages[promptId]);
  const toggleQueueItemHideImages = useQueueStore((s) => s.toggleQueueItemHideImages);

  const handleLoadWorkflowClick = () => {
    if (menuState?.workflow && menuState.promptId) {
      onLoadWorkflow(menuState.workflow, menuState.promptId);
    }
    onClose();
  };

  const handleCopyWorkflowClick = () => {
    onCopyWorkflow(menuState?.workflow);
    onClose();
  };

  const handleDownloadClick = async () => {
    const batchSources = menuState?.promptId
      ? getBatchSources(menuState.promptId, unifiedList)
      : [];
    if (batchSources.length > 1) {
      await onBatchDownload(batchSources);
    } else if (menuState) {
      await onDownload(menuState.imageSrc);
    }
    onClose();
  };

  const handleToggleHideImagesClick = () => {
    toggleQueueItemHideImages(promptId);
    onClose();
  };

  const handleDeleteClick = () => {
    if (menuState?.promptId) {
      onDeleteHistory(menuState.promptId);
    }
    onClose();
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
            key: 'load-workflow',
            label: 'Load workflow',
            icon: <WorkflowIcon className="w-4 h-4" />,
            onClick: handleLoadWorkflowClick,
            disabled: !menuState.workflow
          },
          {
            key: 'copy-workflow',
            label: 'Copy workflow',
            icon: <CopyIcon className="w-4 h-4" />,
            onClick: handleCopyWorkflowClick,
            disabled: !menuState.workflow
          },
          {
            key: 'download',
            label: menuState.promptId && getBatchSources(menuState.promptId, unifiedList).length > 1
              ? 'Download batch'
              : 'Download',
            icon: <DownloadIcon className="w-4 h-4" />,
            onClick: handleDownloadClick
          },
          {
            key: 'toggle-images',
            label: queueItemHideImages ? 'Show images' : 'Hide images',
            icon: queueItemHideImages
              ? <EyeIcon className="w-4 h-4" />
              : <EyeOffIcon className="w-4 h-4" />,
            onClick: handleToggleHideImagesClick,
            hidden: !(menuState.hasVideoOutputs && menuState.hasImageOutputs && menuState.promptId)
          },
          {
            key: 'delete',
            label: 'Delete',
            icon: <TrashIcon className="w-4 h-4" />,
            onClick: handleDeleteClick,
            color: 'danger'
          }
        ]}
      />
    </div>,
    document.body
  );
}
