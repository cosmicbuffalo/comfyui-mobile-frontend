import { ChevronLeftBoldIcon } from '@/components/icons';

interface PreviousButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function PreviousButton({ onClick, disabled = false }: PreviousButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Previous"
      disabled={disabled}
      className="absolute left-3 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white disabled:opacity-0 transition-all pointer-events-auto"
    >
      <ChevronLeftBoldIcon className="w-8 h-8" />
    </button>
  );
}
