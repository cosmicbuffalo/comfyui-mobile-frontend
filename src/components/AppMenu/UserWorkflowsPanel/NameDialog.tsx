import { useState } from 'react';
import { Dialog } from '@/components/modals/Dialog';
import { menuInputClassName } from '../menuStyles';

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
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const invalid = trimmed.length === 0 || /[/\\]/.test(trimmed);
  return (
    <Dialog
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
            placeholder="Name"
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${menuInputClassName}`}
          />
        </div>
      }
      actions={[
        { label: 'Cancel', variant: 'secondary', onClick: onClose },
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
