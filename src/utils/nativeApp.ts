// Detect whether the mobile frontend is running inside CueForge, the native
// iOS app. The app appends this marker to its User-Agent.
//
// In-app, notifications are handled natively — the app registers for APNs and
// pairs with the push relay automatically — so the web-push setup UI is replaced
// with a simpler "handled by the app" state. On the plain web (free tier) we
// instead show the web-push setup plus a prompt to get the app.

export const NATIVE_APP_UA_MARKER = 'CueForgeiOS';

export function isInNativeApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  return new RegExp(NATIVE_APP_UA_MARKER, 'i').test(navigator.userAgent);
}

// Public App Store listing, shown to web-only users. Null until the app ships
// (the promo card stays hidden); set to the real listing URL once the App
// Store ID exists, e.g. 'https://apps.apple.com/app/id<real-id>'.
export const APP_STORE_URL: string | null = null;
