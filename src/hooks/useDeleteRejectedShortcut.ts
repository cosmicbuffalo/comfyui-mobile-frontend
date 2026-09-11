import { useEffect } from 'react';

interface DeleteRejectedShortcutOptions {
  /**
   * False switches the shortcut off entirely — pass the same condition that
   * decides whether the menu offers the action, so the keys can never reach for
   * something the UI is not showing.
   */
  enabled: boolean;
  /** Opens the same confirmation the menu entry does. Never deletes directly. */
  onTrigger: () => void;
}

/** True while the keystroke would be text editing rather than a command. */
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Command/Ctrl + Delete for the "delete rejected" action of whichever panel
 * mounts this.
 *
 * Not the Finder chord it started as: Shift+Command+Delete never reaches the
 * page, because Chrome claims it for Clear Browsing Data before any listener
 * sees it. Shift is accepted but no longer required, so a browser that does
 * pass the full chord through still works.
 *
 * Always routed through the panel's existing confirmation dialog rather than
 * deleting outright — all the more so now that it is one modifier — and never
 * armed while a text field has focus, where Command+Delete means delete to the
 * start of the line.
 *
 * Both delete keys count. On a Mac keyboard the key labelled Delete reports
 * `Backspace`; `Delete` is the forward-delete a full-size keyboard has, and
 * anyone pressing it means the same thing.
 */
export function useDeleteRejectedShortcut({
  enabled,
  onTrigger,
}: DeleteRejectedShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKey = (event: KeyboardEvent) => {
      const isDeleteKey = event.key === 'Backspace' || event.key === 'Delete';
      if (
        !isDeleteKey
        || !(event.metaKey || event.ctrlKey)
        || event.altKey
        || event.repeat
        || event.defaultPrevented
        || isEditingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      onTrigger();
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [enabled, onTrigger]);
}
