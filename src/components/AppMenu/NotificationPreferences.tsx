import { useEffect, useState } from 'react';
import {
  getPushPreferences,
  setPushPreferences,
  type PushPreferences,
} from '@/api/client';
import { menuMutedTextClassName, menuSurfaceClassName, menuTextClassName } from './menuStyles';
import { useI18n } from '@/i18n';

const ROWS: { key: keyof PushPreferences; label: string; hint?: string }[] = [
  { key: 'notifyOnComplete', label: 'Notify when a generation finishes' },
  { key: 'notifyOnError', label: 'Notify when a generation errors' },
  {
    key: 'includeThumbnail',
    label: 'Include a preview image',
    hint: 'Shows the output thumbnail in the notification.',
  },
];

function Toggle({ on, disabled, onChange }: { on: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-cyan-500' : 'bg-white/15'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// Server-side notification preferences. Apply to whichever delivery is active
// (web push or the native app), so they're shown in both modes.
export function NotificationPreferences() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<PushPreferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPushPreferences()
      .then((p) => !cancelled && setPrefs(p))
      .catch(() => !cancelled && setPrefs(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prefs) return null;

  const toggle = async (key: keyof PushPreferences) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next); // optimistic
    setSaving(true);
    try {
      const saved = await setPushPreferences({ [key]: next[key] });
      setPrefs(saved);
    } catch {
      setPrefs(prefs); // revert on failure
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${menuSurfaceClassName} p-4 space-y-3`}>
      {ROWS.map((row) => (
        <div key={row.key} className="flex items-center gap-3">
          <div className="flex-1">
            <div className={menuTextClassName}>{t(row.label)}</div>
            {row.hint && <div className={`text-sm ${menuMutedTextClassName}`}>{t(row.hint)}</div>}
          </div>
          <Toggle on={prefs[row.key]} disabled={saving} onChange={() => toggle(row.key)} />
        </div>
      ))}
    </div>
  );
}
