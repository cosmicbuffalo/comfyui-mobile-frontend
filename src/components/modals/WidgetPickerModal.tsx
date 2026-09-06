import type { ReactNode } from 'react';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

export interface WidgetPickerEntry {
  /** Identifies the choice back to the caller. */
  key: string;
  label: string;
}

interface WidgetPickerModalProps {
  title: string;
  icon?: ReactNode;
  entries: WidgetPickerEntry[];
  onPick: (key: string) => void;
  onClose: () => void;
}

/**
 * Choose one of a node's widgets, for an action that needs to be told which.
 *
 * A node can carry a dozen widgets, and listing them inside the context menu
 * pushed the menu past the edge of a phone screen and buried the actions below
 * them. A modal gives the list the room it needs and leaves the menu the size
 * it was.
 */
export function WidgetPickerModal({
  title,
  icon,
  entries,
  onPick,
  onClose,
}: WidgetPickerModalProps) {
  const { t } = useI18n();
  const choose = (key: string) => {
    onClose();
    onPick(key);
  };

  return (
    <Dialog
      onClose={onClose}
      title={
        icon ? (
          <span className="flex items-center gap-2">
            {icon}
            {title}
          </span>
        ) : (
          title
        )
      }
      size="md"
      description={
        <div className="widget-picker-list mt-2 flex flex-col gap-2">
          {entries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="widget-picker-entry flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm text-slate-100 hover:bg-white/10"
              onClick={() => choose(entry.key)}
            >
              <span className="min-w-0 truncate">{entry.label}</span>
            </button>
          ))}
        </div>
      }
      // A phone has no Escape key, so backdrop-tap cannot be the only way out.
      actions={[{ label: t('Cancel'), onClick: onClose, variant: 'secondary' }]}
    />
  );
}
