import { useRef, useState } from 'react';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { OutputsTopBarMenu } from './OutputsTopBarMenu';

export function OutputsTopBarControls() {
  const [menuOpen, setMenuOpen] = useState(false);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
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
    <OutputsTopBarMenu
      open={menuOpen}
      buttonRef={buttonRef}
      menuRef={menuRef}
      onToggle={() => setMenuOpen((prev) => !prev)}
      onClose={() => setMenuOpen(false)}
      onGoToWorkflow={() => setCurrentPanel('workflow')}
    />
  );
}
