import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPushConfig,
  sendSubscription,
  removeSubscription,
  sendTestPush,
} from '@/api/client';
import { t, useI18n } from '@/i18n';

const SW_URL = '/mobile/sw.js';
const SW_SCOPE = '/mobile/';

// VAPID public keys arrive base64url-encoded; PushManager.subscribe wants the
// raw bytes as a Uint8Array.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// On iOS, web push only works for a PWA added to the Home Screen, never a normal
// Safari tab — so detect standalone (installed) mode to guide the user.
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export interface PushState {
  supported: boolean;
  // iOS Safari tab that hasn't been installed to the Home Screen yet.
  needsInstall: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  busy: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  sendTest: () => Promise<void>;
}

export function usePushNotifications(): PushState {
  const { locale } = useI18n();
  const supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window;

  const needsInstall = supported && isIos() && !isStandalone();

  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : 'denied',
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect whether this browser already has a live subscription.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!existing);
      } catch {
        // Service worker not ready / unsupported — leave as not subscribed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  // The backend renders notification copy in the locale it recorded at
  // subscribe time, so a language switch has to be pushed up — otherwise
  // completion notifications keep arriving in the previous language until the
  // user toggles push off and on again.
  const syncedLocaleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!supported || !subscribed) return;
    if (syncedLocaleRef.current === locale) return;
    let cancelled = false;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!existing || cancelled) return;
        await sendSubscription(existing, locale);
        if (!cancelled) syncedLocaleRef.current = locale;
      } catch {
        // Offline or the server rejected it — the locale re-syncs on the next
        // change or the next explicit enable().
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, subscribed, locale]);

  const enable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setError(result === 'denied' ? t('Notifications are blocked in browser settings.') : t('Notification permission was not granted.'));
        return;
      }

      const config = await getPushConfig();
      if (!config.enabled || !config.vapidPublicKey) {
        setError(config.reason || t('Push is not available on the server (is pywebpush installed?).'));
        return;
      }

      const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
      await navigator.serviceWorker.ready;

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast: the DOM lib types applicationServerKey as ArrayBufferView over
          // a plain ArrayBuffer, but our Uint8Array is typed over ArrayBufferLike.
          applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) as BufferSource,
        }));

      await sendSubscription(subscription, locale);
      syncedLocaleRef.current = locale;
      setSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to enable notifications.'));
    } finally {
      setBusy(false);
    }
  }, [supported, locale]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await removeSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      syncedLocaleRef.current = null;
      setSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to disable notifications.'));
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendTestPush();
      if (result.sent === 0) {
        setError(t('No notification was delivered. Make sure notifications are enabled on this device.'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to send test notification.'));
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported, needsInstall, permission, subscribed, busy, error, enable, disable, sendTest };
}
