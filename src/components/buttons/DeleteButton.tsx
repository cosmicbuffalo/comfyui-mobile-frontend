import { TrashIcon } from '@/components/icons';

interface DeleteButtonProps {
  onClick: () => void;
}

export function DeleteButton({ onClick }: DeleteButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Delete output"
      className="pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-red-500 flex items-center justify-center hover:bg-black/60 transition-colors"
    >
      <TrashIcon className="w-5 h-5" />
    </button>
  );
}
