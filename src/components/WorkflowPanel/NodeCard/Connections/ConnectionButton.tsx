import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Workflow, WorkflowInput, WorkflowOutput } from '@/api/types';
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
  getScopedWorkflowView,
} from '@/utils/canonicalWorkflowOps';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useI18n } from '@/i18n';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';
import { useLongPress } from '@/hooks/useLongPress';
import { connectionButtonDomId } from '@/utils/connectionFlash';
import { subgraphBoundaryFoldKey } from '@/utils/subgraphBoundaryFold';
import { findConnectedNode, findConnectedOutputNodes } from '@/utils/nodeOrdering';
import { ConnectionModal } from '@/components/modals/ConnectionModal';
import { EditBoundarySlotLabelModal } from '@/components/modals/EditBoundarySlotLabelModal';
import { collectSubgraphInstances } from '@/utils/boundarySlotLabels';
import { RowActionsMenu } from '@/components/WorkflowPanel/NodeCard/RowActionsMenu';
import { ArrowDownIcon, EditIcon, NoEntryIcon } from '@/components/icons';
import { resolveRerouteConnectionLabel } from '@/utils/rerouteLabels';
import { resolveSetGetConnectionLabel } from '@/utils/setGetLabels';
import { getSetGetName, isGetNode, isSetGetNode, isSetNode } from '@/utils/setGetNodes';
import {
  getScopedUeLinkMap,
  isUseEverywhereNode,
  listUeReceivers,
  ueSlotKey,
} from '@/utils/useEverywhere';
import { resolveUseEverywhereConnectionLabel } from '@/utils/useEverywhereLabels';
import { useSetGetNameEditStore } from '@/hooks/useSetGetNameEdit';
import {
  findWorkflowNodeInScope,
  resolveSubgraphPlaceholderConnectionLabel,
  resolveWorkflowNodeDisplayName
} from '@/utils/subgraphPlaceholderLabels';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { ConnectionRow } from './ConnectionRow';
import { getTypeClass } from './slotTypeClass';
import { shouldDismissOnScroll } from '@/utils/scrollInterrupt';

