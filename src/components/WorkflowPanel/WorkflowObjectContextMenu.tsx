import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import {
  ContextMenuBuilder,
  type ContextMenuActionItem,
  type ContextMenuCustomItem,
  type ContextMenuItemDefinition,
} from '@/components/menus/ContextMenuBuilder';
import { useAnchoredMenuPosition } from '@/hooks/useAnchoredMenuPosition';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';

export interface WorkflowObjectMenuAction
  extends Omit<ContextMenuActionItem, 'onClick'> {
  onSelect?: () => void;
  /** Keep the menu open for expandable controls such as the widget-pin list. */
  keepOpen?: boolean;
}

export type WorkflowObjectMenuItem =
  | WorkflowObjectMenuAction
  | ContextMenuCustomItem;

export interface WorkflowObjectMenuSections {
  cosmetic: WorkflowObjectMenuItem[];
  bookmarkNavigation: WorkflowObjectMenuItem[];
  actions: WorkflowObjectMenuItem[];
  special: WorkflowObjectMenuItem[];
  delete: WorkflowObjectMenuItem[];
}

interface WorkflowObjectContextMenuProps {
  ariaLabel: string;
  sections: WorkflowObjectMenuSections;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  triggerIcon?: ReactNode;
  repositionToken?: unknown;
  onBeforeToggle?: () => void;
  onClose?: () => void;
}

const SECTION_ORDER: Array<keyof WorkflowObjectMenuSections> = [
  'cosmetic',
  'bookmarkNavigation',
  'actions',
  'special',
  'delete',
];

/**
 * Shared overflow menu for workflow objects. Callers describe capabilities in
 * the five product-level sections; this component owns ordering, separators,
 * dismissal, anchoring, and close-after-action behavior.
 */
export function WorkflowObjectContextMenu({
  ariaLabel,
  sections,
  buttonRef,
  triggerIcon,
  repositionToken,
  onBeforeToggle,
  onClose,
}: WorkflowObjectContextMenuProps) {
  const [open, setOpen] = useState(false);
  const internalButtonRef = useRef<HTMLButtonElement>(null);
  const resolvedButtonRef = buttonRef ?? internalButtonRef;
  const menuRef = useRef<HTMLDivElement>(null);

  const { menuStyle, resetMenuPosition } = useAnchoredMenuPosition({
    open,
    buttonRef: resolvedButtonRef,
    menuRef,
    repositionToken,
  });

  const closeMenu = useCallback(() => {
    setOpen(false);
    resetMenuPosition();
    onClose?.();
  }, [onClose, resetMenuPosition]);

  useDismissOnOutsideClick({
    open,
    onDismiss: closeMenu,
    triggerRef: resolvedButtonRef,
    contentRef: menuRef,
    ignoreScrollWithinContent: true,
  });

  const items = useMemo<ContextMenuItemDefinition[]>(() => {
    const result: ContextMenuItemDefinition[] = [];
    SECTION_ORDER.forEach((sectionName, sectionIndex) => {
      if (sectionIndex > 0) {
        result.push({
          type: 'divider',
          key: `workflow-object-section-${sectionName}`,
        });
      }
      for (const item of sections[sectionName]) {
        if (item.type === 'custom') {
          result.push(item);
          continue;
        }
        const { onSelect, keepOpen, ...definition } = item;
        result.push({
          ...definition,
          onClick: (event) => {
            event.stopPropagation();
            onSelect?.();
            if (!keepOpen) closeMenu();
          },
        });
      }
    });
    return result;
  }, [closeMenu, sections]);

  return (
    <>
      <ContextMenuButton
        onClick={(event) => {
          event.stopPropagation();
          onBeforeToggle?.();
          resetMenuPosition();
          setOpen((previous) => !previous);
        }}
        ariaLabel={ariaLabel}
        buttonRef={resolvedButtonRef}
        buttonSize={8}
        iconSize={5}
        icon={triggerIcon}
      />
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] w-44"
          style={menuStyle}
        >
          <ContextMenuBuilder items={items} />
        </div>,
        document.body,
      )}
    </>
  );
}
