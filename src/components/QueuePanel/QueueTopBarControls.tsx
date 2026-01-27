import { useRef, useState } from 'react';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useHistoryStore } from '@/hooks/useHistory';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { ClearHistoryConfirmModal } from './ClearHistoryConfirmModal';
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
    closeOnScroll: false
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
      <ClearHistoryConfirmModal
        open={clearHistoryConfirmOpen}
        onClose={() => setClearHistoryConfirmOpen(false)}
        onConfirm={clearHistory}
      />
    </>
  );
}
