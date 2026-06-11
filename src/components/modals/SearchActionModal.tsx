import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SearchBar } from '@/components/SearchBar';
import { CloseButton } from '@/components/buttons/CloseButton';

interface SearchActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchPlaceholder: string;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  zIndex?: number;
}

export function SearchActionModal({
  isOpen,
  onClose,
  title,
  searchQuery,
  onSearchQueryChange,
  searchPlaceholder,
  onBack,
  backLabel = 'Back',
  children,
  footer,
  zIndex = 2200,
}: SearchActionModalProps) {
  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm"
      style={{ zIndex }}
      onClick={onClose}
    >
      <div className="w-full h-full flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="bg-slate-950/88 border-b border-white/10 px-4 py-3 flex items-center justify-between safe-area-top">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                className="text-sm text-cyan-300 hover:text-cyan-200 font-medium"
                onClick={onBack}
              >
                {backLabel}
              </button>
            )}
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          </div>
          <CloseButton
            onClick={onClose}
            variant="plain"
            buttonSize={8}
            iconSize={5}
          />
        </div>

        <div className="bg-slate-950/88 px-4 py-2 border-b border-white/10">
          <SearchBar
            value={searchQuery}
            onChange={onSearchQueryChange}
            placeholder={searchPlaceholder}
            autoFocus
            inputClassName="border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 focus:ring-cyan-400"
          />
        </div>

        {children}

        {footer ?? (
          <div className="flex-shrink-0 h-12 bg-slate-950/88 border-t border-white/10 flex items-center justify-center">
            <button
              type="button"
              className="text-sm text-slate-400 hover:text-slate-100 font-medium"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
