import type { ReactNode } from 'react';

interface DialogAction {
  label: string;
  onClick: () => void;
  className?: string;
  variant?: 'secondary' | 'danger' | 'primary';
}

interface DialogProps {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  actions: DialogAction[];
  actionsLayout?: 'stack' | 'inline';
  zIndex?: number;
}

export function Dialog({
  onClose,
  title,
  description,
  actions,
  actionsLayout = 'inline',
  zIndex = 2200
}: DialogProps) {
  const defaultActionClass = (variant: DialogAction['variant']) => {
    if (variant === 'danger') {
      return 'px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700';
    }
    if (variant === 'primary') {
      return 'px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700';
    }
    return 'px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100';
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-gray-900 text-base font-semibold">{title}</div>
        {description && (
          <div className="text-gray-600 text-sm mt-1">
            {description}
          </div>
        )}
        <div className={actionsLayout === 'stack' ? 'mt-4 flex flex-col gap-2' : 'mt-4 flex justify-end gap-2'}>
          {actions.map((action) => (
            <button
              key={action.label}
              className={`${defaultActionClass(action.variant)} ${action.className ?? ''}`.trim()}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
