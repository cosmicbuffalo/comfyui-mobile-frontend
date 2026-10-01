import { useEffect, useState } from 'react';
import { setAppPreferences, type AppPreferences } from '@/api/client/preferences';
import { useI18n } from '@/i18n';
import {
  menuMutedTextClassName,
  menuPanelDivideClassName,
  menuTextClassName,
} from './menuStyles';

/** What a server-wide switch's status endpoint reports. */
export interface ServerSwitchStatus {
  enabled: boolean;
  /** An environment variable decides, so the toggle is not the operator's. */
  forcedByEnvironment: boolean;
  /** Multiuser, and this user is not an admin: the server ignores their change. */
  adminOnly?: boolean;
}

interface ServerSwitchSettingProps {
  label: string;
  description: string;
  /** Shown when the environment decides. */
  lockedNote: string;
  /** The server preference this switch writes. */
  preferenceKey: keyof AppPreferences;
  getStatus: () => Promise<ServerSwitchStatus>;
  /** Told the server's state after it loads and after every change. */
  onStatus?: (status: ServerSwitchStatus) => void;
}

/**
 * A switch for a server-wide preference that an environment variable can
 * override. When the environment decides, or the user is not this multiuser
 * server's admin, the switch only reports it. Hidden entirely if the server
 * predates the status endpoint.
 */
export function ServerSwitchSetting({
  label,
  description,
  lockedNote,
  preferenceKey,
  getStatus,
  onStatus,
}: ServerSwitchSettingProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ServerSwitchStatus | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        onStatus?.(next);
      })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
    // Load once; getStatus/onStatus are stable module functions in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status) return null;
  const locked = status.forcedByEnvironment || status.adminOnly === true;

  const toggle = async () => {
    if (locked || saving) return;
    setSaving(true);
    try {
      await setAppPreferences({ [preferenceKey]: !status.enabled });
      const next = await getStatus();
      setStatus(next);
      onStatus?.(next);
    } catch {
      // Leave the switch where the server says it is.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={menuPanelDivideClassName}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className={`text-sm ${menuTextClassName}`}>{label}</div>
          <div className={`text-xs ${menuMutedTextClassName} mt-0.5`}>{description}</div>
          {locked && (
            <div className={`text-xs ${menuMutedTextClassName} mt-1`}>
              {status.forcedByEnvironment ? lockedNote : t('Only an admin can change this on this server.')}
            </div>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.enabled}
          aria-disabled={locked}
          disabled={locked || saving}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${
            status.enabled ? 'bg-cyan-500' : 'bg-slate-700'
          } ${locked ? 'opacity-50' : ''}`}
          onClick={() => void toggle()}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${
              status.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
