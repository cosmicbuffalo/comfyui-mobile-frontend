import { appChromePrimaryButtonClassName } from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

/**
 * Banner offering a reload onto a newer server build.
 *
 * Shown only when useAppUpdateCheck found the server updated but decided
 * against reloading on its own (something transient — a run, the mask editor,
 * the viewer — is live). Dismissable: nothing is broken while it shows, since
 * the chunk prefetch keeps the running build whole; the reload just gets the
 * user onto the current one at a moment of their choosing.
 */
export function UpdateNotice({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <div
      className="update-notice fixed inset-x-0 z-[2000] flex items-center justify-center gap-3 border-b border-slate-700 bg-slate-900/95 px-4 py-2"
      style={{ top: 'var(--top-bar-offset, 69px)' }}
    >
      <span className="text-xs text-slate-200">{t('A new version of the app is available.')}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={`update-notice-reload rounded-md px-3 py-1 text-xs font-semibold ${appChromePrimaryButtonClassName}`}
      >
        {t('Reload')}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('Dismiss')}
        className="update-notice-dismiss px-1 text-sm text-slate-400"
      >
        ✕
      </button>
    </div>
  );
}
