import { useEffect, useState } from 'react';

// Width at/above which the app switches to its "desktop" form factor: roomier
// queue layout (items can fill the screen, outputs arranged in a row), no
// on-screen-keyboard scroll compensation on textarea focus, etc. Below this we
// assume a phone-like layout with a virtual keyboard.
export const DESKTOP_MIN_WIDTH = 1024;

const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

// Non-reactive check, for use inside event handlers / imperative code where a
// hook subscription isn't wanted. Defensive against environments without
// matchMedia (e.g. jsdom in tests).
export function isDesktopViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

// Reactive desktop-form-factor flag that updates on viewport resize.
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(isDesktopViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
