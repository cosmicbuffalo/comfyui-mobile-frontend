import { useState } from 'react';
import { Dialog } from '@/components/modals/Dialog';
import { Z_LAYERS } from '@/components/zLayers';
import { menuInputClassName } from '../menuStyles';
import { useI18n } from '@/i18n';

/** Single text-field dialog used for both "New folder" and "Rename". */
export function NameDialog({
  title,
  confirmLabel,
  initialValue,
  onConfirm,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  initialValue: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const invalid = trimmed.length === 0 || /[/\\]/.test(trimmed);
  return (
    <Dialog
      // Opened from inside the app menu, so it has to clear the menu panel.
      zIndex={Z_LAYERS.panelDialog}
      title={title}
      description={
        // p-1 gives the input's focus ring room inside the Dialog's
        // description wrapper, which has overflow-y-auto (→ overflow-x clips),
        // so the ring isn't cut off at the left/right edges.
        <div className="p-1">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !invalid) onConfirm(trimmed);
            }}
            placeholder={t('Name')}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${menuInputClassName}`}
          />
        </div>
      }
      actions={[
        { label: t('Cancel'), variant: 'secondary', onClick: onClose },
        {
          label: confirmLabel,
          variant: 'primary',
          disabled: invalid,
          onClick: () => onConfirm(trimmed),
        },
      ]}
      onClose={onClose}
    />
  );
}
