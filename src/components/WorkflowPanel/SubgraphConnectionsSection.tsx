import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';
import { useLongPress } from '@/hooks/useLongPress';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
} from '@/utils/canonicalWorkflowOps';
import { connectionButtonDomId } from '@/utils/connectionFlash';
import { subgraphBoundaryFoldKey } from '@/utils/subgraphBoundaryFold';
import {
  findWorkflowNodeInScope,
  resolveWorkflowNodeDisplayName,
} from '@/utils/subgraphPlaceholderLabels';
import {
  collectDivergentInstanceLabels,
  resolveBoundarySlotLabel,
} from '@/utils/boundarySlotLabels';
import {
  collectOuterConnections,
  type OuterConnection,
} from '@/utils/subgraphInstanceNavigation';
import { BoundaryConnectionModal } from '@/components/modals/BoundaryConnectionModal';
import { AddBoundarySlotModal } from '@/components/modals/AddBoundarySlotModal';
import { EditBoundarySlotLabelModal } from '@/components/modals/EditBoundarySlotLabelModal';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { ArrowDownIcon, EditIcon, NoEntryIcon } from '@/components/icons';
import { RowActionsMenu } from './NodeCard/RowActionsMenu';
import { Collapsible } from '@/components/Collapsible';
import { ConnectionRow } from './NodeCard/Connections/ConnectionRow';
import { ConnectionsSectionHeader } from './NodeCard/Connections/ConnectionsSectionHeader';
import { getTypeClass } from './NodeCard/Connections/slotTypeClass';
import { useI18n } from '@/i18n';

interface SubgraphConnectionsSectionProps {
  subgraphId: string;
}

/** One inner node slot a boundary slot is wired to. */
interface BoundaryEndpoint {
  nodeId: number;
  nodeKey: string;
  slotIndex: number;
  nodeName: string;
  slotLabel: string;
}

interface BoundarySlotRow {
  direction: 'input' | 'output';
  slotIndex: number;
  /** As this instance calls it: instance override, else the type's label. */
  name: string;
  type: string;
  endpoints: BoundaryEndpoint[];
  /** True when other instances of the type call this slot something else. */
  divergesFromOtherInstances: boolean;
  /** Where this slot leads outside the subgraph, per instance of the type. */
  outer: OuterConnection[];
}

/** Heading row inside a boundary slot's destination menu. */
function sectionHeading(label: string) {
  return (
    <div className="boundary-menu-heading px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
      {label}
    </div>
  );
}

/**
 * The subgraph's own input and output slots, pinned at the top of the subgraph
 * scope and laid out exactly like a node card's connections section — inputs
 * down the left, outputs down the right, the same circle buttons and fold bar.
 * It is the subgraph's own interface seen from inside, so:
 *
 * - tapping a slot follows it to the inner node it is wired to (a slot feeding
 *   several inner inputs opens the list of them first);
 * - holding a slot opens the connection picker for it.
 *
 * A subgraph input may feed many inner inputs — `linkIds` is an array in the
 * format, so the fan-out is native and needs no relay node in between.
 */
