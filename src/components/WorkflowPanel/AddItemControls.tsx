import { PlusIcon } from '@/components/icons';
import { useT } from '@/i18n';

interface AddItemControlsProps {
  onAddNode: () => void;
  onAddGroup: () => void;
  className?: string;
}

const buttonClass =
  'flex-1 py-3 rounded-xl border-2 border-dashed border-white/15 flex items-center justify-center gap-2 text-sm font-medium text-slate-400 hover:border-white/25 hover:text-slate-200 active:bg-white/5 transition-colors';

// Quick "add node / add group" controls. Rendered at the bottom of the node
// list (and in the empty-workflow state) so items can be added in the current
// scope without going through a node/group context menu.
export function AddItemControls({ onAddNode, onAddGroup, className = '' }: AddItemControlsProps) {
  const t = useT();
  return (
    <div className={`add-item-controls flex gap-2 ${className}`}>
      <button type="button" onClick={onAddNode} className={buttonClass}>
        <PlusIcon className="w-4 h-4" />
        {t('Add node')}
      </button>
      <button type="button" onClick={onAddGroup} className={buttonClass}>
        <PlusIcon className="w-4 h-4" />
        {t('Add group')}
      </button>
    </div>
  );
}
