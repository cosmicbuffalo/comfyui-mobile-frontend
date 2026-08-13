import { CheckIcon, CopyIcon, NoEntryIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { ModalFrame } from '@/components/modals/ModalFrame';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { appChromeIconButtonClassName, chromeBarButtonClassName } from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

/**
 * Bottom-bar control shown in place of the queue button while workflow select
 * mode is active. Mirrors the outputs panel's SelectionActionButton: an empty
 * ring when nothing is selected (tap to leave select mode), a filled cyan disc
 * with the selected count once items are chosen (tap to open the bulk-ops menu).
 */
export function WorkflowSelectionButton() {
  const { t } = useI18n();
  const selectedKeys = useWorkflowSelectionStore((s) => s.selectedKeys);
  const actionMenuOpen = useWorkflowSelectionStore((s) => s.actionMenuOpen);
  const setActionMenuOpen = useWorkflowSelectionStore((s) => s.setActionMenuOpen);
  const exitSelectionMode = useWorkflowSelectionStore((s) => s.exitSelectionMode);

  const copySelectedItems = useWorkflowStore((s) => s.copySelectedItems);
  const createGroupFromItems = useWorkflowStore((s) => s.createGroupFromItems);
  const deleteSelectedItems = useWorkflowStore((s) => s.deleteSelectedItems);

  const count = selectedKeys.length;
  const hasSelection = count > 0;

  const handleButtonClick = () => {
    if (!hasSelection) {
      exitSelectionMode();
      return;
    }
    setActionMenuOpen(true);
  };

  const runAndExit = (op: (keys: string[]) => void) => {
    op(selectedKeys);
    exitSelectionMode();
  };

  return (
    <>
      <button
        onClick={handleButtonClick}
        className={`${chromeBarButtonClassName} ${appChromeIconButtonClassName}`}
        aria-label={hasSelection ? t('Selection actions') : t('Exit select mode')}
      >
        <div
          className={`flex h-6 min-w-6 items-center justify-center rounded-full border-2 px-1 shadow-sm ${
            hasSelection
              ? 'bg-cyan-500 border-cyan-500 text-slate-950'
              : 'border-slate-500 bg-transparent text-slate-400'
          }`}
        >
          {hasSelection ? (
            <span className="text-xs font-bold tabular-nums">{count}</span>
          ) : (
            <CheckIcon className="h-4 w-4 opacity-0" />
          )}
        </div>
      </button>

      {actionMenuOpen && (
        <ModalFrame onClose={() => setActionMenuOpen(false)} zIndex={1800}>
          <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-slate-100">
            {t('{count} selected', { count })}
          </div>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/10"
            onClick={() => runAndExit(copySelectedItems)}
          >
            <CopyIcon className="h-4 w-4 text-slate-400" />
            {t('Copy')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/10"
            onClick={() => runAndExit(createGroupFromItems)}
          >
            <PlusIcon className="h-4 w-4 text-cyan-300" />
            {t('Create group')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-red-400 hover:bg-red-500/10"
            onClick={() => runAndExit(deleteSelectedItems)}
          >
            <TrashIcon className="h-4 w-4" />
            {t('Delete')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-400 hover:bg-white/10"
            onClick={exitSelectionMode}
          >
            <NoEntryIcon className="h-4 w-4 text-slate-400" />
            {t('Cancel selection')}
          </button>
        </ModalFrame>
      )}
    </>
  );
}
