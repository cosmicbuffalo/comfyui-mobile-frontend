import { PinIconSvg } from '@/components/icons';
import { pinAccentTextClassName } from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

interface PinButtonProps {
  isPinned: boolean;
  onToggle?: () => void;
}

export function PinButton({ isPinned, onToggle }: PinButtonProps) {
  const { t } = useI18n();
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
      className={`flex items-center justify-center transition-colors ${pinAccentTextClassName} hover:text-fuchsia-600`}
      aria-label={t("Remove pin")}
    >
      <PinIconSvg className="w-5 h-5" />
    </button>
  );
}
