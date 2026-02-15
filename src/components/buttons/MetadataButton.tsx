import { InfoIcon } from '@/components/icons/InfoIcon';

interface MetadataButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export function MetadataButton({
  onClick,
  disabled
}: MetadataButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Toggle metadata"
      className={`pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors ${
        disabled ? 'opacity-40' : ''
      }`}
      disabled={disabled}
    >
      <InfoIcon className="w-5 h-5" />
    </button>
  );
}
