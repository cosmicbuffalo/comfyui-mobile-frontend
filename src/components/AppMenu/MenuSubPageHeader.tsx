import type { ReactNode } from 'react';
import { ChevronLeftBoldIcon } from '@/components/icons';

interface MenuSubPageHeaderProps {
  title: string;
  onBack: () => void;
  rightElement?: ReactNode;
}

export function MenuSubPageHeader({ title, onBack, rightElement }: MenuSubPageHeaderProps) {
  return (
    <div className="flex items-center mb-3">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide"
      >
        <ChevronLeftBoldIcon className="w-5 h-5 text-gray-400" />
        <span>{title}</span>
      </button>
      {rightElement && <div className="ml-auto">{rightElement}</div>}
    </div>
  );
}
