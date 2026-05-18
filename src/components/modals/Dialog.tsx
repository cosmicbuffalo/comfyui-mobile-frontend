import { useEffect, type ReactNode } from 'react';

interface DialogAction {
  label: string;
  onClick: () => void;
  className?: string;
  variant?: 'secondary' | 'danger' | 'primary';
  disabled?: boolean;
}

type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';
type DialogAlign = 'center' | 'top';

interface DialogProps {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  actions: DialogAction[];
  actionsLayout?: 'stack' | 'inline';
  size?: DialogSize;
  align?: DialogAlign;
  disableClose?: boolean;
  zIndex?: number;
  /**
   * When true the backdrop covers the entire viewport instead of leaving
   * space for the top/bottom chrome bars. Use this when the dialog is
   * rendered above a fullscreen overlay (e.g. the image viewer) where the
   * chrome is not visible.
   */
  fullscreen?: boolean;
}

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export function Dialog({
  onClose,
  title,
  description,
  actions,
  actionsLayout = 'inline',
  size = 'sm',
  align = 'center',
  disableClose = false,
  zIndex = 2200,
  fullscreen = false,
}: DialogProps) {
  const defaultActionClass = (variant: DialogAction['variant']) => {
    if (variant === 'danger') {
      return 'px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600';
    }
    if (variant === 'primary') {
      return 'px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600';
    }
    return 'px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent';
  };

  const alignClass = align === 'top' ? 'items-start pt-6' : 'items-center';
  const handleBackdropClick = disableClose ? undefined : onClose;

  // While `disableClose` is set we swallow Escape on the capture phase so any
  // ancestor (e.g. SlidePanel) can't close us via its own document-level
  // keydown handler.
  useEffect(() => {
    if (!disableClose) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [disableClose]);

  return (
    <div
      className={`fixed left-0 right-0 bg-black/50 flex ${alignClass} justify-center p-4 overscroll-contain`}
      style={{
        zIndex,
        top: fullscreen ? 0 : 'var(--top-bar-offset, 0px)',
        bottom: fullscreen ? 0 : 'var(--bottom-bar-offset, 0px)',
      }}
      onClick={handleBackdropClick}
      onTouchMove={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${SIZE_CLASS[size]} max-h-full flex flex-col bg-white border border-gray-200 rounded-xl shadow-lg p-4`}
        onClick={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <div className="text-gray-900 text-base font-semibold shrink-0">{title}</div>
        {description && (
          <div className="text-gray-600 text-sm mt-1 overflow-y-auto overscroll-contain flex-1 min-h-0">
            {description}
          </div>
        )}
        <div className={`shrink-0 ${actionsLayout === 'stack' ? 'mt-4 flex flex-col gap-2' : 'mt-4 flex justify-end gap-2'}`}>
          {actions.map((action) => (
            <button
              key={action.label}
              className={`${defaultActionClass(action.variant)} ${action.className ?? ''}`.trim()}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
