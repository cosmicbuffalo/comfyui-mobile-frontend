import { CheckIcon } from '@/components/icons';
import { useOutputsStore } from '@/hooks/useOutputs';
import { appChromeIconButtonClassName, chromeBarButtonClassName } from '@/components/chromeStyles';

export function SelectionActionButton() {
  const selectedCount = useOutputsStore((s) => s.selectedIds.length);
  const setSelectionActionOpen = useOutputsStore((s) => s.setSelectionActionOpen);
  const toggleSelectionMode = useOutputsStore((s) => s.toggleSelectionMode);
  const hasSelection = selectedCount > 0;

  const handleClick = () => {
    if (!hasSelection) {
      toggleSelectionMode();
      return;
    }
    setSelectionActionOpen(true);
  };

  return (
    <button
      onClick={handleClick}
      className={`${chromeBarButtonClassName} ${appChromeIconButtonClassName}`}
      aria-label={hasSelection ? 'Selection actions' : 'Cancel selection mode'}
    >
      <div
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm ${
          hasSelection
            ? 'bg-cyan-500 border-cyan-500 text-slate-950'
            : 'border-slate-500 bg-transparent'
        }`}
      >
        {hasSelection && <CheckIcon className="w-4 h-4" />}
      </div>
    </button>
  );
}
