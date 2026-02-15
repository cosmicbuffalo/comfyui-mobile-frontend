import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Workflow, WorkflowInput, WorkflowOutput } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { findConnectedNode, findConnectedOutputNodes } from '@/utils/nodeOrdering';
import { ConnectionModal } from '@/components/modals/ConnectionModal';
import { resolveRerouteConnectionLabel } from '@/utils/rerouteLabels';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { ConnectionRow } from './ConnectionRow';

function getTypeClass(type: string): string {
  const normalizedType = String(type).split(',')[0].trim(); // Handle multi-types like "FLOAT,INT"
  const knownTypes = ['IMAGE', 'LATENT', 'MODEL', 'CLIP', 'VAE', 'CONDITIONING', 'INT', 'FLOAT', 'STRING', 'BOOLEAN', 'MASK'];

  if (knownTypes.includes(normalizedType)) {
    return `type-${normalizedType}`;
  }
  return 'type-default';
}

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
  const workflow = useWorkflowStore((s) => s.workflow);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const revealNodeWithParents = useWorkflowStore((s) => s.revealNodeWithParents);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const hiddenItems = useWorkflowStore((s) => s.hiddenItems);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right?: number; left?: number } | null>(null);
  const updatePositionRef = useRef<(() => void) | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  const resolvedLabel = useMemo(() => {
    const fallback = slot.localized_name || slot.name;
    if (!workflow) return fallback;
    return resolveRerouteConnectionLabel(workflow, nodeId, direction, fallback);
  }, [workflow, direction, slot.localized_name, slot.name, nodeId]);

  // Find connected node(s)
  const connectedNodes = useMemo(() => {
    if (!workflow) return [];
    const nodes: Workflow['nodes'] = [];
    if (direction === 'input') {
      const input = slot as WorkflowInput;
      if (input.link != null) {
        const connected = findConnectedNode(workflow, nodeId, slotIndex);
        if (connected) nodes.push(connected.node);
      }
    } else {
      const connections = findConnectedOutputNodes(workflow, nodeId, slotIndex);
      for (const conn of connections) {
        nodes.push(conn.node);
      }
    }
    return nodes;
  }, [workflow, nodeId, direction, slot, slotIndex]);

  const { effectiveNodes, directNodes, bypassedTargets } = useMemo(() => {
    if (!workflow) {
      return { effectiveNodes: [], directNodes: [], bypassedTargets: [] };
    }
    if (Object.keys(hiddenItems).length === 0) {
      return { effectiveNodes: connectedNodes, directNodes: connectedNodes, bypassedTargets: [] };
    }
    const nodeMap = new Map<number, Workflow['nodes'][number]>(
      workflow.nodes.map((node) => [node.id, node])
    );
    const isHiddenNode = (node: Workflow['nodes'][number]) =>
      Boolean(node.stableKey && hiddenItems[node.stableKey]);
    const seen = new Set<number>();
    const collectTargets = (nodeId: number): Workflow['nodes'] => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const targets: Workflow['nodes'] = [];
      node.outputs?.forEach((_, index) => {
        const connections = findConnectedOutputNodes(workflow, nodeId, index);
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
        const connected = findConnectedNode(workflow, nodeId, index);
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
  }, [connectedNodes, workflow, direction, slot.type, hiddenItems]);

  const connectionCount = effectiveNodes.length;
  const connectedNodeId = connectionCount === 1 ? effectiveNodes[0].id : null;

  const hasConnection = connectionCount > 0;
  const isEmptyRequiredInput = direction === 'input' && !hasConnection && isRequired;

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const getNodeStableKey = useCallback((targetNode: Workflow['nodes'][number]): string | null => {
    return targetNode.stableKey ?? null;
  }, []);

  const handleClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    // Empty output: open connection modal on single click.
    if (direction === 'output' && !hasConnection) {
      setConnectionModalOpen(true);
      return;
    }
    // Empty required input: open connection modal
    if (isEmptyRequiredInput) {
      setConnectionModalOpen(true);
      return;
    }
    if (!hasConnection) return;
    if (connectionCount === 1 && connectedNodeId !== null) {
      const connectedNode = effectiveNodes[0];
      const stableKey = connectedNode ? getNodeStableKey(connectedNode) : null;
      if (stableKey) {
        revealNodeWithParents(stableKey);
        scrollToNode(stableKey);
      }
      return;
    }
    setMenuOpen((prev) => !prev);
  };

  // Long-press opens connection editor: populated inputs, or any output
  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    const canOpenByLongPress = direction === 'input' ? hasConnection : true;
    if (!canOpenByLongPress) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressTriggeredRef.current = true;
      setConnectionModalOpen(true);
    }, 500);
  }, [direction, hasConnection]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (!pointerStartRef.current) return;
    const dx = event.clientX - pointerStartRef.current.x;
    const dy = event.clientY - pointerStartRef.current.y;
    if (Math.hypot(dx, dy) > 8) {
      clearLongPress();
    }
  }, [clearLongPress]);

  const handlePointerUp = useCallback(() => {
    clearLongPress();
    pointerStartRef.current = null;
  }, [clearLongPress]);

  const handleMenuNodeClick = (targetId: number) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const targetNode = effectiveNodes.find((node) => node.id === targetId);
    const stableKey = targetNode ? getNodeStableKey(targetNode) : null;
    if (stableKey) {
      revealNodeWithParents(stableKey);
      scrollToNode(stableKey);
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

  // Clean up long press on unmount
  useEffect(() => {
    return () => clearLongPress();
  }, [clearLongPress]);

  const sizeClass = compact ? 'w-7 h-7' : 'w-10 h-10';
  const arrowClass = compact ? 'text-sm' : 'text-base';

  if (!workflow) return null;

  const currentlyConnectedNodeId = direction === 'input' && hasConnection && connectedNodeId !== null
    ? connectedNodeId
    : null;
  const shouldWrapResolvedLabel = resolvedLabel.includes('/') || resolvedLabel.includes('\n');

  return (
    <div className="flex items-center gap-2">
      <ConnectionRow
        direction={direction}
        hasConnection={hasConnection}
        isEmptyRequiredInput={isEmptyRequiredInput}
        hideLabel={hideLabel}
        resolvedLabel={resolvedLabel}
        shouldWrapResolvedLabel={shouldWrapResolvedLabel}
        sizeClass={sizeClass}
        arrowClass={arrowClass}
        typeClass={getTypeClass(slot.type)}
        buttonRef={buttonRef}
        connectionCount={connectionCount}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
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
                const typeDef = nodeTypes?.[node.type];
                const label = typeDef?.display_name || node.type;
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
                      <div className="h-px flex-1 bg-gray-200" />
                      <span className="text-[10px] text-gray-400">(via bypassed)</span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>
                  </div>
                )
              },
              ...bypassedTargets.map((node) => {
                const typeDef = nodeTypes?.[node.type];
                const label = typeDef?.display_name || node.type;
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
          />
        )
      )}
    </div>
  );
});
