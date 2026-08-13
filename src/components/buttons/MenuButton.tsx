import { MenuIcon } from '@/components/icons';
import { appChromeIconButtonBareClassName } from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

interface MenuButtonProps {
  onClick: () => void;
}

export function MenuButton({ onClick }: MenuButtonProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('Menu')}
      className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${appChromeIconButtonBareClassName}`}
    >
      <MenuIcon className="w-6 h-6" />
    </button>
  );
}
