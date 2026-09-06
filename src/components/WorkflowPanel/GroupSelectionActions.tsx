import { SelectionCheckMark } from '@/components/buttons/SelectionCheckbox';
import { ArrowDownIcon, CornerDownRightIcon } from '@/components/icons';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { useI18n } from '@/i18n';

interface GroupSelectionActionsProps {
  childrenKeys: string[];
  descendantKeys: string[];
}

export function GroupSelectionActions({
  childrenKeys,
  descendantKeys,
}: GroupSelectionActionsProps) {
  const { t } = useI18n();
  const selectedKeys = useWorkflowSelectionStore((state) => state.selectedKeys);
  const selectKeys = useWorkflowSelectionStore((state) => state.selectKeys);
  const deselectKeys = useWorkflowSelectionStore((state) => state.deselectKeys);

  const selectedKeySet = new Set(selectedKeys);
  const childKeySet = new Set(childrenKeys);
  const hasChildren = childrenKeys.length > 0;
  const hasNestedDescendants = descendantKeys.some((key) => !childKeySet.has(key));
  const allChildrenSelected =
    hasChildren && childrenKeys.every((key) => selectedKeySet.has(key));
  const allDescendantsSelected =
    hasNestedDescendants
    && descendantKeys.every((key) => selectedKeySet.has(key));

  const toggleChildren = () => {
    if (allChildrenSelected) {
      deselectKeys(childrenKeys);
    } else {
      selectKeys(childrenKeys);
    }
  };

  const toggleDescendants = () => {
    if (allDescendantsSelected) {
      deselectKeys(descendantKeys);
    } else {
      selectKeys(descendantKeys);
    }
  };

  const buttonClassName =
    'flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-slate-800/40 disabled:text-slate-500 disabled:opacity-100';

  return (
    <div className="group-selection-actions grid grid-cols-2 gap-2 px-2 pb-2">
      <button
        type="button"
        onClick={toggleChildren}
        disabled={!hasChildren}
        className={buttonClassName}
      >
        {allChildrenSelected ? (
          <span className="-m-1 shrink-0 scale-75">
            <SelectionCheckMark selected={false} />
          </span>
        ) : (
          <ArrowDownIcon className="h-4 w-4 shrink-0" />
        )}
        <span>{t(allChildrenSelected ? 'Deselect children' : 'Select children')}</span>
      </button>
      <button
        type="button"
        onClick={toggleDescendants}
        disabled={!hasNestedDescendants}
        className={buttonClassName}
      >
        {allDescendantsSelected ? (
          <span className="-m-1 shrink-0 scale-75">
            <SelectionCheckMark selected={false} />
          </span>
        ) : (
          <CornerDownRightIcon className="h-4 w-4 shrink-0" />
        )}
        <span>{t(allDescendantsSelected ? 'Deselect all' : 'Select descendants')}</span>
      </button>
    </div>
  );
}
