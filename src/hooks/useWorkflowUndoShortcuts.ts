import { useEffect } from 'react';
import { useWorkflowUndoStore } from '@/hooks/useWorkflowUndo';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[contenteditable="true"]')) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'color', 'radio', 'range', 'reset', 'submit'].includes(
    target.type,
  );
}

export function useWorkflowUndoShortcuts(visible: boolean) {
  useEffect(() => {
    if (!visible) return;

    const handleUndoRedoShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.altKey
        || !(event.metaKey || event.ctrlKey)
        || isTypingTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo =
        (key === 'z' && event.shiftKey)
        || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey);
      if (!isUndo && !isRedo) return;

      event.preventDefault();
      const history = useWorkflowUndoStore.getState();
      if (isRedo) history.redo();
      else history.undo();
    };

    document.addEventListener('keydown', handleUndoRedoShortcut);
    return () => document.removeEventListener('keydown', handleUndoRedoShortcut);
  }, [visible]);
}
