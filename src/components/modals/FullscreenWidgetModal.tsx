import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@/components/icons';

interface FullscreenWidgetModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}

export function FullscreenWidgetModal({
  isOpen,
  title,
  onClose,
  children,
  headerActions
}: FullscreenWidgetModalProps) {
  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalStyle = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1500] bg-gray-400/40 dark:bg-black/50 backdrop-blur-sm safe-area-top"
      onClick={onClose}
    >
      {/* Modal Content */}
      <div
        className="w-full h-full flex flex-col"
        style={{
          paddingTop: 'calc(var(--top-bar-offset, 0px) + env(safe-area-inset-top, 0px))',
          paddingBottom: 'var(--bottom-bar-offset, 0px)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header/Input Area - Below top bar */}
        <div className="bg-white dark:bg-[#151a23] p-4 border-b border-gray-200 dark:border-gray-800 shadow-sm relative z-50 min-h-0 overflow-y-auto">
          <div className="flex justify-between items-start mb-2">
            <span className="font-semibold text-gray-700 dark:text-gray-200 truncate pr-4 pt-1 flex-1">{title}</span>
            <div className="flex items-center gap-2">
              {headerActions}
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                aria-label="Close"
              >
                <CloseIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
          <div className="mt-2">
            {children}
          </div>
        </div>

        {/* Allow touching below to close */}
        <div className="flex-1" onClick={onClose} />
      </div>
    </div>,
    document.body
  );
}