export function SubgraphConnectionsSection({ subgraphId }: SubgraphConnectionsSectionProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const expandConnectionsSection = useConnectionSectionFoldsStore((s) => s.expand);
  const setScopeTrail = useWorkflowStore((s) => s.setScopeTrail);
  const moveBoundarySlot = useWorkflowStore((s) => s.moveBoundarySlot);
  const removeBoundarySlot = useWorkflowStore((s) => s.removeBoundarySlot);
  const foldKey = subgraphBoundaryFoldKey(subgraphId);
  const expanded = useConnectionSectionFoldsStore(
    (s) => !s.collapsedItemKeys.includes(foldKey),
  );
  const toggleExpanded = useConnectionSectionFoldsStore((s) => s.toggleCollapsed);

  const [editRow, setEditRow] = useState<BoundarySlotRow | null>(null);
  const [addDirection, setAddDirection] = useState<'input' | 'output' | null>(null);
  const [labelRow, setLabelRow] = useState<BoundarySlotRow | null>(null);

  const def = useMemo(
    () => workflow?.definitions?.subgraphs?.find((sg) => sg.id === subgraphId) ?? null,
    [workflow, subgraphId],
  );

  // The instance this scope was entered through: boundary labels resolve
  // against it, so the section shows what THIS instance calls each slot.
  const currentInstance = useMemo(() => {
    const top = scopeStack[scopeStack.length - 1];
    if (top?.type !== 'subgraph') return null;
    const parentFrame = scopeStack[scopeStack.length - 2];
    const parentSubgraphId = parentFrame?.type === 'subgraph' ? parentFrame.id : null;
    return findWorkflowNodeInScope(workflow, top.placeholderNodeId, parentSubgraphId);
  }, [scopeStack, workflow]);

  const rows = useMemo<BoundarySlotRow[]>(() => {
    if (!workflow || !def) return [];
    const innerById = new Map((def.nodes ?? []).map((n) => [n.id, n]));

    const buildRows = (direction: 'input' | 'output'): BoundarySlotRow[] => {
      const slots = (direction === 'input' ? def.inputs : def.outputs) ?? [];
      return slots.map((slot, slotIndex) => {
        const endpoints: BoundaryEndpoint[] = [];
        for (const link of def.links ?? []) {
          const matches =
            direction === 'input'
              ? link.origin_id === SUBGRAPH_INPUT_NODE_ID && link.origin_slot === slotIndex
              : link.target_id === SUBGRAPH_OUTPUT_NODE_ID && link.target_slot === slotIndex;
          if (!matches) continue;
          const innerId = direction === 'input' ? link.target_id : link.origin_id;
          const innerSlot = direction === 'input' ? link.target_slot : link.origin_slot;
          const inner = innerById.get(innerId);
          if (!inner?.itemKey) continue;
          const slotEntry =
            direction === 'input' ? inner.inputs?.[innerSlot] : inner.outputs?.[innerSlot];
          endpoints.push({
            nodeId: inner.id,
            nodeKey: inner.itemKey,
            slotIndex: innerSlot,
            nodeName: resolveWorkflowNodeDisplayName(workflow, inner, nodeTypes),
            slotLabel:
              slotEntry?.label || slotEntry?.localized_name || slotEntry?.name || `#${innerSlot}`,
          });
        }
        return {
          direction,
          slotIndex,
          name: resolveBoundarySlotLabel(def, currentInstance, direction, slotIndex),
          type: String(slot.type ?? '*'),
          endpoints,
          divergesFromOtherInstances:
            collectDivergentInstanceLabels(workflow, def, currentInstance, direction, slotIndex)
              .length > 0,
          outer: collectOuterConnections(
            workflow,
            def.id,
            currentInstance?.id ?? null,
            direction,
            slotIndex,
            nodeTypes,
          ),
        };
      });
    };

    return [...buildRows('input'), ...buildRows('output')];
  }, [workflow, def, nodeTypes, currentInstance]);

  // Jump to the inner node a boundary slot is wired to, flashing the slot that
  // carries the connection — the same gesture a regular connection button has.
  const goToEndpoint = useCallback(
    (row: BoundarySlotRow, endpoint: BoundaryEndpoint) => {
      expandConnectionsSection(endpoint.nodeKey);
      scrollToNode(
        endpoint.nodeKey,
        undefined,
        connectionButtonDomId(endpoint.nodeId, row.direction, endpoint.slotIndex),
      );
    },
    [expandConnectionsSection, scrollToNode],
  );

  // Rendered even with no slots yet: the Add buttons are how an empty boundary
  // gets its first one.
  // Travel to an outer node: move the scope to the trail that instance lives
  // in, then reveal the node there. The scope change has to render first, so
  // the card exists to scroll to.
  const goToOuter = (outer: OuterConnection) => {
    setScopeTrail(outer.trail);
    setTimeout(() => {
      expandConnectionsSection(outer.outerNodeKey);
      scrollToNode(outer.outerNodeKey, undefined, null);
    }, 50);
  };

  if (!def) return null;


  const inputRows = rows.filter((row) => row.direction === 'input');
  const outputRows = rows.filter((row) => row.direction === 'output');

  const renderRow = (row: BoundarySlotRow, index: number, siblings: BoundarySlotRow[]) => (
    <BoundaryConnectionButton
      key={`${row.direction}-${row.slotIndex}`}
      row={row}
      onGoToEndpoint={(endpoint) => goToEndpoint(row, endpoint)}
      onEditConnections={() => setEditRow(row)}
      onEditLabel={() => setLabelRow(row)}
      onGoToOuter={goToOuter}
      moveUpTo={index > 0 ? siblings[index - 1].slotIndex : null}
      moveDownTo={index < siblings.length - 1 ? siblings[index + 1].slotIndex : null}
      subgraphId={subgraphId}
      onMove={(toSlot) => moveBoundarySlot(row.direction, row.slotIndex, toSlot, { subgraphId })}
      onRemove={() => removeBoundarySlot(row.direction, row.slotIndex, { subgraphId })}
    />
  );

  return (
    // Deliberately not gated on `connectionButtonsVisible`: that setting hides a
    // node's wiring as clutter, but this section IS the subgraph's interface —
    // hiding it would leave no way to reach or edit the boundary from inside.
    // Folding it away is the equivalent gesture here.
    <div
      className="subgraph-connections-section node-connections mb-3 px-1"
      data-subgraph-connections={subgraphId}
    >
      <ConnectionsSectionHeader
        hasInputs={inputRows.length > 0}
        hasOutputs={outputRows.length > 0}
        expanded={expanded}
        onToggle={() => toggleExpanded(foldKey)}
      />

      <Collapsible open={expanded}>
        <div className="grid grid-cols-2 gap-3 pt-1.5">
          <div>
            <div className="flex flex-col gap-1.5">
              {inputRows.map(renderRow)}
              {/* Trails the slots in its own column rather than sitting in a
                  row of its own: adding an input belongs with the inputs. */}
              <AddSlotButton direction="input" onClick={() => setAddDirection('input')} />
            </div>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex flex-col gap-1.5 w-full items-end">
              {outputRows.map(renderRow)}
              <AddSlotButton direction="output" onClick={() => setAddDirection('output')} />
            </div>
          </div>
        </div>
      </Collapsible>

      {addDirection && (
        <AddBoundarySlotModal
          isOpen
          onClose={() => setAddDirection(null)}
          direction={addDirection}
          subgraphId={subgraphId}
        />
      )}

      {labelRow && (
        <EditBoundarySlotLabelModal
          onClose={() => setLabelRow(null)}
          direction={labelRow.direction}
          slotIndex={labelRow.slotIndex}
          subgraphId={subgraphId}
        />
      )}

      {editRow && (
        <BoundaryConnectionModal
          isOpen
          onClose={() => setEditRow(null)}
          direction={editRow.direction}
          slotIndex={editRow.slotIndex}
          slotName={editRow.name}
          slotType={editRow.type}
        />
      )}
    </div>
  );
}

