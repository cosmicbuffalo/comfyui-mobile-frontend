import { createPortal } from 'react-dom';
import type { Workflow } from '@/api/types';

interface HistoryImageMenuProps {
  menuState: {
    open: boolean;
    top: number;
    right: number;
    imageSrc: string;
    workflow?: Workflow;
    promptId?: string;
  } | null;
  onClose: () => void;
  onLoadWorkflow: (workflow: Workflow, promptId?: string) => void;
  onDownload: (src: string) => void;
  onDelete: (promptId: string) => void;
}

export function HistoryImageMenu({
  menuState,
  onClose,
  onLoadWorkflow,
  onDownload,
  onDelete
}: HistoryImageMenuProps) {
  if (!menuState?.open) return null;

  return createPortal(
    <div
      id="history-image-menu"
      className="fixed z-[1200] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
      style={{ top: menuState.top, right: menuState.right }}
    >
      <button
        className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
          !menuState.workflow ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={() => {
          if (menuState.workflow) {
            onLoadWorkflow(menuState.workflow, menuState.promptId);
          }
          onClose();
        }}
        disabled={!menuState.workflow}
      >
        Load workflow
      </button>
      <button
        className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
        onClick={() => {
          onDownload(menuState.imageSrc);
          onClose();
        }}
      >
        Download
      </button>
      <button
        className="block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        onClick={() => {
          if (menuState.promptId) {
            onDelete(menuState.promptId);
          }
          onClose();
        }}
      >
        Delete
      </button>
    </div>,
    document.body
  );
}
