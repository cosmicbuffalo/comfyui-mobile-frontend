import { useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { DirtyConfirmModal } from './WorkflowTopBarControls/DirtyConfirmModal';
import { WorkflowTopBarMenu } from './WorkflowTopBarControls/WorkflowTopBarMenu';

type DirtyAction = 'unload' | 'clearWorkflowCache' | 'clearAllCache';

export function WorkflowTopBarControls() {
  const [menuOpenAt, setMenuOpenAt] = useState<number | null>(null);
  const [dirtyConfirmAction, setDirtyConfirmAction] = useState<DirtyAction | null>(null);
  const workflow = useWorkflowStore((s) => s.workflow);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const clearWorkflowCache = useWorkflowStore((s) => s.clearWorkflowCache);
  const unloadWorkflow = useWorkflowStore((s) => s.unloadWorkflow);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const workflowLoadedAt = useWorkflowStore((s) => s.workflowLoadedAt);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = menuOpenAt !== null && menuOpenAt === workflowLoadedAt;

  const isDirty = useMemo(
    () => Boolean(workflow && originalWorkflow && JSON.stringify(workflow) !== JSON.stringify(originalWorkflow)),
    [workflow, originalWorkflow]
  );

  useDismissOnOutsideClick({
    open: menuOpen,
    onDismiss: () => setMenuOpenAt(null),
    triggerRef: buttonRef,
    contentRef: menuRef,
    closeOnScroll: false
  });

  const clearAllCache = async () => {
    localStorage.clear();
    sessionStorage.clear();
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
    document.cookie.split(';').forEach((cookie) => {
      const [name] = cookie.split('=');
      document.cookie = `${name.trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
    window.location.reload();
  };

  const handleDirtyAction = (action: DirtyAction) => {
    if (isDirty) {
      setMenuOpenAt(null);
      setDirtyConfirmAction(action);
      return;
    }
    if (action === 'unload') {
      unloadWorkflow();
    } else if (action === 'clearWorkflowCache') {
      clearWorkflowCache();
    } else {
      clearAllCache();
    }
    setMenuOpenAt(null);
  };

  const handleDirtyConfirmContinue = async (action: DirtyAction) => {
    setDirtyConfirmAction(null);
    if (action === 'unload') {
      unloadWorkflow();
    } else if (action === 'clearWorkflowCache') {
      clearWorkflowCache();
    } else if (action === 'clearAllCache') {
      await clearAllCache();
    }
  };

  return (
    <>
      <WorkflowTopBarMenu
        open={menuOpen}
        buttonRef={buttonRef}
        menuRef={menuRef}
        onToggle={() => setMenuOpenAt(menuOpen ? null : workflowLoadedAt)}
        onClose={() => setMenuOpenAt(null)}
        onGoToQueue={() => setCurrentPanel('queue')}
        onGoToOutputs={() => setCurrentPanel('outputs')}
        onHandleDirtyAction={handleDirtyAction}
      />
      <DirtyConfirmModal
        action={dirtyConfirmAction}
        onCancel={() => setDirtyConfirmAction(null)}
        onContinue={handleDirtyConfirmContinue}
      />
    </>
  );
}