/**
 * The "add a slot" affordance at the end of a boundary column. It borrows the
 * connection button's shape so it sits with the slots, and is a plain grey disc
 * so it does not read as one of them.
 */
function AddSlotButton({
  direction,
  onClick,
}: {
  direction: 'input' | 'output';
  onClick: () => void;
}) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = direction === 'input' ? t('Add input slot') : t('Add output slot');

  return (
    <div className="flex items-center gap-2">
      <ConnectionRow
        direction={direction}
        hasConnection={false}
        isAddSlot
        hideLabel={false}
        resolvedLabel={label}
        shouldWrapResolvedLabel={false}
        sizeClass="w-10 h-10"
        arrowClass="text-base"
        typeClass=""
        buttonRef={buttonRef}
        ariaLabel={label}
        connectionCount={0}
        onClick={onClick}
      />
    </div>
  );
}

interface BoundaryConnectionButtonProps {
  row: BoundarySlotRow;
  onGoToEndpoint: (endpoint: BoundaryEndpoint) => void;
  onEditConnections: () => void;
  onEditLabel: () => void;
  onGoToOuter: (outer: OuterConnection) => void;
  /** Null at that end of this direction's list, where there is no move. */
  moveUpTo: number | null;
  moveDownTo: number | null;
  onMove: (toSlot: number) => void;
  onRemove: () => void;
  /** Names the menu's owner: two types can both have an input called "image". */
  subgraphId: string;
}

