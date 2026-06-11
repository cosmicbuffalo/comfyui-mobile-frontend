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
    row: 'text-slate-100 hover:bg-white/10',
    icon: 'text-slate-400'
  },
  muted: {
    row: 'text-slate-300 hover:bg-white/10',
    icon: 'text-slate-400'
  },
  danger: {
    row: 'text-red-400 hover:bg-red-500/10',
    icon: 'text-red-400'
  },
  primary: {
    row: 'text-cyan-300 hover:bg-cyan-400/10',
    icon: 'text-cyan-300'
  }
};

export function ContextMenuBuilder({
  items,
  className,
  itemClassName
}: ContextMenuBuilderProps) {
  return (
    <div
      className={`bg-slate-900 border border-white/10 text-slate-100 rounded-lg shadow-lg overflow-hidden ${className ?? ''}`.trim()}
    >
      {items.map((item) => {
        if (item.type === 'divider') {
          return (
            <div
              key={item.key}
              className={`border-t border-white/10 my-1 ${item.className ?? ''}`.trim()}
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
            <span className="flex items-center gap-2 min-w-0 flex-1">
              {item.icon ? (
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${tone.icon}`}>
                  {item.icon}
                </span>
              ) : null}
              <span className="flex-1 truncate text-left">{item.label}</span>
            </span>
            {item.rightSlot ? <span className="shrink-0">{item.rightSlot}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
