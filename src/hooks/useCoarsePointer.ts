/**
 * Returns true if the device has a coarse pointer (touch screen).
 * Safe for SSR - returns false on the server.
 */
export function useCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
