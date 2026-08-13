import { MenuIcon } from '@/components/icons';
import { useT } from '@/i18n';
import { appChromeIconButtonBareClassName } from '@/components/chromeStyles';

interface MenuButtonProps {
  onClick: () => void;
}

export function MenuButton({ onClick }: MenuButtonProps) {
  const t = useT();
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
