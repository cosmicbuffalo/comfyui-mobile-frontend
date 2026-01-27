import { createPortal } from 'react-dom';
import type { Workflow } from '@/api/types';
import type { UnifiedItem } from './types';
import { CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, TrashIcon, WorkflowLoadIcon } from '@/components/icons';
import { useQueueStore } from '@/hooks/useQueue';

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
      className="fixed z-[1200] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden w-44"
      style={{ top: menuState.top, right: menuState.right }}
    >
      <button
        className={`flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
          !menuState.workflow ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={handleLoadWorkflowClick}
        disabled={!menuState.workflow}
      >
        <WorkflowLoadIcon className="w-4 h-4 text-gray-500" />
        Load workflow
      </button>
      <button
        className={`flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
          !menuState.workflow ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={handleCopyWorkflowClick}
        disabled={!menuState.workflow}
      >
        <CopyIcon className="w-4 h-4 text-gray-500" />
        Copy workflow
      </button>
      <button
        className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
        onClick={handleDownloadClick}
      >
        <DownloadIcon className="w-4 h-4 text-gray-500" />
        {menuState.promptId && getBatchSources(menuState.promptId, unifiedList).length > 1 ? 'Download batch' : 'Download'}
      </button>
      {menuState.hasVideoOutputs && menuState.hasImageOutputs && menuState.promptId && (
        <button
          className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
          onClick={handleToggleHideImagesClick}
        >
          {queueItemHideImages ? (
            <EyeIcon className="w-4 h-4 text-gray-500" />
          ) : (
            <EyeOffIcon className="w-4 h-4 text-gray-500" />
          )}
          {queueItemHideImages ? 'Show images' : 'Hide images'}
        </button>
      )}
      <button
        className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        onClick={handleDeleteClick}
      >
        <TrashIcon className="w-4 h-4" />
        Delete
      </button>
    </div>,
    document.body
  );
}
