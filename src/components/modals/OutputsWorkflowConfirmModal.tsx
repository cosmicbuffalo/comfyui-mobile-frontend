import type { FileItem } from '@/api/client';

interface OutputsWorkflowConfirmModalProps {
  file: FileItem | null;
  onCancel: () => void;
  onConfirm: (file: FileItem) => void;
}

export function OutputsWorkflowConfirmModal({ file, onCancel, onConfirm }: OutputsWorkflowConfirmModalProps) {
  if (!file) return null;

  return (
    <div
      id="outputs-load-workflow-confirm-overlay"
      className="fixed inset-0 z-[2100] bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        id="outputs-load-workflow-confirm-modal"
        className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-gray-900 text-base font-semibold">Unsaved changes</div>
        <div className="text-gray-600 text-sm mt-1">
          Are you sure you want to load this workflow? You have unsaved changes.
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700"
            onClick={() => onConfirm(file)}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
