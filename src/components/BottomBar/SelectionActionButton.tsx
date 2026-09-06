import { CheckIcon } from '@/components/icons';
import { useOutputsStore } from '@/hooks/useOutputs';
import { appChromeIconButtonClassName, chromeBarButtonClassName } from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

export function SelectionActionButton() {
  const { t } = useI18n();
  const selectedCount = useOutputsStore((s) => s.selectedIds.length);
  const selectionMode = useOutputsStore((s) => s.selectionMode);
  const setSelectionActionOpen = useOutputsStore((s) => s.setSelectionActionOpen);
  const toggleSelectionMode = useOutputsStore((s) => s.toggleSelectionMode);
  const enterSelectionModeWith = useOutputsStore((s) => s.enterSelectionModeWith);
  const outputsViewerFileId = useOutputsStore((s) => s.outputsViewerFileId);
  const hasSelection = selectedCount > 0;

  const handleClick = () => {
    // Reached from inside the viewer with select mode off: turn it on and take
    // the image on screen as the first selection, so the tap that entered the
    // mode is not wasted.
    if (!selectionMode) {
      enterSelectionModeWith(outputsViewerFileId ? [outputsViewerFileId] : []);
      return;
    }
    if (!hasSelection) {
      toggleSelectionMode();
      return;
    }
    setSelectionActionOpen(true);
  };

  const label = !selectionMode
    ? t('Select images')
    : hasSelection ? t('Selection actions') : t('Cancel selection mode');

  return (
    <button
      onClick={handleClick}
      className={`${chromeBarButtonClassName} ${appChromeIconButtonClassName}${
        selectionMode ? ' selection-mode-active' : ''
      }`}
      aria-label={label}
      aria-pressed={selectionMode}
    >
      {/* The ring carries the mode instead of the button chrome: cyan once
          select mode is on, grey while it is off. With a selection it fills in,
          so the three states read as off / on / on-with-items. */}
      <div
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm ${
          hasSelection
            ? 'bg-cyan-500 border-cyan-500 text-slate-950'
            : selectionMode
              ? 'border-cyan-400 bg-transparent'
              : 'border-slate-500 bg-transparent'
        }`}
      >
        {hasSelection && <CheckIcon className="w-4 h-4" />}
      </div>
    </button>
  );
}
