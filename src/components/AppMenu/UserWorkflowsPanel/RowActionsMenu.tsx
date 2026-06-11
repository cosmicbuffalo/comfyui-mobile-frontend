import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import {
  ContextMenuBuilder,
  type ContextMenuItemDefinition,
} from '@/components/menus/ContextMenuBuilder';
import { useAnchoredMenuPosition } from '@/hooks/useAnchoredMenuPosition';

/** A button that opens an anchored, portalled context menu (so it isn't clipped
 *  by the scrolling list). Shows a custom trigger icon when provided (e.g. the
 *  amber bookmark for bookmarked rows), otherwise the default `…`. */
export function RowActionsMenu({
  items,
  triggerIcon,
  ariaLabel = 'Workflow actions',
  triggerClassName = 'bg-transparent hover:bg-white/10 text-slate-400',
}: {
  items: ContextMenuItemDefinition[];
  triggerIcon?: ReactNode;
  ariaLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { menuStyle } = useAnchoredMenuPosition({
    open,
    buttonRef,
    menuRef,
    menuWidth: 180,
    horizontalAnchorOffset: 180,
  });

  const close = () => setOpen(false);
  // Wrap each action so the menu closes after it runs.
  const wrapped: ContextMenuItemDefinition[] = items.map((item) =>
    item.type === 'divider' || item.type === 'custom'
      ? item
      : {
          ...item,
          onClick: (event) => {
            item.onClick?.(event);
            close();
          },
        },
  );

  return (
    <>
      <ContextMenuButton
        buttonRef={buttonRef}
        ariaLabel={ariaLabel}
        buttonSize={9}
        icon={triggerIcon}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((o) => !o);
        }}
        className={triggerClassName}
      />
      {open &&
        createPortal(
          <>
            {/* Above the SlidePanel (z-2300) that hosts the menu. */}
            <div className="fixed inset-0 z-[2400]" onClick={close} />
            <div ref={menuRef} className="fixed z-[2401] w-44" style={menuStyle}>
              <ContextMenuBuilder items={wrapped} />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
