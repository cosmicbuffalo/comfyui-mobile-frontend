import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWorkflowStore, getInputWidgetDefinitions, getWidgetDefinitions } from '@/hooks/useWorkflow';
import { orderNodesForMobile, findConnectedNode, findConnectedOutputNodes } from '@/utils/nodeOrdering';
import { NodeCard } from './NodeCard';
import { useNodeListAnchor } from '@/hooks/useNodeListAnchor';
import { DocumentIcon, EmptyWorkflowIcon } from '@/components/icons';

function normalizeTypes(type: string): string[] {
  return String(type)
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

export function NodeList({ onImageClick, active = true }: { onImageClick?: (images: Array<{ src: string; alt?: string }>, index: number) => void; active?: boolean }) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const hideStaticNodes = useWorkflowStore((s) => s.hideStaticNodes);
  const hideBypassedNodes = useWorkflowStore((s) => s.hideBypassedNodes);
  const connectionHighlightModes = useWorkflowStore((s) => s.connectionHighlightModes);
  const manuallyHiddenNodes = useWorkflowStore((s) => s.manuallyHiddenNodes);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const parentRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const orderedNodes = useMemo(() => {
    if (!workflow) return [];
    const baseOrder = orderNodesForMobile(workflow);
    if (!hideStaticNodes && !hideBypassedNodes && Object.keys(manuallyHiddenNodes).length === 0) {
      return baseOrder;
    }
    return baseOrder.filter((node) => {
      if (manuallyHiddenNodes[node.id]) return false;
      if (hideBypassedNodes && node.mode === 4) return false;
      if (!hideStaticNodes) return true;
      const widgetDefs = getWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      return widgetDefs.length > 0 || inputWidgetDefs.length > 0;
    });
  }, [workflow, hideStaticNodes, hideBypassedNodes, nodeTypes, manuallyHiddenNodes]);

  const highlightedNodeIds = useMemo(() => {
    if (!workflow) return new Set<number>();
    const activeEntries = Object.entries(connectionHighlightModes)
      .filter(([, mode]) => mode !== 'off')
      .map(([id, mode]) => ({ id: Number(id), mode }));
    if (activeEntries.length === 0) return new Set<number>();

    const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
    const highlighted = new Set<number>();
    const hasEditableInputs = (node: typeof workflow.nodes[number]) => {
      if (!hideStaticNodes) return true;
      const widgetDefs = getWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
      return widgetDefs.length > 0 || inputWidgetDefs.length > 0;
    };
    const isHiddenNode = (node: typeof workflow.nodes[number]) => (
      (hideBypassedNodes && node.mode === 4) ||
      (hideStaticNodes && !hasEditableInputs(node)) ||
      Boolean(manuallyHiddenNodes[node.id])
    );

    const collectTargets = (nodeId: number, seen: Set<number>, desiredTypes: Set<string>): Array<typeof workflow.nodes[number]> => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const targets: Array<typeof workflow.nodes[number]> = [];
      node.outputs?.forEach((output, index) => {
        const outputTypes = normalizeTypes(output.type);
        if (desiredTypes.size > 0 && !outputTypes.some((type) => desiredTypes.has(type))) return;
        const connections = findConnectedOutputNodes(workflow, nodeId, index);
        connections.forEach((connection) => {
          const connected = connection.node;
          if (isHiddenNode(connected)) {
            targets.push(...collectTargets(connected.id, seen, desiredTypes));
          } else {
            targets.push(connected);
          }
        });
      });
      return targets;
    };

    const collectSources = (nodeId: number, seen: Set<number>, desiredTypes: Set<string>): Array<typeof workflow.nodes[number]> => {
      if (seen.has(nodeId)) return [];
      seen.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return [];
      const sources: Array<typeof workflow.nodes[number]> = [];
      node.inputs?.forEach((input, index) => {
        if (input.link === null) return;
        const inputTypes = normalizeTypes(input.type);
        if (desiredTypes.size > 0 && !inputTypes.some((type) => desiredTypes.has(type))) return;
        const connected = findConnectedNode(workflow, nodeId, index);
        if (!connected) return;
        if (isHiddenNode(connected.node)) {
          sources.push(...collectSources(connected.node.id, seen, desiredTypes));
        } else {
          sources.push(connected.node);
        }
      });
      return sources;
    };

    activeEntries.forEach(({ id: activeId, mode }) => {
      const activeNode = nodeMap.get(activeId);
      if (!activeNode) return;

      if (mode === 'inputs' || mode === 'both') {
        activeNode.inputs?.forEach((input, index) => {
          if (input.link === null) return;
          const connected = findConnectedNode(workflow, activeNode.id, index);
          if (!connected) return;
          if (!isHiddenNode(connected.node)) {
            highlighted.add(connected.node.id);
            return;
          }
          const inputTypes = new Set(normalizeTypes(input.type));
          const allSources = collectSources(connected.node.id, new Set<number>(), inputTypes);
          allSources.forEach((node) => highlighted.add(node.id));
        });
      }

      if (mode === 'outputs' || mode === 'both') {
        activeNode.outputs?.forEach((output, index) => {
          const outputTypes = new Set(normalizeTypes(output.type));
          const connections = findConnectedOutputNodes(workflow, activeNode.id, index);
          connections.forEach((connection) => {
            const connected = connection.node;
            if (!isHiddenNode(connected)) {
              highlighted.add(connected.id);
              return;
            }
            const targets = collectTargets(connected.id, new Set<number>(), outputTypes);
            targets.forEach((node) => highlighted.add(node.id));
          });
        });
      }
    });

    return highlighted;
  }, [workflow, connectionHighlightModes, hideBypassedNodes, hideStaticNodes, nodeTypes, manuallyHiddenNodes]);

  const getItemKey = useCallback(
    (index: number) => orderedNodes[index]?.id ?? index,
    [orderedNodes]
  );
  const visibleSignature = useMemo(
    () => orderedNodes.map((node) => node.id).join('|'),
    [orderedNodes]
  );
  const layoutSignature = useMemo(
    () => orderedNodes.map((node) => `${node.id}:${node.flags?.collapsed ? 1 : 0}`).join('|'),
    [orderedNodes]
  );

  /* eslint-disable-next-line react-hooks/incompatible-library */
  const virtualizer = useVirtualizer({
    count: orderedNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200, // Estimated height per node card
    overscan: 3,
    getItemKey,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const virtualItemsRef = useRef(virtualItems);

  useEffect(() => {
    virtualItemsRef.current = virtualItems;
  }, [virtualItems]);

  const { resetAnchor } = useNodeListAnchor({
    active,
    parentRef,
    innerRef,
    virtualItemsRef,
    virtualItems,
    virtualizer
  });

  useLayoutEffect(() => {
    if (!parentRef.current) return;
    resetAnchor();
    // Anchor logic handled by useNodeListAnchor.
    // Don't clear virtualizer caches - measurements are keyed by node ID via getItemKey,
    // so they remain valid across filter changes. Clearing caches forces off-screen items
    // to use estimateSize (200px), causing spacing issues when actual heights differ.
    virtualizer.measure();
  }, [visibleSignature, resetAnchor, virtualizer]);

  useLayoutEffect(() => {
    if (!parentRef.current) return;
    const frame = requestAnimationFrame(() => {
      const frame2 = requestAnimationFrame(() => {
        const nodes = innerRef.current?.querySelectorAll<HTMLElement>('[data-index]');
        nodes?.forEach((node) => {
          virtualizer.measureElement(node);
        });
      });
      return () => cancelAnimationFrame(frame2);
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutSignature, virtualizer]);


  if (!workflow) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center p-8">
          <div className="flex items-center justify-center mb-4">
            <DocumentIcon className="w-10 h-10 text-gray-300" />
          </div>
          <p className="text-lg font-medium">No workflow loaded</p>
          <p className="text-sm mt-2">
            Open the menu to load a workflow
          </p>
        </div>
      </div>
    );
  }

  if (orderedNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center p-8">
          <div className="flex items-center justify-center mb-4">
            <EmptyWorkflowIcon className="w-10 h-10 text-gray-300" />
          </div>
          <p className="text-lg font-medium">Empty workflow</p>
          <p className="text-sm mt-2">
            This workflow has no nodes
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto px-4 pt-4 overscroll-contain scroll-container"
      style={{ paddingBottom: '10rem' }}
      data-node-list="true"
    >
      <div
        ref={innerRef}
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
      >
        {virtualItems.map((virtualRow) => {
          const node = orderedNodes[virtualRow.index];
          const isExecuting = executingNodeId === String(node.id);

          return (
            <div
              key={node.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`
              }}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
            >
            <NodeCard
              node={node}
              isExecuting={isExecuting}
              isConnectionHighlighted={highlightedNodeIds.has(node.id)}
              onImageClick={onImageClick}
            />
            </div>
          );
        })}
      </div>
    </div>
  );
}
