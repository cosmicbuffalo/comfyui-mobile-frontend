import { MenuIcon } from '@/components/icons';
import { appChromeIconButtonBareClassName } from '@/components/chromeStyles';

interface MenuButtonProps {
  onClick: () => void;
}

export function MenuButton({ onClick }: MenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Menu"
      className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${appChromeIconButtonBareClassName}`}
    >
      <MenuIcon className="w-6 h-6" />
    </button>
  );
}
