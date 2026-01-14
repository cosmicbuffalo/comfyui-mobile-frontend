import { ChevronLeftBoldIcon } from '@/components/icons';

interface HamburgerMenuSubPageHeaderProps {
  title: string;
  onBack: () => void;
}

export function HamburgerMenuSubPageHeader({ title, onBack }: HamburgerMenuSubPageHeaderProps) {
  return (
    <button
      onClick={onBack}
      className="w-full flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
    >
      <ChevronLeftBoldIcon className="w-5 h-5 text-gray-400" />
      <span>{title}</span>
    </button>
  );
}
