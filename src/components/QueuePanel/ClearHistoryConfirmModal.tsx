interface ClearHistoryConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ClearHistoryConfirmModal({ open, onClose, onConfirm }: ClearHistoryConfirmModalProps) {
  if (!open) return null;

  const handleConfirmClick = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <div
      id="clear-history-confirm-overlay"
      className="fixed inset-0 z-[1500] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        id="clear-history-confirm-modal"
        className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div id="clear-history-title" className="text-gray-900 text-base font-semibold">Clear history?</div>
        <div id="clear-history-description" className="text-gray-600 text-sm mt-1">
          This will permanently remove all completed generations from history. Generated files will still be present in your server's output folder.
        </div>
        <div id="clear-history-actions" className="mt-4 flex justify-end gap-2">
          <button
            className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700"
            onClick={handleConfirmClick}
          >
            Clear history
          </button>
        </div>
      </div>
    </div>
  );
}
