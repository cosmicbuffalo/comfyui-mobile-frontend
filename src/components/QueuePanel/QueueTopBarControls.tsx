import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useHistoryStore } from '@/hooks/useHistory';
import { useQueueStore } from '@/hooks/useQueue';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { Dialog } from '@/components/modals/Dialog';
import { QueueTopBarMenu } from './QueueTopBarMenu';

export function QueueTopBarControls() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [cancelPendingConfirmOpen, setCancelPendingConfirmOpen] = useState(false);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const clearQueue = useQueueStore((s) => s.clearQueue);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useDismissOnOutsideClick({
    open: menuOpen,
    onDismiss: () => setMenuOpen(false),
    triggerRef: buttonRef,
    contentRef: menuRef,
  });

  return (
    <>
      <QueueTopBarMenu
        open={menuOpen}
        buttonRef={buttonRef}
        menuRef={menuRef}
        onToggle={() => setMenuOpen((prev) => !prev)}
        onClose={() => setMenuOpen(false)}
        onGoToWorkflow={() => setCurrentPanel('workflow')}
        onOpenClearHistoryConfirm={() => setClearHistoryConfirmOpen(true)}
        onOpenCancelPendingConfirm={() => setCancelPendingConfirmOpen(true)}
      />
      {cancelPendingConfirmOpen && createPortal(
        <Dialog
          onClose={() => setCancelPendingConfirmOpen(false)}
          title="Cancel all pending?"
          description="This removes every queued generation that hasn't started yet. The currently running generation keeps going."
          actions={[
            {
              label: 'Keep queue',
              onClick: () => setCancelPendingConfirmOpen(false),
              variant: 'secondary'
            },
            {
              label: 'Cancel all pending',
              onClick: () => {
                void (async () => {
                  await clearQueue();
                  setCancelPendingConfirmOpen(false);
                })();
              },
              variant: 'danger'
            }
          ]}
        />,
        document.body
      )}
      {clearHistoryConfirmOpen && createPortal(
        <Dialog
          onClose={() => setClearHistoryConfirmOpen(false)}
          title="Clear history?"
          description="This will permanently remove all completed generations from history. Generated files will still be present in your server's output folder."
          actions={[
            {
              label: 'Cancel',
              onClick: () => setClearHistoryConfirmOpen(false),
              variant: 'secondary'
            },
            {
              label: 'Clear history',
              onClick: () => {
                void (async () => {
                  await clearHistory();
                  setClearHistoryConfirmOpen(false);
                })();
              },
              variant: 'danger'
            }
          ]}
        />,
        document.body
      )}
    </>
  );
}
