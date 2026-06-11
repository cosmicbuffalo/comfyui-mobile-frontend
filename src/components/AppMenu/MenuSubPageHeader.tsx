import type { ReactNode } from 'react';
import { ChevronLeftBoldIcon } from '@/components/icons';
import { menuSectionHeaderClassName } from './menuStyles';

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
        className={`${menuSectionHeaderClassName} justify-start mb-0`}
      >
        <ChevronLeftBoldIcon className="w-5 h-5 text-slate-400" />
        <span>{title}</span>
      </button>
      {rightElement && <div className="ml-auto">{rightElement}</div>}
    </div>
  );
}
