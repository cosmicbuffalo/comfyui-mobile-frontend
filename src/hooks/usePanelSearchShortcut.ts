import { useEffect, type RefObject } from 'react';

interface PanelSearchShortcutOptions {
  visible: boolean;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function usePanelSearchShortcut({
  visible,
  searchOpen,
  setSearchOpen,
  inputRef,
}: PanelSearchShortcutOptions) {
  useEffect(() => {
    if (!visible) return;

    const handleSearchShortcut = (event: KeyboardEvent) => {
      const isSearchShortcut =
        event.key.toLowerCase() === 'f'
        && (event.metaKey || event.ctrlKey)
        && !event.altKey
        && !event.shiftKey;
      if (!isSearchShortcut || event.defaultPrevented) return;

      event.preventDefault();
      if (searchOpen) {
        inputRef.current?.focus();
        return;
      }
      setSearchOpen(true);
    };

    document.addEventListener('keydown', handleSearchShortcut);
    return () => document.removeEventListener('keydown', handleSearchShortcut);
  }, [inputRef, searchOpen, setSearchOpen, visible]);
}
