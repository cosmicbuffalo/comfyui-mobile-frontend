import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useHistoryStore } from '@/hooks/useHistory';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { Dialog } from '@/components/modals/Dialog';
import { QueueTopBarMenu } from './QueueTopBarMenu';

export function QueueTopBarControls() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
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
      />
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
