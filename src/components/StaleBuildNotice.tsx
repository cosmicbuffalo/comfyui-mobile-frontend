import { appChromePrimaryButtonClassName } from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

/**
 * Shown in place of a panel whose code is no longer on the server.
 *
 * The panels are split into their own chunks, named by a hash of their content.
 * Updating the node replaces every one of those files, so a tab or installed
 * app that was open across the update is holding an index that names chunks
 * which have been deleted. Nothing goes wrong until you open a panel that had
 * not been loaded yet — its import 404s, and the rejection took the whole app
 * down to a blank screen rather than the one panel that could not be fetched.
 */
// It stands in for a panel, and panels stay mounted behind whichever one is
// showing — they receive `visible` and draw nothing when it is false. Ignoring
// that prop left the notice's absolute overlay sitting on top of every other
// panel after navigating away from the one that failed.
export function StaleBuildNotice({ visible = true }: { visible?: boolean }) {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <div className="stale-build-notice absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-sm text-slate-200">{t('This panel belongs to an older version of the app.')}</div>
      <div className="text-xs text-slate-400 max-w-xs">
        {t('The server has been updated since this tab was opened. Reload to pick up the new version.')}
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={`stale-build-reload mt-1 rounded-lg px-4 py-2 text-sm font-semibold ${appChromePrimaryButtonClassName}`}
      >
        {t('Reload')}
      </button>
    </div>
  );
}