function normalizeTypes(type: string): string[] {
  return String(type)
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

interface ConnectionButtonProps {
  slot: WorkflowInput | WorkflowOutput;
  nodeId: number;
  direction: 'input' | 'output';
  slotIndex: number;
  compact?: boolean;
  hideLabel?: boolean;
  isRequired?: boolean;
}

export const ConnectionButton = memo(function ConnectionButton({
  slot,
  nodeId,
  direction,
  slotIndex,
  compact = false,
  hideLabel = false,
  isRequired = false
}: ConnectionButtonProps) {
  const { t } = useI18n();
  // The store keeps the canonical workflow model in `workflow`, with root nodes
  // at the top level and nested nodes in `definitions.subgraphs`.
  const workflow = useWorkflowStore((s) => s.workflow);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const jumpToWorkflowItem = useWorkflowStore((s) => s.jumpToWorkflowItem);
  const expandConnectionsSection = useConnectionSectionFoldsStore((s) => s.expand);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const hiddenItems = useWorkflowStore((s) => s.hiddenItems);
  const moveBoundarySlot = useWorkflowStore((s) => s.moveBoundarySlot);
  const removeBoundarySlot = useWorkflowStore((s) => s.removeBoundarySlot);
  const [renamingBoundarySlot, setRenamingBoundarySlot] = useState(false);
  const topScopeFrame = scopeStack[scopeStack.length - 1];
  const currentSubgraphId = topScopeFrame?.type === 'subgraph' ? topScopeFrame.id : null;

  // When inside a subgraph scope, use the subgraph's nodes and links for connection lookups.
  const scopedWorkflow = useMemo(
    (): Workflow | null =>
      workflow ? getScopedWorkflowView(workflow, currentSubgraphId) : null,
    [workflow, currentSubgraphId],
  );

  const ownNode = useMemo(
    () => scopedWorkflow?.nodes.find((n) => n.id === nodeId) ?? null,
    [scopedWorkflow, nodeId],
  );

  // Use Everywhere feeds inputs that carry no link at all. The broadcast is a
  // real data connection, so this slot must read as connected and navigate to
  // the true upstream node — not to the Anything Everywhere node routing it.
  const ueLinks = useMemo(
    () => getScopedUeLinkMap(workflow, currentSubgraphId, scopedWorkflow),
    [workflow, currentSubgraphId, scopedWorkflow],
  );
  const ueResolution = useMemo(() => {
    if (direction !== 'input') return null;
    if ((slot as WorkflowInput).link != null) return null;
    return ueLinks.get(ueSlotKey(nodeId, slotIndex)) ?? null;
  }, [direction, slot, ueLinks, nodeId, slotIndex]);

  const isBroadcastOutput = Boolean(
    direction === 'output' && ownNode && isUseEverywhereNode(ownNode),
  );

  // Anything Everywhere slots are declared as the wildcard "*", which would paint
  // every one of them the same grey. Colour them by what is actually flowing
  // through, resolved from the link feeding the controller in THIS scope's link
  // table, so both halves of the card agree with each other and with the
  // consumers downstream. Works for either direction: the synthesized output
  // carries the controller's input index, so the lookup is the same.
  const slotTypeForColour = useMemo(() => {
    if (!ownNode || !isUseEverywhereNode(ownNode)) return slot.type;
    const linkId = ownNode.inputs?.[slotIndex]?.link;
    if (linkId == null) return slot.type;
    return scopedWorkflow?.links.find((l) => l[0] === linkId)?.[5] || slot.type;
  }, [ownNode, slot.type, slotIndex, scopedWorkflow]);

  // The other end: on an Anything Everywhere node, the synthesized output slot
  // stands for one broadcast, and its "connections" are every input the resolver
  // routed to it. There is no link table entry for any of them.
  const ueReceivers = useMemo(() => {
    if (!isBroadcastOutput) return [];
    return listUeReceivers(ueLinks, nodeId, slotIndex);
  }, [isBroadcastOutput, ueLinks, nodeId, slotIndex]);
  // A SetNode's outgoing side is jump-only: its connection is the relay name (no
  // link to create/modify here; the name is edited via the node menu). A
  // GetNode's incoming side, by contrast, IS modifiable — its long-press/empty
  // tap opens the connection modal, which lists SetNodes to read from.
  const isSetOutputRelay = useMemo(
    () => Boolean(ownNode && isSetNode(ownNode) && direction === 'output'),
    [ownNode, direction],
  );

  // Inline rename of a SetNode's relay name, triggered from the node menu: while
  // active, the outgoing connection label is swapped for an input.
  const editingItemKey = useSetGetNameEditStore((s) => s.editingItemKey);
  const stopSetGetNameEdit = useSetGetNameEditStore((s) => s.stopEdit);
  const renameSetGetNode = useWorkflowStore((s) => s.renameSetGetNode);
  const isEditingSetName =
    Boolean(ownNode) &&
    isSetNode(ownNode!) &&
    direction === 'output' &&
    editingItemKey != null &&
    ownNode!.itemKey === editingItemKey;

  // True when the slot is connected to a subgraph boundary sentinel (-10 input / -20 output).
  // These connections cross the subgraph boundary; clicking should exit the subgraph.
  const isBoundaryConnection = useMemo(() => {
    if (!scopedWorkflow) return false;
    const top = scopeStack[scopeStack.length - 1];
    if (top?.type !== 'subgraph') return false;
    if (direction === 'input') {
      const input = slot as WorkflowInput;
      if (input.link == null) return false;
      const link = scopedWorkflow.links.find((l) => l[0] === input.link);
      return link != null && link[1] === -10; // origin_id === input sentinel
    } else {
      const output = slot as WorkflowOutput;
      const linkIds = output.links ?? [];
      return linkIds.some((linkId) => {
        const link = scopedWorkflow.links.find((l) => l[0] === linkId);
        return link != null && link[3] === -20; // target_id === output sentinel
      });
    }
  }, [scopedWorkflow, scopeStack, slot, direction]);
  // Which boundary slot the connection crosses (subgraph input for an inner
  // input, subgraph output for an inner output) — so the row can NAME the
  // boundary slot instead of only showing a cyan ring, and so long-press can
  // open the boundary editor on the right slot.
  const boundarySlot = useMemo(() => {
    if (!isBoundaryConnection || !scopedWorkflow) return null;
    const top = scopeStack[scopeStack.length - 1];
    if (top?.type !== 'subgraph') return null;
    const def = workflow?.definitions?.subgraphs?.find((sg) => sg.id === top.id);
    if (!def) return null;
    if (direction === 'input') {
      const input = slot as WorkflowInput;
      const link = scopedWorkflow.links.find((l) => l[0] === input.link);
      if (!link || link[1] !== -10) return null;
      const entry = def.inputs?.[link[2]];
      return entry
        ? { index: link[2], label: entry.label || entry.localized_name || entry.name || `#${link[2]}`, type: String(entry.type ?? '*') }
        : null;
    }
    const output = slot as WorkflowOutput;
    for (const linkId of output.links ?? []) {
      const link = scopedWorkflow.links.find((l) => l[0] === linkId);
      if (link && link[3] === -20) {
        const entry = def.outputs?.[link[4]];
        return entry
          ? { index: link[4], label: entry.label || entry.localized_name || entry.name || `#${link[4]}`, type: String(entry.type ?? '*') }
          : null;
      }
    }
    return null;
  }, [isBoundaryConnection, scopedWorkflow, scopeStack, workflow, slot, direction]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right?: number; left?: number } | null>(null);
  const updatePositionRef = useRef<(() => void) | null>(null);

  /**
   * When this row belongs to a subgraph PLACEHOLDER, it is a boundary slot seen
   * from outside, and the same actions the slot list offers from inside belong
   * here. Without this, a fully-wired subgraph had no reachable rename, reorder
   * or remove at all: every one of its slots draws as a connection rather than
   * a widget, and only widgets carried a menu on the card.
   */
  const placeholderSlot = useMemo(() => {
    const node = findWorkflowNodeInScope(workflow, nodeId, currentSubgraphId);
    const definition = node
      ? workflow?.definitions?.subgraphs?.find((sg) => sg.id === node.type)
      : undefined;
    if (!node || !definition) return null;
    const slots = (direction === 'input' ? definition.inputs : definition.outputs) ?? [];
    if (slotIndex < 0 || slotIndex >= slots.length) return null;
    return {
      subgraphId: definition.id,
      instanceNodeId: node.id,
      // The boundary belongs to the TYPE, so a reorder here rearranges every
      // instance of it — including cards the user cannot see from this one.
      instanceCount: collectSubgraphInstances(workflow, definition.id).length,
      moveUpTo: slotIndex > 0 ? slotIndex - 1 : null,
      moveDownTo: slotIndex < slots.length - 1 ? slotIndex + 1 : null,
      type: String(slots[slotIndex]?.type ?? '*'),
    };
  }, [workflow, nodeId, currentSubgraphId, direction, slotIndex]);

  const resolvedLabel = useMemo(() => {
    const node = findWorkflowNodeInScope(workflow, nodeId, currentSubgraphId);
    const isSubgraphPlaceholder = Boolean(
      node &&
      workflow?.definitions?.subgraphs?.some((sg) => sg.id === node.type)
    );
    const fallback = isSubgraphPlaceholder
      ? (slot.label || slot.localized_name || slot.name)
      : (slot.localized_name || slot.name);
    const placeholderLabel = resolveSubgraphPlaceholderConnectionLabel(
      workflow,
      nodeId,
      direction,
      slotIndex,
      fallback,
      currentSubgraphId,
    );
    if (!scopedWorkflow) return placeholderLabel;
    if (node && isSetGetNode(node)) {
      return resolveSetGetConnectionLabel(scopedWorkflow, nodeId, direction, placeholderLabel);
    }
    const broadcastLabel = resolveUseEverywhereConnectionLabel(
      scopedWorkflow,
      nodeId,
      slotIndex,
      placeholderLabel,
    );
    if (broadcastLabel !== placeholderLabel) return broadcastLabel;
    return resolveRerouteConnectionLabel(scopedWorkflow, nodeId, direction, placeholderLabel);
  }, [workflow, currentSubgraphId, scopedWorkflow, direction, slot.label, slot.localized_name, slot.name, slotIndex, nodeId]);

  // Find connected node(s) using the scope-aware workflow. Set/Get relays connect
  // "wirelessly" by a shared name (no drawn link), so a SetNode's outgoing side
  // also reaches every GetNode reading its name, and a GetNode's incoming side is
  // the SetNode it reads — surfaced here so the normal jump/menu behaves the same.
  const connectedNodes = useMemo(() => {
    if (!scopedWorkflow) return [];
    const ownNode = scopedWorkflow.nodes.find((n) => n.id === nodeId);
    const nodes: Workflow['nodes'] = [];
    if (direction === 'input') {
      const input = slot as WorkflowInput;
      if (input.link != null) {
        const connected = findConnectedNode(scopedWorkflow, nodeId, slotIndex);
        if (connected) nodes.push(connected.node);
      }
      if (ownNode && isGetNode(ownNode)) {
        const getName = getSetGetName(ownNode);
        const setNode = getName
          ? scopedWorkflow.nodes.find((n) => isSetNode(n) && getSetGetName(n) === getName)
          : undefined;
        if (setNode && !nodes.some((n) => n.id === setNode.id)) nodes.push(setNode);
      }
      if (ueResolution) {
        const source = scopedWorkflow.nodes.find((n) => n.id === ueResolution.originId);
        if (source && !nodes.some((n) => n.id === source.id)) nodes.push(source);
      }
    } else {
      const connections = findConnectedOutputNodes(scopedWorkflow, nodeId, slotIndex);
      for (const conn of connections) {
        nodes.push(conn.node);
      }
      for (const receiver of ueReceivers) {
        const target = scopedWorkflow.nodes.find((n) => n.id === receiver.nodeId);
        if (target && !nodes.some((n) => n.id === target.id)) nodes.push(target);
      }
      if (ownNode && isSetNode(ownNode)) {
        const setName = getSetGetName(ownNode);
        if (setName) {
          for (const candidate of scopedWorkflow.nodes) {
            if (
              isGetNode(candidate) &&
              getSetGetName(candidate) === setName &&
              !nodes.some((n) => n.id === candidate.id)
            ) {
              nodes.push(candidate);
            }
          }
        }
      }
    }
    return nodes;
  }, [scopedWorkflow, nodeId, direction, slot, slotIndex, ueResolution, ueReceivers]);

  const { effectiveNodes, directNodes, bypassedTargets } = useMemo(() => {
    if (!scopedWorkflow) {
      return { effectiveNodes: [], directNodes: [], bypassedTargets: [] };
    }
    if (Object.keys(hiddenItems).length === 0) {
      return { effectiveNodes: connectedNodes, directNodes: connectedNodes, bypassedTargets: [] };
    }
    const nodeMap = new Map<number, Workflow['nodes'][number]>(
      scopedWorkflow.nodes.map((node) => [node.id, node])
    );
    const isHiddenNode = (node: Workflow['nodes'][number]) =>
      Boolean(node.itemKey && hiddenItems[node.itemKey]);
    const seen = new Set<number>();
    const collectTargets = (nodeId: number): Workflow['nodes'] => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const targets: Workflow['nodes'] = [];
      node.outputs?.forEach((_, index) => {
        const connections = findConnectedOutputNodes(scopedWorkflow, nodeId, index);
        connections.forEach((connection) => {
          const connectedNode = connection.node;
          if (isHiddenNode(connectedNode)) {
            targets.push(...collectTargets(connectedNode.id));
          } else {
            targets.push(connectedNode);
          }
        });
      });
      return targets;
    };
    const collectSources = (nodeId: number): Workflow['nodes'] => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const sources: Workflow['nodes'] = [];
      node.inputs?.forEach((input, index) => {
        if (input.link === null) return;
        const connected = findConnectedNode(scopedWorkflow, nodeId, index);
        if (!connected) return;
        if (isHiddenNode(connected.node)) {
          sources.push(...collectSources(connected.node.id));
        } else {
          sources.push(connected.node);
        }
      });
      return sources;
    };
    const direct: Workflow['nodes'] = [];
    const bypassed: Workflow['nodes'] = [];
    connectedNodes.forEach((node) => {
      if (isHiddenNode(node)) {
        if (direction === 'input') {
          bypassed.push(...collectSources(node.id));
        } else {
          bypassed.push(...collectTargets(node.id));
        }
      } else {
        direct.push(node);
      }
    });
    const directIds = new Set(direct.map((node) => node.id));
    const dedupe = (list: Workflow['nodes']) => {
      const unique: Workflow['nodes'] = [];
      const seenIds = new Set<number>();
      list.forEach((node) => {
        if (directIds.has(node.id) || seenIds.has(node.id)) return;
        seenIds.add(node.id);
        unique.push(node);
      });
      return unique;
    };
    let dedupedBypassed = dedupe(bypassed);
    if (direction === 'input' && dedupedBypassed.length > 1) {
      const inputTypes = new Set(normalizeTypes(slot.type));
      const matches = dedupedBypassed.filter((node) =>
        node.outputs?.some((output) =>
          normalizeTypes(output.type).some((type) => inputTypes.has(type))
        )
      );
      if (matches.length > 0) {
        dedupedBypassed = matches;
      }
    }
    return {
      effectiveNodes: [...direct, ...dedupedBypassed],
      directNodes: direct,
      bypassedTargets: dedupedBypassed
    };
  }, [connectedNodes, scopedWorkflow, direction, slot.type, hiddenItems]);

  const connectionCount = effectiveNodes.length;
  const connectedNodeId = connectionCount === 1 ? effectiveNodes[0].id : null;

  // Boundary connections cross the subgraph boundary; treat them as filled.
  const hasConnection = connectionCount > 0 || isBoundaryConnection;
  const isEmptyRequiredInput = direction === 'input' && !hasConnection && isRequired;

  const getNodeHierarchicalKey = useCallback((targetNode: Workflow['nodes'][number]): string | null => {
    return targetNode.itemKey ?? null;
  }, []);

  // The slot on the destination node that links back to this one, so we can
  // flash it after arriving. Returns null for indirect (bypassed) routes where
  // the reciprocal button isn't directly rendered.
  const resolveReciprocalConnection = useCallback((targetNodeId: number) => {
    if (!scopedWorkflow) return null;
    // Links are [id, origin_id, origin_slot, target_id, target_slot, type].
    if (direction === 'input') {
      const input = slot as WorkflowInput;
      if (input.link == null) {
        // Broadcast connections have no link to read the slot from; the resolver
        // already knows which output of the source is feeding us.
        if (ueResolution && ueResolution.originId === targetNodeId) {
          return {
            nodeId: ueResolution.originId,
            direction: 'output' as const,
            slotIndex: ueResolution.originSlot,
          };
        }
        return null;
      }
      const link = scopedWorkflow.links.find((l) => l[0] === input.link);
      if (!link || link[1] !== targetNodeId) return null;
      return { nodeId: link[1], direction: 'output' as const, slotIndex: link[2] };
    }
    const output = slot as WorkflowOutput;
    for (const linkId of output.links ?? []) {
      const link = scopedWorkflow.links.find((l) => l[0] === linkId);
      if (link && link[3] === targetNodeId) {
        return { nodeId: link[3], direction: 'input' as const, slotIndex: link[4] };
      }
    }
    // Broadcast receivers have no link either; the resolver knows which input
    // slot on the target this broadcast lands in.
    const receiver = ueReceivers.find((r) => r.nodeId === targetNodeId);
    if (receiver) {
      return { nodeId: receiver.nodeId, direction: 'input' as const, slotIndex: receiver.slotIndex };
    }
    return null;
  }, [scopedWorkflow, slot, direction, ueResolution, ueReceivers]);

  // Shared navigation: unfold the destination's connections section, reveal +
  // scroll to it, and flash the reciprocal connection button in sync with the
  // node pulse (scrollToNode fires both together as the node arrives).
  const navigateToConnectedNode = useCallback(
    (itemKey: string, targetNodeId: number | null) => {
      expandConnectionsSection(itemKey);
      const reciprocal =
        targetNodeId != null ? resolveReciprocalConnection(targetNodeId) : null;
      const flashId = reciprocal
        ? connectionButtonDomId(reciprocal.nodeId, reciprocal.direction, reciprocal.slotIndex)
        : null;
      scrollToNode(itemKey, undefined, flashId);
    },
    [expandConnectionsSection, scrollToNode, resolveReciprocalConnection],
  );

  // A promoted slot points INWARD, to the subgraph's own connections section,
  // not out to the placeholder in the parent scope. Which outer node it reaches
  // depends on which instance you are looking through, and that belongs on the
  // boundary row where the instance is chosen — following it from in here would
  // silently pick one.
  const handleBoundaryClick = useCallback(() => {
    if (!boundarySlot) return;
    const top = scopeStack[scopeStack.length - 1];
    // The section folds like any other connections section, and a folded one
    // has no button to reveal — so unfold it first, then let it render.
    if (top?.type === 'subgraph') expandConnectionsSection(subgraphBoundaryFoldKey(top.id));
    jumpToWorkflowItem({
      kind: 'boundarySlot',
      domId: connectionButtonDomId(
        direction === 'input' ? SUBGRAPH_INPUT_NODE_ID : SUBGRAPH_OUTPUT_NODE_ID,
        direction,
        boundarySlot.index,
      ),
    });
  }, [boundarySlot, direction, scopeStack, expandConnectionsSection, jumpToWorkflowItem]);

  const handleClick = () => {
    // The click that follows a hold must not also act on the tap behaviour.
    if (consumeLongPress()) return;
    // Boundary connection: exit subgraph to the placeholder node.
    if (isBoundaryConnection) {
      handleBoundaryClick();
      return;
    }
    if (!hasConnection) {
      // Wireless relays have no link to create/modify from this button.
      if (isSetOutputRelay || isBroadcastOutput) return;
      // Empty input/output: open the connection editor.
      setConnectionModalOpen(true);
      return;
    }
    if (connectionCount === 1 && connectedNodeId !== null) {
      const connectedNode = effectiveNodes[0];
      const itemKey = connectedNode ? getNodeHierarchicalKey(connectedNode) : null;
      if (itemKey) {
        navigateToConnectedNode(itemKey, connectedNode.id);
      }
      return;
    }
    setMenuOpen((prev) => !prev);
  };

  // Long-press opens connection editor: populated inputs, or any output. Wireless
  // relays (Set output / Get input) have no link to edit here, so long-press is a
  // no-op for them.
  //
  // A slot wired to the subgraph boundary opens the same editor as any other.
  // It used to open the boundary slot's own editor instead, from a time when
  // this modal could not express a sentinel link and would have orphaned it;
  // the modal reads and writes boundary wiring itself now, and the long-press
  // is a request to edit THIS node's connection, not the slot it crosses.
  const { handlers: longPressHandlers, consumeLongPress } = useLongPress({
    onLongPress: () => setConnectionModalOpen(true),
    enabled:
      !isSetOutputRelay &&
      !isBroadcastOutput &&
      (direction === 'input' ? hasConnection : true),
  });

  const handleMenuNodeClick = (targetId: number) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const targetNode = effectiveNodes.find((node) => node.id === targetId);
    const itemKey = targetNode ? getNodeHierarchicalKey(targetNode) : null;
    if (itemKey) {
      navigateToConnectedNode(itemKey, targetId);
    }
    setMenuOpen(false);
  };

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const padding = 8;
      setMenuPosition({
        top: rect.bottom + 6,
        ...(direction === 'input'
          ? { left: Math.min(rect.left, window.innerWidth - padding) }
          : { right: Math.max(padding, window.innerWidth - rect.right) })
      });
    };
    updatePositionRef.current = updatePosition;
    updatePosition();
    return () => undefined;
  }, [menuOpen, connectionCount, direction]);

  useEffect(() => {
    if (!menuOpen) return;
    const openedAt = Date.now();
    const updatePosition = () => updatePositionRef.current?.();
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current || !event.target) return;
      if (buttonRef.current?.contains(event.target as Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleScroll = (event: Event) => {
      // A fling's momentum keeps scrolling for seconds after the finger lifts,
      // which used to close this menu the instant it opened. Only a gesture
      // made after the open counts as scroll-to-dismiss.
      if (!shouldDismissOnScroll(openedAt)) return;
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [menuOpen]);

  const sizeClass = compact ? 'w-7 h-7' : 'w-10 h-10';
  const arrowClass = compact ? 'text-sm' : 'text-base';

  if (!workflow) return null;

  const currentlyConnectedNodeId = direction === 'input' && hasConnection && !isBoundaryConnection && connectedNodeId !== null
    ? connectedNodeId
    : null;
  const shouldWrapResolvedLabel = resolvedLabel.includes('/') || resolvedLabel.includes('\n');
  const buttonAriaLabel = (() => {
    if (isBoundaryConnection) {
      return t('Follow {label} outside this subgraph', { label: resolvedLabel });
    }
    if (connectionCount === 1) {
      const target = effectiveNodes[0];
      const targetLabel = target
        ? resolveWorkflowNodeDisplayName(workflow, target, nodeTypes)
        : t('connected node');
      if (ueResolution) {
        // Name the broadcast explicitly: the value arrives from `target` but is
        // routed by an Anything Everywhere node, which is not otherwise visible.
        return t('Go to {target}, broadcast to {label}', {
          target: targetLabel,
          label: resolvedLabel,
        });
      }
      if (isBroadcastOutput) {
        return t('Go to {target}, which receives this broadcast', { target: targetLabel });
      }
      return t('Go to {target} from {label}', {
        target: targetLabel,
        label: resolvedLabel,
      });
    }
    if (connectionCount > 1) {
      if (isBroadcastOutput) {
        return t('Show {count} inputs receiving this broadcast', { count: connectionCount });
      }
      return t('Show {count} connections from {label}', {
        count: connectionCount,
        label: resolvedLabel,
      });
    }
    // A broadcast output cannot be wired by hand, so never offer to connect it.
    // Reaching nothing is a normal state — a bypassed controller, or a type no
    // unconnected input wants — so name the broadcast rather than the absence.
    if (isBroadcastOutput) return t('Broadcast output: {label}', { label: resolvedLabel });
    return direction === 'input'
      ? t('Connect input {label}', { label: resolvedLabel })
      : t('Connect output {label}', { label: resolvedLabel });
  })();

  const setNameEditor = isEditingSetName ? (
    <input
      autoFocus
      type="text"
      defaultValue={ownNode ? getSetGetName(ownNode) ?? '' : ''}
      placeholder={t('set name')}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (ownNode?.itemKey) renameSetGetNode(ownNode.itemKey, event.target.value);
        stopSetGetNameEdit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') {
          event.preventDefault();
          stopSetGetNameEdit();
        }
      }}
      className="w-full rounded bg-slate-800 px-2 py-1 text-sm font-mono text-cyan-300 outline-none focus:ring-1 focus:ring-cyan-500"
    />
  ) : undefined;

  return (
    <div className="flex items-center gap-2">
      <ConnectionRow
        direction={direction}
        hasConnection={hasConnection}
        isEmptyRequiredInput={isEmptyRequiredInput}
        isBoundaryConnection={isBoundaryConnection}
        // The same condition that adds "⇠ slot" to the label: this row crosses
        // the boundary, so it names a promoted slot and carries the marker.
        isPromoted={Boolean(boundarySlot)}
        isBroadcastConnection={ueResolution != null || isBroadcastOutput}
        hideLabel={hideLabel}
        resolvedLabel={
          // Name the boundary slot the connection crosses (unless it shares
          // the inner slot's name): "clip ⇠ style" reads "fed by subgraph
          // input style", "IMAGE ⇢ result" "feeds subgraph output result".
          boundarySlot && boundarySlot.label !== resolvedLabel
            ? direction === 'input'
              ? `${resolvedLabel} ⇠ ${boundarySlot.label}`
              : `${resolvedLabel} ⇢ ${boundarySlot.label}`
            : resolvedLabel
        }
        labelEditor={setNameEditor}
        labelAdornment={
          placeholderSlot ? (
            <RowActionsMenu
              // Keyed by slot name, which a reorder leaves alone.
              menuKey={`placeholder-slot:${currentSubgraphId ?? 'root'}:${nodeId}:${direction}:${resolvedLabel}`}
              rowName={resolvedLabel}
              typeLabel={placeholderSlot.type.toUpperCase()}
              note={
                placeholderSlot.instanceCount > 1
                  ? t('Order is shared by all {count} instances', {
                      count: placeholderSlot.instanceCount,
                    })
                  : undefined
              }
              compact
              sections={{
                primary: [
                  {
                    key: 'rename',
                    label: t('Rename'),
                    icon: <EditIcon className="w-4 h-4" />,
                    onSelect: () => setRenamingBoundarySlot(true),
                  },
                  {
                    key: 'move-up',
                    label: t('Move up'),
                    icon: <ArrowDownIcon className="w-4 h-4 rotate-180" />,
                    hidden: placeholderSlot.moveUpTo === null,
                    onSelect: () => placeholderSlot.moveUpTo !== null && moveBoundarySlot(
                      direction,
                      slotIndex,
                      placeholderSlot.moveUpTo,
                      { subgraphId: placeholderSlot.subgraphId },
                    ),
                  },
                  {
                    key: 'move-down',
                    label: t('Move down'),
                    icon: <ArrowDownIcon className="w-4 h-4" />,
                    hidden: placeholderSlot.moveDownTo === null,
                    onSelect: () => placeholderSlot.moveDownTo !== null && moveBoundarySlot(
                      direction,
                      slotIndex,
                      placeholderSlot.moveDownTo,
                      { subgraphId: placeholderSlot.subgraphId },
                    ),
                  },
                ],
                secondary: [
                  {
                    key: 'remove',
                    label: direction === 'input' ? t('Remove input') : t('Remove output'),
                    icon: <NoEntryIcon className="w-4 h-4" />,
                    color: 'danger',
                    onSelect: () => removeBoundarySlot(direction, slotIndex, {
                      subgraphId: placeholderSlot.subgraphId,
                    }),
                  },
                ],
              }}
            />
          ) : undefined
        }
        shouldWrapResolvedLabel={shouldWrapResolvedLabel}
        sizeClass={sizeClass}
        arrowClass={arrowClass}
        typeClass={getTypeClass(slotTypeForColour)}
        buttonRef={buttonRef}
        buttonId={connectionButtonDomId(nodeId, direction, slotIndex)}
        ariaLabel={buttonAriaLabel}
        connectionCount={connectionCount}
        onClick={handleClick}
        {...longPressHandlers}
      />

      {menuOpen && menuPosition && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000]"
          style={{
            top: menuPosition.top,
            right: menuPosition.right,
            left: menuPosition.left,
            maxWidth: 'calc(100vw - 16px)'
          }}
        >
          <ContextMenuBuilder
            items={[
              ...directNodes.map((node) => {
                const label = resolveWorkflowNodeDisplayName(workflow, node, nodeTypes);
                return {
                  key: `direct-${node.id}`,
                  label: `${label} #${node.id}`,
                  onClick: handleMenuNodeClick(node.id)
                };
              }),
              {
                type: 'custom' as const,
                key: 'bypassed-label',
                hidden: !(directNodes.length > 0 && bypassedTargets.length > 0),
                render: (
                  <div className="px-3 py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-white/10" />
                      <span className="text-[10px] text-slate-400">{t('(via bypassed)')}</span>
                      <div className="h-px flex-1 bg-white/10" />
                    </div>
                  </div>
                )
              },
              ...bypassedTargets.map((node) => {
                const label = resolveWorkflowNodeDisplayName(workflow, node, nodeTypes);
                return {
                  key: `bypassed-${node.id}`,
                  label: `${label} #${node.id}`,
                  onClick: handleMenuNodeClick(node.id)
                };
              })
            ]}
          />
        </div>,
        document.body
      )}

      {connectionModalOpen && (
        direction === 'input' ? (
          <ConnectionModal
            mode="input"
            isOpen={connectionModalOpen}
            onClose={() => setConnectionModalOpen(false)}
            nodeId={nodeId}
            inputIndex={slotIndex}
            inputType={slot.type}
            inputName={resolvedLabel}
            currentlyConnectedNodeId={currentlyConnectedNodeId}
            originHadConnection={hasConnection}
          />
        ) : (
          <ConnectionModal
            mode="output"
            isOpen={connectionModalOpen}
            onClose={() => setConnectionModalOpen(false)}
            nodeId={nodeId}
            outputIndex={slotIndex}
            outputType={slot.type}
            outputName={resolvedLabel}
            originHadConnection={hasConnection}
          />
        )
      )}

      {renamingBoundarySlot && placeholderSlot && (
        <EditBoundarySlotLabelModal
          onClose={() => setRenamingBoundarySlot(false)}
          direction={direction}
          slotIndex={slotIndex}
          subgraphId={placeholderSlot.subgraphId}
          instanceNodeId={placeholderSlot.instanceNodeId}
        />
      )}
    </div>
  );
});
