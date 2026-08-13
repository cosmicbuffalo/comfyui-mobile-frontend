import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { SelectionCheckbox } from '@/components/buttons/SelectionCheckbox';
import { EyeOffIcon } from '@/components/icons';
import { useT } from '@/i18n';

interface GroupHiddenSelectionPlaceholderProps {
  // Item keys of the group's hidden member nodes (folded away / declutter-hidden).
  hiddenKeys: string[];
}

/**
 * Select-mode placeholder shown at the bottom of a group whose membership
 * includes hidden nodes. Hidden members aren't rendered as their own cards, so
 * this surfaces that they exist and are part of the selection — and lets the
 * user toggle them as a unit. Reads selection state itself so toggling doesn't
 * re-render the whole workflow panel.
 */
export function GroupHiddenSelectionPlaceholder({
  hiddenKeys,
}: GroupHiddenSelectionPlaceholderProps) {
  const t = useT();
  const selectedKeys = useWorkflowSelectionStore((s) => s.selectedKeys);
  const selectKeys = useWorkflowSelectionStore((s) => s.selectKeys);
  const deselectKeys = useWorkflowSelectionStore((s) => s.deselectKeys);

  const count = hiddenKeys.length;
  if (count === 0) return null;

  const selectedSet = new Set(selectedKeys);
  const selectedCount = hiddenKeys.reduce(
    (acc, key) => acc + (selectedSet.has(key) ? 1 : 0),
    0,
  );
  const allSelected = selectedCount === count;
  const toggle = () => (allSelected ? deselectKeys(hiddenKeys) : selectKeys(hiddenKeys));

  return (
    <button
      type="button"
      onClick={toggle}
      className="group-hidden-selection-row mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-white/15 bg-slate-900/60 px-3 py-2 text-left"
    >
      <SelectionCheckbox
        selected={allSelected}
        ariaLabel={allSelected ? t('Deselect hidden nodes') : t('Select hidden nodes')}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      />
      <EyeOffIcon className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="text-xs text-slate-300">
        {count === 1
          ? t('{count} hidden node', { count })
          : t('{count} hidden nodes', { count })}
        {selectedCount > 0 && !allSelected
          ? ` ${t('({count} selected)', { count: selectedCount })}`
          : ''}
      </span>
    </button>
  );
}
