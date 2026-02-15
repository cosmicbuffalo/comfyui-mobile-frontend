import { ChevronRightIcon } from '@/components/icons';

interface NextButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function NextButton({ onClick, disabled = false }: NextButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Next"
      disabled={disabled}
      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white disabled:opacity-0 transition-all pointer-events-auto"
    >
      <ChevronRightIcon className="w-8 h-8" />
    </button>
  );
}
