import { CheckIcon, GearIcon, WarningTriangleIcon } from '@/components/icons';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import {
  menuIconClassName,
  menuMutedTextClassName,
  menuPrimaryButtonClassName,
  menuSecondaryButtonClassName,
  menuSurfaceClassName,
  menuTextClassName,
} from './menuStyles';
import { NotificationPreferences } from './NotificationPreferences';

// The Notifications block embedded in the Preferences sub-page: the preference
// toggles, then the delivery setup (web push opt-in, or native-app status).

// On the plain web (free tier): the self-hosted web-push setup, plus a nudge
// toward the app for a zero-setup experience.
function WebNotifications() {
  const { supported, needsInstall, subscribed, busy, error, enable, disable, sendTest } =
    usePushNotifications();

  return (
    <div className="space-y-3">
      <NotificationPreferences />

      <div className={`${menuSurfaceClassName} p-4 space-y-3`}>
        <div className="flex items-start gap-3">
          <GearIcon className={menuIconClassName} />
          <div className="flex-1">
            <div className={menuTextClassName}>Generation complete alerts</div>
            <div className={`text-sm ${menuMutedTextClassName}`}>
              Get a push notification when a generation finishes — even with the app closed.
            </div>
          </div>
          {subscribed && <CheckIcon className="w-5 h-5 text-cyan-400 mt-1" />}
        </div>

        {!supported && (
          <div className={`flex items-center gap-2 text-sm ${menuMutedTextClassName}`}>
            <WarningTriangleIcon className="w-4 h-4 text-slate-500" />
            This browser doesn&apos;t support push notifications. A secure (HTTPS) connection is required.
          </div>
        )}

        {supported && needsInstall && (
          <div className={`flex items-start gap-2 text-sm ${menuMutedTextClassName}`}>
            <WarningTriangleIcon className="w-4 h-4 text-slate-500 mt-0.5" />
            <span>
              On iOS, add this app to your Home Screen first (Share &rarr; Add to Home Screen),
              then open it from there to enable notifications.
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
                {busy ? 'Working…' : 'Disable notifications'}
              </button>
            ) : (
              <button type="button" onClick={enable} disabled={busy} className={`w-full ${menuPrimaryButtonClassName}`}>
                {busy ? 'Working…' : 'Enable notifications'}
              </button>
            )}

            {subscribed && (
              <button type="button" onClick={sendTest} disabled={busy} className={`w-full ${menuSecondaryButtonClassName}`}>
                Send test notification
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function NotificationsSettings() {
  return <WebNotifications />;
}
