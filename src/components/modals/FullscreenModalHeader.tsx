import type { ReactNode } from 'react';
import { CloseButton } from '@/components/buttons/CloseButton';

interface FullscreenModalHeaderProps {
  title: string;
  onClose: () => void;
  headerActions?: ReactNode;
  closeDisabled?: boolean;
}

export function FullscreenModalHeader({
  title,
  onClose,
  headerActions,
  closeDisabled = false
}: FullscreenModalHeaderProps) {
  return (
    <div
      className="px-4 py-1.5 min-h-[52px] border-b shadow-sm relative z-50 shrink-0 bg-slate-900/95 border-white/10 flex items-center"
    >
      <div className="flex w-full justify-between items-center">
        <span className="font-semibold truncate pr-4 flex-1 text-slate-200">{title}</span>
        <div className="flex items-center gap-2">
          {headerActions}
          <CloseButton onClick={onClose} disabled={closeDisabled} />
        </div>
      </div>
    </div>
  );
}
