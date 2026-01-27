import type { FileItem } from '@/api/client';

interface DeleteConfirmationModalProps {
  file: FileItem;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmationModal({
  file,
  onCancel,
  onConfirm
}: DeleteConfirmationModalProps) {
  return (
    <div
      id="viewer-delete-confirm-overlay"
      className="fixed inset-0 z-[2100] bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        id="viewer-delete-confirm-modal"
        className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-gray-900 text-base font-semibold">Delete file?</div>
        <div className="text-gray-600 text-sm mt-1">
          This will permanently delete "{file.name}" from the server. This cannot be undone.
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
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
