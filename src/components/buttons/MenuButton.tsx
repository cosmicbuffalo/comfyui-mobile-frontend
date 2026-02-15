import { MenuIcon } from '@/components/icons';

interface MenuButtonProps {
  onClick: () => void;
}

export function MenuButton({ onClick }: MenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Menu"
      className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100"
    >
      <MenuIcon className="w-6 h-6" />
    </button>
  );
}
