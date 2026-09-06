import { useEffect } from 'react';

interface ShowHiddenShortcutOptions {
  enabled: boolean;
  onToggle: () => void;
}

/** Finder-style Command+Shift+Period shortcut for the active file browser. */
export function useShowHiddenShortcut({
  enabled,
  onToggle,
}: ShowHiddenShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleShowHiddenShortcut = (event: KeyboardEvent) => {
      // Shift changes KeyboardEvent.key from "." to ">" on common layouts;
      // `code` keeps identifying the physical period key in either case.
      const isPeriod = event.code === 'Period' || event.key === '.' || event.key === '>';
      if (
        !isPeriod
        || !event.metaKey
        || !event.shiftKey
        || event.ctrlKey
        || event.altKey
        || event.repeat
        || event.defaultPrevented
      ) {
        return;
      }

      event.preventDefault();
      onToggle();
    };

    document.addEventListener('keydown', handleShowHiddenShortcut);
    return () => document.removeEventListener('keydown', handleShowHiddenShortcut);
  }, [enabled, onToggle]);
}
