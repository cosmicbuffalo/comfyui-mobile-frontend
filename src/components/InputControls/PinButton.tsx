import { PinIconSvg } from '@/components/icons';
import { useT } from '@/i18n';

interface PinButtonProps {
  isPinned: boolean;
  onToggle?: () => void;
}

export function PinButton({ isPinned, onToggle }: PinButtonProps) {
  const t = useT();
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
      aria-label={t("Remove pin")}
    >
      <PinIconSvg className="w-5 h-5" />
    </button>
  );
}
