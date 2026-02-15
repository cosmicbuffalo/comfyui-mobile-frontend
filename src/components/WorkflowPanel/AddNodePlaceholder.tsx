import { PlusIcon } from '@/components/icons';

interface AddNodePlaceholderProps {
  onClick: () => void;
}

export function AddNodePlaceholder({ onClick }: AddNodePlaceholderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full mb-3 py-4 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center gap-2 text-sm font-medium text-gray-400 hover:border-gray-400 hover:text-gray-500 active:bg-gray-50 transition-colors"
    >
      <PlusIcon className="w-4 h-4" />
      Add node
    </button>
  );
}
