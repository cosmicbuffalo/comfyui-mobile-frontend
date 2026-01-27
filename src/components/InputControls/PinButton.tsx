import { PinIconSvg } from '@/components/icons';

interface PinButtonProps {
  isPinned: boolean;
  onToggle?: () => void;
}

export function PinButton({ isPinned, onToggle }: PinButtonProps) {
  if (!isPinned || !onToggle) return null;
  const handleToggleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  };
  return (
    <button
      type="button"
      onClick={handleToggleClick}
      className="flex items-center justify-center transition-colors text-fuchsia-500 hover:text-fuchsia-600"
      aria-label="Remove pin"
    >
      <PinIconSvg className="w-5 h-5" />
    </button>
  );
}
