import { PlusIcon } from '@/components/icons';

interface AddNodePlaceholderProps {
  onClick: () => void;
}

export function AddNodePlaceholder({ onClick }: AddNodePlaceholderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full mb-3 py-4 rounded-xl border-2 border-dashed border-white/15 flex items-center justify-center gap-2 text-sm font-medium text-slate-400 hover:border-white/25 hover:text-slate-200 active:bg-white/5 transition-colors"
    >
      <PlusIcon className="w-4 h-4" />
      Add node
    </button>
  );
}
