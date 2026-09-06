import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { resolveItemReferenceAppearance, type ParentChip } from '@/utils/itemParentage';
import { findScopeTrailForPlaceholder } from '@/utils/subgraphInstanceNavigation';
import { SubgraphInstanceEntry } from '@/components/SubgraphInstanceEntry';
import { useI18n } from '@/i18n';

/** Gap kept between the open list and the edges of the screen. */
const VIEWPORT_MARGIN = 8;

interface SubgraphInstancePickerProps {
  instances: WorkflowNode[];
  currentInstanceId: number | null;
  onSelect: (placeholderNodeId: number) => void;
  /**
   * What the list hangs under. The trigger is one name inside a wider row, and
   * centring on it puts the list off to one side of the thing it belongs to —
   * so the caller points at the whole section instead.
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /**
   * The control that opens the list. Supplied by the caller so the picker can
   * hang off whatever reads naturally there — a button of its own, or the
   * instance's name inside a sentence.
   */
  renderTrigger: (trigger: {
    ref: React.RefObject<HTMLButtonElement | null>;
    onClick: () => void;
    isOpen: boolean;
    /** The entry currently in view, for the trigger to name. */
    current: InstanceEntry | undefined;
  }) => React.ReactNode;
}

export interface InstanceEntry {
  node: WorkflowNode;
  /** "Instance 2: My sampler", or without the trailing title when there is none. */
  label: string;
  parents: ParentChip[];
  surfaceColor: string;
  borderColor: string;
}

/**
 * Which instance of a shared subgraph type the boundary is being read through.
 *
 * Rendered like a bookmark entry rather than a plain list: an instance is
 * identified as much by where it sits as by its number, and two instances of
 * one type are otherwise indistinguishable. The parentage chips are display
 * only — this control picks an instance, and a chip that navigated somewhere
 * else would be a second, hidden action inside it.
 */
export function SubgraphInstancePicker({
  instances,
  currentInstanceId,
  onSelect,
  renderTrigger,
  anchorRef,
}: SubgraphInstancePickerProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const mobileLayout = useWorkflowStore((s) => s.mobileLayout);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Anchored by its centre rather than its left edge, so the list hangs
  // centred under the trigger wherever that sits — which on desktop is off to
  // one side of the column.
  const [menuPosition, setMenuPosition] = useState<
    { top: number; centerX: number; maxWidth: number } | null
  >(null);

  useDismissOnOutsideClick({
    open: menuPosition !== null,
    onDismiss: () => setMenuPosition(null),
    triggerRef,
    contentRef: listRef,
  });

  const entries = useMemo<InstanceEntry[]>(
    () =>
      instances.map((node) => {
        const number = getInstanceNumber(node);
        const base =
          number != null
            ? t('Instance {number}', { number })
            : t('Instance #{id}', { id: node.id });
        const title = typeof node.title === 'string' ? node.title.trim() : '';
        // The placeholder's own title only when it has one: without it the
        // display name falls back to the subgraph name, which would just
        // repeat the type already named beside the control.
        const trail = findScopeTrailForPlaceholder(workflow, node.id, { expectedType: node.type });
        const top = trail?.[trail.length - 1];
        const appearance = resolveItemReferenceAppearance(workflow, mobileLayout, nodeTypes, {
          nodeId: node.id,
          subgraphId: top && top.type === 'subgraph' ? top.id : null,
        });
        return {
          node,
          label: title ? `${base}: ${title}` : base,
          ...appearance,
        };
      }),
    [instances, workflow, mobileLayout, nodeTypes, t],
  );

  const current = entries.find((entry) => entry.node.id === currentInstanceId) ?? entries[0];

  const openMenu = () => {
    if (menuPosition) {
      setMenuPosition(null);
      return;
    }
    const anchor = anchorRef?.current ?? triggerRef.current;
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    // The panel, not the viewport: the list belongs to the workflow column and
    // should not sprawl across a wide window just because the window is wide.
    const panel = document.getElementById('node-list-wrapper')?.getBoundingClientRect();
    const roomInWindow = window.innerWidth - VIEWPORT_MARGIN * 2;
    setMenuPosition({
      top: rect.bottom + 4,
      centerX: rect.left + rect.width / 2,
      // Resolved to a number here rather than left as a CSS `min()`: it is two
      // measurements either way, and a plain pixel value needs no support.
      maxWidth: Math.min(panel ? panel.width * 0.8 : roomInWindow, roomInWindow),
    });
  };

  // Centring can push the list off an edge when the trigger sits near one, so
  // it is nudged back afterwards — measured once it has its natural width,
  // which is the whole point of not constraining that width to the trigger's.
  // Written straight to the node rather than through state: this is a
  // correction to a layout React has already produced, and routing it back
  // through a render would flash the uncorrected position first.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!menuPosition || !list) return;
    list.style.transform = 'translateX(-50%)';
    const rect = list.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - VIEWPORT_MARGIN);
    const overflowLeft = VIEWPORT_MARGIN - rect.left;
    const shift = overflowRight > 0 ? -overflowRight : overflowLeft > 0 ? overflowLeft : 0;
    if (shift !== 0) {
      list.style.transform = `translateX(calc(-50% + ${shift}px))`;
    }
  }, [menuPosition]);

  return (
    <>
      {renderTrigger({
        ref: triggerRef,
        onClick: openMenu,
        isOpen: menuPosition !== null,
        current,
      })}

      {menuPosition &&
        createPortal(
          <div
            ref={listRef}
            className="subgraph-instance-list fixed z-[1000] flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-lg border border-white/10 bg-slate-900/98 p-2 shadow-xl"
            style={{
              top: menuPosition.top,
              left: menuPosition.centerX,
              transform: 'translateX(-50%)',
              // As wide as its longest entry needs, rather than as narrow as
              // the name that opened it: an instance is identified by the
              // containers listed under it, and those were being wrapped away.
              width: 'max-content',
              maxWidth: `${menuPosition.maxWidth}px`,
            }}
          >
            {entries.map((entry) => (
              <SubgraphInstanceEntry
                key={entry.node.id}
                label={entry.label}
                parents={entry.parents}
                surfaceColor={entry.surfaceColor}
                borderColor={entry.borderColor}
                selected={entry.node.id === currentInstanceId}
                className="subgraph-instance-option"
                onClick={() => {
                  setMenuPosition(null);
                  if (entry.node.id !== currentInstanceId) onSelect(entry.node.id);
                }}
              />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
