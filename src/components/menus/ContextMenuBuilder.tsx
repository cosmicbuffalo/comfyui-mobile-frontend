import type { MouseEvent, ReactNode } from 'react';

export type ContextMenuColor = 'default' | 'muted' | 'danger' | 'primary';

export interface ContextMenuActionItem {
  type?: 'action';
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  color?: ContextMenuColor;
  disabled?: boolean;
  hidden?: boolean;
  rightSlot?: ReactNode;
  className?: string;
}

export interface ContextMenuDividerItem {
  type: 'divider';
  key: string;
  className?: string;
}

export interface ContextMenuCustomItem {
  type: 'custom';
  key: string;
  hidden?: boolean;
  render: ReactNode | (() => ReactNode);
}

export type ContextMenuItemDefinition =
  | ContextMenuActionItem
  | ContextMenuDividerItem
  | ContextMenuCustomItem;

interface ContextMenuBuilderProps {
  items: ContextMenuItemDefinition[];
  className?: string;
  itemClassName?: string;
}

const colorClasses: Record<ContextMenuColor, { row: string; icon: string }> = {
  default: {
    row: 'text-gray-900 hover:bg-gray-50',
    icon: 'text-gray-500'
  },
  muted: {
    row: 'text-gray-600 hover:bg-gray-50',
    icon: 'text-gray-500'
  },
  danger: {
    row: 'text-red-600 hover:bg-red-50',
    icon: 'text-red-500'
  },
  primary: {
    row: 'text-blue-600 hover:bg-blue-50',
    icon: 'text-blue-500'
  }
};

export function ContextMenuBuilder({
  items,
  className,
  itemClassName
}: ContextMenuBuilderProps) {
  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden ${className ?? ''}`.trim()}
    >
      {items.map((item) => {
        if (item.type === 'divider') {
          return (
            <div
              key={item.key}
              className={`border-t border-gray-200 my-1 ${item.className ?? ''}`.trim()}
            />
          );
        }

        if (item.type === 'custom') {
          if (item.hidden) return null;
          return (
            <div key={item.key}>
              {typeof item.render === 'function' ? item.render() : item.render}
            </div>
          );
        }

        if (item.hidden) return null;

        const tone = colorClasses[item.color ?? 'default'];
        return (
          <button
            key={item.key}
            type="button"
            className={[
              'w-full flex items-center gap-2 text-left px-3 py-2 text-sm',
              item.rightSlot ? 'justify-between' : '',
              tone.row,
              item.disabled ? 'opacity-50 cursor-not-allowed' : '',
              itemClassName ?? '',
              item.className ?? ''
            ].join(' ').trim()}
            onClick={item.onClick}
            disabled={item.disabled}
          >
            <span className="flex items-center gap-2 min-w-0">
              {item.icon ? <span className={tone.icon}>{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </span>
            {item.rightSlot ? <span className="shrink-0">{item.rightSlot}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
