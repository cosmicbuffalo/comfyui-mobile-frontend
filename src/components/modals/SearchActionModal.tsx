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
      className="fixed inset-0 bg-gray-400/40 backdrop-blur-sm"
      style={{ zIndex }}
      onClick={onClose}
    >
      <div className="w-full h-full flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between safe-area-inset-top">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                className="text-sm text-blue-600 font-medium"
                onClick={onBack}
              >
                {backLabel}
              </button>
            )}
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          </div>
          <CloseButton
            onClick={onClose}
            variant="plain"
            buttonSize={8}
            iconSize={5}
          />
        </div>

        <div className="bg-white px-4 py-2 border-b border-gray-100">
          <SearchBar
            value={searchQuery}
            onChange={onSearchQueryChange}
            placeholder={searchPlaceholder}
            autoFocus
          />
        </div>

        {children}

        {footer ?? (
          <div className="flex-shrink-0 h-12 bg-white border-t border-gray-200 flex items-center justify-center">
            <button
              type="button"
              className="text-sm text-gray-500 font-medium"
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
