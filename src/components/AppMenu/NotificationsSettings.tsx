import { useCallback, useEffect, useState } from 'react';
import { CheckIcon, GearIcon, WarningTriangleIcon } from '@/components/icons';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { getAppTargets, sendAppTestPush, type AppTarget } from '@/api/client';
import { isInNativeApp, APP_STORE_URL } from '@/utils/nativeApp';
import {
  menuIconClassName,
  menuMutedTextClassName,
  menuPrimaryButtonClassName,
  menuSecondaryButtonClassName,
  menuSurfaceClassName,
  menuTextClassName,
} from './menuStyles';
import { NotificationPreferences } from './NotificationPreferences';
import { useI18n } from '@/i18n';

// The Notifications block embedded in the Preferences sub-page: the preference
// toggles, then the delivery setup (web push opt-in, or native-app status).

// Inside the native app: push is handled natively (the app paired this server
// with the relay automatically), so we just surface status + a test.
function NativeAppNotifications() {
  const { t } = useI18n();
  const [targets, setTargets] = useState<AppTarget[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error` (which reports test-push failures): the lookup itself
  // failed, so pairing state is unknown. Leaving `targets` null keeps the UI
  // from claiming "isn't paired yet" when the endpoint was merely unreachable
  // or pairing is disabled server-side (403).
  const [lookupFailed, setLookupFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAppTargets()
      .then((r) => {
        if (cancelled) return;
        setTargets(r.targets);
        setLookupFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLookupFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendAppTestPush();
      if (result.sent === 0) {
        setError(t('No notification was delivered. Check the app is signed in and notifications are allowed.'));
      }
    } catch {
      // The API layer throws untranslated English; surface the localized copy.
      setError(t('Failed to send test notification.'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const paired = (targets?.length ?? 0) > 0;

  return (
    <div className="space-y-3">
      <NotificationPreferences />
      <div className={`${menuSurfaceClassName} p-4 space-y-3`}>
        <div className="flex items-start gap-3">
          <GearIcon className={menuIconClassName} />
          <div className="flex-1">
            <div className={menuTextClassName}>{t('Notifications handled by the app')}</div>
            <div className={`text-sm ${menuMutedTextClassName}`}>
              {t('This server alerts you through the ComfyUI app when a generation finishes.')}
            </div>
          </div>
          {paired && <CheckIcon className="w-5 h-5 text-cyan-400 mt-1" />}
        </div>

        {targets !== null && !paired && (
          <div className={`flex items-start gap-2 text-sm ${menuMutedTextClassName}`}>
            <WarningTriangleIcon className="w-4 h-4 text-slate-500 mt-0.5" />
            <span>{t("This server isn't paired yet. Open the app's server settings to enable notifications.")}</span>
          </div>
        )}

        {lookupFailed && (
          <div className={`flex items-start gap-2 text-sm ${menuMutedTextClassName}`}>
            <WarningTriangleIcon className="w-4 h-4 text-slate-500 mt-0.5" />
            <span>{t("Couldn't check this server's pairing status. It may be unreachable, or pairing may be turned off on the node.")}</span>
          </div>
        )}

        {paired && (
          <div className={`text-sm ${menuMutedTextClassName}`}>
            {targets!.length === 1
              ? t('Paired with {count} device.', { count: targets!.length })
              : t('Paired with {count} devices.', { count: targets!.length })}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-amber-400">
            <WarningTriangleIcon className="w-4 h-4 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {paired && (
          <button
            type="button"
            onClick={sendTest}
            disabled={busy}
            className={`w-full ${menuSecondaryButtonClassName}`}
          >
            {busy ? t('Working…') : t('Send test notification')}
          </button>
        )}
      </div>
    </div>
  );
}

// On the plain web (free tier): the self-hosted web-push setup, plus a nudge
// toward the app for a zero-setup experience.
function WebNotifications() {
  const { t } = useI18n();
  const { supported, needsInstall, subscribed, busy, error, enable, disable, sendTest } =
    usePushNotifications();

  return (
    <div className="space-y-3">
      <NotificationPreferences />

      <div className={`${menuSurfaceClassName} p-4 space-y-3`}>
        <div className="flex items-start gap-3">
          <GearIcon className={menuIconClassName} />
          <div className="flex-1">
            <div className={menuTextClassName}>{t('Generation complete alerts')}</div>
            <div className={`text-sm ${menuMutedTextClassName}`}>
              {t('Get a push notification when a generation finishes — even with the app closed.')}
            </div>
          </div>
          {subscribed && <CheckIcon className="w-5 h-5 text-cyan-400 mt-1" />}
        </div>

        {!supported && (
          <div className={`flex items-center gap-2 text-sm ${menuMutedTextClassName}`}>
            <WarningTriangleIcon className="w-4 h-4 text-slate-500" />
            {t("This browser doesn't support push notifications. A secure (HTTPS) connection is required.")}
          </div>
        )}

        {supported && needsInstall && (
          <div className={`flex items-start gap-2 text-sm ${menuMutedTextClassName}`}>
            <WarningTriangleIcon className="w-4 h-4 text-slate-500 mt-0.5" />
            <span>
              {t('On iOS, add this app to your Home Screen first (Share → Add to Home Screen), then open it from there to enable notifications.')}
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-amber-400">
            <WarningTriangleIcon className="w-4 h-4 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {supported && !needsInstall && (
          <div className="space-y-2">
            {subscribed ? (
              <button type="button" onClick={disable} disabled={busy} className={`w-full ${menuSecondaryButtonClassName}`}>
                {busy ? t('Working…') : t('Disable notifications')}
              </button>
            ) : (
              <button type="button" onClick={enable} disabled={busy} className={`w-full ${menuPrimaryButtonClassName}`}>
                {busy ? t('Working…') : t('Enable notifications')}
              </button>
            )}

            {subscribed && (
              <button type="button" onClick={sendTest} disabled={busy} className={`w-full ${menuSecondaryButtonClassName}`}>
                {t('Send test notification')}
              </button>
            )}
          </div>
        )}
      </div>

      {APP_STORE_URL != null && (
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`block ${menuSurfaceClassName} p-4`}
        >
          <div className={menuTextClassName}>{t('Want notifications with zero setup?')}</div>
          <div className={`text-sm ${menuMutedTextClassName} mt-1`}>
            {t('The ComfyUI app delivers reliable native notifications — no HTTPS, certificates, or Home Screen steps. Get it on the App Store →')}
          </div>
        </a>
      )}
    </div>
  );
}

export function NotificationsSettings() {
  return isInNativeApp() ? <NativeAppNotifications /> : <WebNotifications />;
}