/**
 * One boundary slot, rendered through the same `ConnectionRow` the node cards
 * use so the button reads identically. A slot with more than one endpoint opens
 * the same style of menu a multiply-connected output does.
 */
function BoundaryConnectionButton({
  row,
  onGoToEndpoint,
  onEditConnections,
  onEditLabel,
  onGoToOuter,
  moveUpTo,
  moveDownTo,
  onMove,
  onRemove,
  subgraphId,
}: BoundaryConnectionButtonProps) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const { handlers, consumeLongPress } = useLongPress({ onLongPress: onEditConnections });

  useDismissOnOutsideClick({
    open: menuPosition !== null,
    onDismiss: () => setMenuPosition(null),
    triggerRef: buttonRef,
    contentRef: menuRef,
  });

  // A boundary slot leads two ways: inward to the nodes it is wired to, and
  // outward along whichever instance you are looking through. One destination
  // needs no menu; more than one does.
  const destinationCount = row.endpoints.length + row.outer.length;

  const handleClick = () => {
    // The click that follows a hold must not also act on the tap behaviour.
    if (consumeLongPress()) return;
    if (row.endpoints.length === 0) {
      // Nothing is wired to this slot on the inside, so there is nothing to
      // follow within the subgraph. A slot fed from outside still has an outer
      // destination, but travelling to it would leave the scope the slot
      // belongs to in order to show a connection the slot does not yet have
      // here — so the tap offers the picker that can wire the inside instead.
      onEditConnections();
      return;
    }
    if (destinationCount === 1) {
      onGoToEndpoint(row.endpoints[0]);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    setMenuPosition(
      menuPosition ? null : { top: (rect?.bottom ?? 0) + 4, left: rect?.left ?? 0 },
    );
  };

  const currentOuter = row.outer.filter((outer) => outer.isCurrentInstance);
  const otherOuter = row.outer.filter((outer) => !outer.isCurrentInstance);

  const menuItems = [
    ...(row.endpoints.length > 0
      ? [{ type: 'custom' as const, key: 'inside-heading', render: sectionHeading(t('In this subgraph')) }]
      : []),
    ...row.endpoints.map((endpoint) => ({
      key: `in-${endpoint.nodeId}:${endpoint.slotIndex}`,
      label: `${endpoint.nodeName} · ${endpoint.slotLabel}`,
      onClick: () => {
        setMenuPosition(null);
        onGoToEndpoint(endpoint);
      },
    })),
    ...(currentOuter.length > 0
      ? [{ type: 'custom' as const, key: 'this-heading', render: sectionHeading(t('Connected to this instance')) }]
      : []),
    ...currentOuter.map((outer, index) => ({
      key: `this-${outer.outerNodeId}-${index}`,
      label: outer.outerNodeName,
      onClick: () => {
        setMenuPosition(null);
        onGoToOuter(outer);
      },
    })),
    ...(otherOuter.length > 0
      ? [{ type: 'custom' as const, key: 'other-heading', render: sectionHeading(t('Connected to other instances')) }]
      : []),
    ...otherOuter.map((outer, index) => ({
      key: `other-${outer.instanceNodeId}-${outer.outerNodeId}-${index}`,
      label: `${outer.instanceLabel} — ${outer.outerNodeName}`,
      onClick: () => {
        setMenuPosition(null);
        onGoToOuter(outer);
      },
    })),
  ];

  // Branch on the same counts the click handler uses: no inner endpoint opens
  // the connection picker whatever the outer count, one total destination
  // navigates, more than one opens the destination menu. Announcing "Go to"
  // for a tap that opens a menu tells a screen-reader user the wrong thing.
  const ariaLabel =
    row.endpoints.length === 0
      ? row.direction === 'input'
        ? t('Connect subgraph input {label}', { label: row.name })
        : t('Connect subgraph output {label}', { label: row.name })
      : destinationCount === 1
        ? t('Go to {target} from {label}', {
            target: row.endpoints[0].nodeName,
            label: row.name,
          })
        : t('Show {count} connections from {label}', {
            count: destinationCount,
            label: row.name,
          });

  // One affordance beside the label, holding everything a slot can do: the
  // rename that used to be the whole button, plus reordering and removal, which
  // had no home at all before.
  const slotMenu = (
    <RowActionsMenu
      // Keyed by slot NAME, which a reorder leaves alone — the index does not —
      // and by the subgraph, since two types can both have an input called
      // "image".
      menuKey={`slot:${subgraphId}:${row.direction}:${row.name}`}
      rowName={row.name}
      typeLabel={String(row.type ?? '*').toUpperCase()}
      // The fuchsia tint used to be explained by the pencil's tooltip. Icons
      // and colour alone say nothing to a screen reader, so the menu says it.
      note={
        row.divergesFromOtherInstances
          ? t('Other instances call this slot something else')
          : undefined
      }
      compact
      className={row.divergesFromOtherInstances ? 'text-fuchsia-400 hover:text-fuchsia-300' : ''}
      sections={{
        primary: [
          {
            key: 'rename',
            label: t('Rename'),
            icon: <EditIcon className="w-4 h-4" />,
            onSelect: onEditLabel,
          },
          {
            key: 'move-up',
            label: t('Move up'),
            icon: <ArrowDownIcon className="w-4 h-4 rotate-180" />,
            hidden: moveUpTo === null,
            onSelect: () => moveUpTo !== null && onMove(moveUpTo),
          },
          {
            key: 'move-down',
            label: t('Move down'),
            icon: <ArrowDownIcon className="w-4 h-4" />,
            hidden: moveDownTo === null,
            onSelect: () => moveDownTo !== null && onMove(moveDownTo),
          },
        ],
        secondary: [
          {
            key: 'remove',
            label: row.direction === 'input' ? t('Remove input') : t('Remove output'),
            icon: <NoEntryIcon className="w-4 h-4" />,
            color: 'danger',
            onSelect: onRemove,
          },
        ],
      }}
    />
  );

  return (
    <div className="flex items-center gap-2">
      <ConnectionRow
        direction={row.direction}
        hasConnection={row.endpoints.length > 0}
        // The boundary ring is what marks these as crossing the subgraph edge,
        // matching the inner slots that carry the other half of the connection.
        isBoundaryConnection
        hideLabel={false}
        resolvedLabel={row.name}
        shouldWrapResolvedLabel={row.name.includes('/') || row.name.includes('\n')}
        sizeClass="w-10 h-10"
        arrowClass="text-base"
        typeClass={getTypeClass(row.type)}
        buttonRef={buttonRef}
        buttonId={connectionButtonDomId(
          row.direction === 'input' ? SUBGRAPH_INPUT_NODE_ID : SUBGRAPH_OUTPUT_NODE_ID,
          row.direction,
          row.slotIndex,
        )}
        ariaLabel={ariaLabel}
        connectionCount={row.endpoints.length}
        labelAdornment={slotMenu}
        onClick={handleClick}
        {...handlers}
      />

      {menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000]"
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              maxWidth: 'calc(100vw - 16px)',
            }}
          >
            <ContextMenuBuilder items={menuItems} />
          </div>,
          document.body,
        )}
    </div>
  );
}
