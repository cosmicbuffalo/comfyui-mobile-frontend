import { useEffect } from 'react';

/**
 * Adds a document keydown listener (only while `enabled`) that calls `onEscape`
 * when the Escape key is pressed. Cleans up the listener on unmount or when
 * disabled.
 */
export function useEscapeKey(enabled: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [enabled, onEscape]);
}
