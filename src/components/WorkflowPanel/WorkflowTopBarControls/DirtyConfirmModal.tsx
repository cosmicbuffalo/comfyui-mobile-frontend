type DirtyConfirmAction = 'unload' | 'clearWorkflowCache' | 'clearAllCache';

interface DirtyConfirmModalProps {
  action: DirtyConfirmAction | null;
  onCancel: () => void;
  onContinue: (action: DirtyConfirmAction) => void;
}

export function DirtyConfirmModal({ action, onCancel, onContinue }: DirtyConfirmModalProps) {
  if (!action) return null;

  return (
    <div
      id="dirty-confirm-overlay"
      className="fixed inset-0 z-[1500] bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        id="dirty-confirm-modal"
        className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div id="dirty-confirm-title" className="text-gray-900 text-base font-semibold">Unsaved changes</div>
        <div id="dirty-confirm-description" className="text-gray-600 text-sm mt-1">
          You have unsaved changes in the current workflow. Continue without saving?
        </div>
        <div id="dirty-confirm-actions" className="mt-4 flex justify-end gap-2">
          <button
            className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700"
            onClick={() => onContinue(action)}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
