import type { ReactNode } from 'react';
import { CloseButton } from '@/components/buttons/CloseButton';
import { themeColors } from '@/theme/colors';

interface FullscreenModalHeaderProps {
  title: string;
  onClose: () => void;
  headerActions?: ReactNode;
  isDark: boolean;
}

export function FullscreenModalHeader({
  title,
  onClose,
  headerActions,
  isDark
}: FullscreenModalHeaderProps) {
  return (
    <div
      className="bg-white p-4 border-b border-gray-200 dark:border-gray-800 shadow-sm relative z-50 min-h-0 overflow-y-auto shrink-0"
      style={{
        maxHeight: 'var(--top-bar-offset)',
        ...(isDark ? { backgroundColor: themeColors.surface.darkPanel } : {})
      }}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="font-semibold text-gray-700 dark:text-gray-200 truncate pr-4 pt-1 flex-1">{title}</span>
        <div className="flex items-center gap-2">
          {headerActions}
          <CloseButton onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
