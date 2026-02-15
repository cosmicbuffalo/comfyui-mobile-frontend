interface FullscreenModalActionItem {
  key: string;
  label: string;
  onClick: () => void;
  variant?: 'secondary' | 'primary' | 'danger';
  disabled?: boolean;
}

interface FullscreenModalActionsProps {
  actions: FullscreenModalActionItem[];
  zIndex?: number;
}

const variantClasses: Record<NonNullable<FullscreenModalActionItem['variant']>, string> = {
  secondary: 'bg-white border border-gray-300 text-gray-700',
  primary: 'bg-blue-600 text-white',
  danger: 'bg-red-600 text-white'
};

export function FullscreenModalActions({
  actions,
  zIndex
}: FullscreenModalActionsProps) {
  return (
    <div
      className="fixed bottom-6 left-0 right-0 flex justify-center gap-4 px-4"
      style={{
        zIndex,
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}
    >
      {actions.map((action) => {
        const variant = action.variant ?? 'secondary';
        return (
          <button
            key={action.key}
            type="button"
            className={`px-5 py-2.5 rounded-full text-sm font-medium shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]}`}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
