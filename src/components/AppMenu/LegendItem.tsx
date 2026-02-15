import type { ReactNode } from 'react';

export interface LegendItemProps {
  icon: ReactNode;
  title: string;
  description: string;
}

export function LegendItem({ icon, title, description }: LegendItemProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
      {icon}
      <div>
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </div>
  );
}
