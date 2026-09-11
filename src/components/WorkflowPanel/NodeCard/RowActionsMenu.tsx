import { useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import {
  ContextMenuBuilder,
  type ContextMenuActionItem,
  type ContextMenuItemDefinition,
} from '@/components/menus/ContextMenuBuilder';
import { useAnchoredMenuPosition } from '@/hooks/useAnchoredMenuPosition';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { useI18n } from '@/i18n';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';

export interface RowMenuAction extends Omit<ContextMenuActionItem, 'onClick'> {
  onSelect?: () => void;
}

export interface RowMenuSections {
  /** What this row is and how it reads: rename, pin, reset, reorder. */
  primary: RowMenuAction[];
  /** Where its value or connection lives: promote, change form, remove. */
  secondary: RowMenuAction[];
}

interface RowActionsMenuProps {
  /**
   * Stable identity for this row, used to remember whether its menu is open
   * across a remount. Must NOT be derived from position: a reorder is exactly
   * when the row remounts and the menu would otherwise be lost.
   */
  menuKey: string;
  /** Named in the trigger's accessible label, so screen readers get the row. */
  rowName: string;
  /**
   * Drawn after the name on the heading's first line — on a placeholder, the
   * inner widget(s) this row's boundary slot drives ("⇢ seed"), so the mapping
   * can be checked without entering the scope.
   */
  rowNameAnnotation?: string;
  /**
   * Makes the heading's first line a button. On a placeholder widget row this
   * enters the subgraph instance and jumps to the inner widget the row's
   * boundary slot drives — the mapping the annotation names.
   */
  onHeadingClick?: () => void;
  /**
   * The row's data type, shown above the actions. A widget's type decides what
   * it can be wired to and what a promotion produces, and it is otherwise only
   * inferable from the control's shape — a combo of two options looks like a
   * boolean, an INT like a FLOAT.
   */
  typeLabel?: string;
  /**
   * A caution shown under the type, for menus whose actions reach further than
   * the card they were opened from.
   */
  note?: string;
  sections: RowMenuSections;
  /** Smaller trigger for the tighter rows in a connections list. */
  compact?: boolean;
  className?: string;
}

const SECTION_ORDER: Array<keyof RowMenuSections> = ['primary', 'secondary'];

/** Kept in step with the `w-52` below — 52 * 0.25rem at the default 16px root. */
const MENU_WIDTH_PX = 208;

/**
 * Overflow menu for one row — a widget under its label, or a boundary slot
 * beside its connection button.
 *
 * Both accumulated actions faster than their rows could hold: a widget gained
 * promotion on top of pop-out and pin, a slot gained reorder and remove on top
 * of rename. Each row keeps a single affordance and the actions move in here.
 * Mirrors the node card's own menu in behaviour (anchored, dismiss on outside
 * click, closes after acting) but stays separate: its sections are the ones a
 * row has, not the ones a workflow object has.
 */
export function RowActionsMenu({
  menuKey,
  rowName,
  rowNameAnnotation,
  onHeadingClick,
  typeLabel,
  note,
  sections,
  compact = false,
  className,
}: RowActionsMenuProps) {
  const { t } = useI18n();
  const open = useRowMenuStore((state) => state.openKey === menuKey);
  const setOpenKey = useRowMenuStore((state) => state.setOpenKey);
  const toggleKey = useRowMenuStore((state) => state.toggleKey);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { menuStyle, resetMenuPosition } = useAnchoredMenuPosition({
    open,
    buttonRef,
    menuRef,
    // Must match the rendered width below, or the edge clamp lets the menu hang
    // off the right of a narrow screen.
    menuWidth: MENU_WIDTH_PX,
  });

  const closeMenu = useCallback(() => {
    setOpenKey(null);
    resetMenuPosition();
  }, [resetMenuPosition, setOpenKey]);

  useDismissOnOutsideClick({
    open,
    onDismiss: closeMenu,
    triggerRef: buttonRef,
    contentRef: menuRef,
    ignoreScrollWithinContent: true,
  });

  const items = useMemo<ContextMenuItemDefinition[]>(() => {
    const result: ContextMenuItemDefinition[] = [];
    if (typeLabel) {
      result.push({
        type: 'custom',
        key: 'row-type',
        render: (
          <div className="row-actions-heading px-3 pb-1 pt-2">
            {onHeadingClick ? (
              <button
                type="button"
                className="row-actions-heading-jump block w-full truncate text-left text-xs font-medium text-slate-200 transition-colors hover:text-cyan-300"
                onClick={(event) => {
                  event.stopPropagation();
                  onHeadingClick();
                  closeMenu();
                }}
              >
                {rowName}
                {rowNameAnnotation && (
                  <span className="row-actions-mapping ml-1 font-normal text-slate-400">
                    {rowNameAnnotation}
                  </span>
                )}
              </button>
            ) : (
              <div className="truncate text-xs font-medium text-slate-200">
                {rowName}
                {rowNameAnnotation && (
                  <span className="row-actions-mapping ml-1 font-normal text-slate-400">
                    {rowNameAnnotation}
                  </span>
                )}
              </div>
            )}
            <div className="row-actions-type truncate font-mono text-[10px] uppercase tracking-wide text-slate-400">
              {typeLabel}
            </div>
            {note && (
              <div className="row-actions-note mt-1 text-[10px] leading-tight text-amber-300/80">
                {note}
              </div>
            )}
          </div>
        ),
      });
      result.push({ type: 'divider', key: 'row-type-divider' });
    }
    for (const sectionName of SECTION_ORDER) {
      const visible = sections[sectionName].filter((item) => !item.hidden);
      if (visible.length === 0) continue;
      if (result.length > 0 && sectionName !== SECTION_ORDER[0]) {
        result.push({ type: 'divider', key: `widget-menu-${sectionName}` });
      }
      for (const item of visible) {
        const { onSelect, ...definition } = item;
        result.push({
          ...definition,
          onClick: (event) => {
            event.stopPropagation();
            onSelect?.();
            closeMenu();
          },
        });
      }
    }
    return result;
  }, [closeMenu, note, onHeadingClick, rowName, rowNameAnnotation, sections, typeLabel]);

  // A heading with nothing under it is not a menu.
  if (items.every((item) => item.type === 'custom' || item.type === 'divider')) return null;

  return (
    <>
      <ContextMenuButton
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          resetMenuPosition();
          toggleKey(menuKey);
        }}
        ariaLabel={t('Actions for {name}', { name: rowName })}
        buttonRef={buttonRef}
        // Same footprint as the node header's menu button, so the two read as
        // the same control at two levels rather than two different affordances.
        // A connections row is tighter and takes the smaller one.
        buttonSize={compact ? 6 : 8}
        iconSize={compact ? 4 : 5}
        className={`row-actions-button bg-transparent text-slate-400 hover:text-cyan-300 active:scale-95 ${className ?? ''}`}
      />
      {open && createPortal(
        <div ref={menuRef} className="row-actions-menu fixed z-[1000] w-52" style={menuStyle}>
          <ContextMenuBuilder items={items} />
        </div>,
        document.body,
      )}
    </>
  );
}
