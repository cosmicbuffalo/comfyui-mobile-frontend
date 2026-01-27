import { CheckIcon } from '@/components/icons';
import { useOutputsStore } from '@/hooks/useOutputs';

export function SelectionActionButton() {
  const selectedCount = useOutputsStore((s) => s.selectedIds.length);
  const setSelectionActionOpen = useOutputsStore((s) => s.setSelectionActionOpen);
  const disabled = selectedCount === 0;
  return (
    <button
      onClick={() => setSelectionActionOpen(true)}
      disabled={disabled}
      className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors ${
        disabled
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
      aria-label="Selection actions"
    >
      <div
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm ${
          disabled
            ? 'border-gray-300 bg-transparent'
            : 'bg-blue-600 border-blue-600 text-white'
        }`}
      >
        {!disabled && <CheckIcon className="w-4 h-4" />}
      </div>
    </button>
  );
}
