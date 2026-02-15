interface RepositionOverlayActionsProps {
  onCancel: () => void;
  onDone: () => void;
}

export function RepositionOverlayActions({
  onCancel,
  onDone,
}: RepositionOverlayActionsProps) {
  return (
    <div
      className="fixed bottom-6 left-0 right-0 z-[2301] flex justify-center gap-4"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <button
        type="button"
        className="px-5 py-2.5 rounded-full bg-white border border-gray-300 text-sm font-medium text-gray-700 shadow-lg"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        className="px-5 py-2.5 rounded-full bg-blue-600 text-sm font-semibold text-white shadow-lg"
        onClick={onDone}
      >
        Done
      </button>
    </div>
  );
}
