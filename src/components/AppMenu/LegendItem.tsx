import type { ReactNode } from 'react';
import { menuSurfaceClassName } from './menuStyles';

export interface LegendItemProps {
  icon: ReactNode;
  title: string;
  description: string;
}

export function LegendItem({ icon, title, description }: LegendItemProps) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${menuSurfaceClassName}`}>
      {icon}
      <div>
        <p className="text-sm font-medium text-slate-100">{title}</p>
        <p className="text-xs text-slate-400">{description}</p>
      </div>
    </div>
  );
}
