import { useMemo } from "react";
import type { Workflow, WorkflowNode } from "@/api/types";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { usePinnedWidgetStore } from "@/hooks/usePinnedWidget";
import { getWidgetValue } from "@/utils/workflowInputs";
import type { LinkedWidgetRoute, ProxyWidgetRoute } from "@/utils/widgetDefinitions";
import { WidgetControl } from "../InputControls/WidgetControl";

// Pinned-widget node lookup needs to cover both root nodes (workflow.nodes)
// and subgraph inner nodes (workflow.definitions.subgraphs[*].nodes).
function findPinnedNode(workflow: Workflow | null | undefined, nodeId: number): WorkflowNode | undefined {
  if (!workflow) return undefined;
  const rootMatch = workflow.nodes.find((n) => n.id === nodeId);
  if (rootMatch) return rootMatch;
  for (const sg of workflow.definitions?.subgraphs ?? []) {
    const innerMatch = sg.nodes?.find((n) => n.id === nodeId);
    if (innerMatch) return innerMatch;
  }
  return undefined;
}

function extractProxyRoute(options: unknown): ProxyWidgetRoute | null {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  const proxy = (options as Record<string, unknown>).__proxy;
  if (!proxy || typeof proxy !== 'object') return null;
  const candidate = proxy as Partial<ProxyWidgetRoute>;
  if (
    typeof candidate.subgraphId === 'string' &&
    typeof candidate.innerNodeId === 'number' &&
    typeof candidate.innerWidgetIndex === 'number'
  ) {
    return candidate as ProxyWidgetRoute;
  }
  return null;
}

function extractLinkedWidgetRoute(options: unknown): LinkedWidgetRoute | null {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  const linkedSource = (options as Record<string, unknown>).__linkedSource;
  if (!linkedSource || typeof linkedSource !== 'object') return null;
  const candidate = linkedSource as Partial<LinkedWidgetRoute>;
  if (
    (typeof candidate.subgraphId === 'string' || candidate.subgraphId === null) &&
    typeof candidate.nodeId === 'number' &&
    typeof candidate.widgetIndex === 'number'
  ) {
    return candidate as LinkedWidgetRoute;
  }
  return null;
}

function findLinkedWidgetNode(
  workflow: Workflow | null | undefined,
  route: LinkedWidgetRoute,
): WorkflowNode | undefined {
  if (!workflow) return undefined;
  const nodes = route.subgraphId == null
    ? workflow.nodes
    : workflow.definitions?.subgraphs?.find((sg) => sg.id === route.subgraphId)?.nodes;
  return nodes?.find((node) =>
    node.id === route.nodeId ||
    Boolean(route.itemKey && node.itemKey === route.itemKey)
  );
}

export function PinnedWidgetOverlayModal() {
  const workflow = useWorkflowStore((s) => s.workflow);
  const pinnedWidget = usePinnedWidgetStore((s) => s.pinnedWidget);
  const pinOverlayOpen = usePinnedWidgetStore((s) => s.pinOverlayOpen);
  const togglePinOverlay = usePinnedWidgetStore((s) => s.togglePinOverlay);
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);
  const updateSubgraphInnerNodeWidget = useWorkflowStore((s) => s.updateSubgraphInnerNodeWidget);

  // Proxy widgets promoted from inner subgraph nodes onto a placeholder card
  // carry a `__proxy` route in their options. Their value lives in the inner
  // node's widgets_values (not the placeholder's), and updates must go
  // through updateSubgraphInnerNodeWidget. Both are captured at pin time.
  const proxyRoute = useMemo(
    () => (pinnedWidget ? extractProxyRoute(pinnedWidget.options) : null),
    [pinnedWidget],
  );
  const linkedWidgetRoute = useMemo(
    () => (pinnedWidget ? extractLinkedWidgetRoute(pinnedWidget.options) : null),
    [pinnedWidget],
  );

  const pinnedNode = useMemo(
    () => {
      if (!pinnedWidget) return undefined;
      if (linkedWidgetRoute) return findLinkedWidgetNode(workflow, linkedWidgetRoute);
      return findPinnedNode(workflow, pinnedWidget.nodeId);
    },
    [linkedWidgetRoute, pinnedWidget, workflow],
  );

  const pinnedWidgetValue = useMemo(() => {
    if (!pinnedWidget) return undefined;
    if (proxyRoute && workflow) {
      const sg = workflow.definitions?.subgraphs?.find((s) => s.id === proxyRoute.subgraphId);
      const innerNode = sg?.nodes?.find((n) => n.id === proxyRoute.innerNodeId);
      if (innerNode) {
        const values = Array.isArray(innerNode.widgets_values) ? innerNode.widgets_values : [];
        return values[proxyRoute.innerWidgetIndex];
      }
      return undefined;
    }
    if (linkedWidgetRoute && workflow) {
      const sourceNode = findLinkedWidgetNode(workflow, linkedWidgetRoute);
      if (!sourceNode) return undefined;
      return getWidgetValue(
        sourceNode,
        linkedWidgetRoute.widgetName ?? pinnedWidget.widgetName,
        linkedWidgetRoute.widgetIndex,
      ) ?? (
        linkedWidgetRoute.widgetIndex !== 0
          ? getWidgetValue(
              sourceNode,
              linkedWidgetRoute.widgetName ?? pinnedWidget.widgetName,
              0,
            )
          : undefined
      );
    }
    if (!pinnedNode) return undefined;
    return getWidgetValue(
      pinnedNode,
      pinnedWidget.widgetName,
      pinnedWidget.widgetIndex,
    );
  }, [linkedWidgetRoute, pinnedWidget, pinnedNode, proxyRoute, workflow]);

  if (!pinOverlayOpen || !pinnedWidget) return null;
  const pinnedNodeHierarchicalKey = pinnedNode?.itemKey ?? null;

  const handleChange = (newValue: unknown) => {
    if (proxyRoute) {
      updateSubgraphInnerNodeWidget(
        proxyRoute.subgraphId,
        proxyRoute.innerNodeId,
        proxyRoute.innerWidgetIndex,
        newValue,
      );
      return;
    }
    if (linkedWidgetRoute) {
      if (linkedWidgetRoute.subgraphId != null) {
        updateSubgraphInnerNodeWidget(
          linkedWidgetRoute.subgraphId,
          linkedWidgetRoute.nodeId,
          linkedWidgetRoute.widgetIndex,
          newValue,
        );
        return;
      }
      const sourceItemKey = linkedWidgetRoute.itemKey ?? pinnedNode?.itemKey;
      if (sourceItemKey) {
        updateNodeWidget(
          sourceItemKey,
          linkedWidgetRoute.widgetIndex,
          newValue,
          linkedWidgetRoute.widgetName ?? pinnedWidget.widgetName,
        );
      }
      return;
    }
    if (pinnedNodeHierarchicalKey) {
      updateNodeWidget(
        pinnedNodeHierarchicalKey,
        pinnedWidget.widgetIndex,
        newValue,
        pinnedWidget.widgetName,
      );
    }
  };

  return (
    <div id="pin-overlay-hidden-anchor" className="hidden">
      <WidgetControl
        name={pinnedWidget.widgetName}
        type={pinnedWidget.widgetType}
        value={pinnedWidgetValue}
        options={pinnedWidget.options}
        onChange={handleChange}
        hideLabel
        compact
        forceModalOpen={true}
        onModalClose={togglePinOverlay}
      />
    </div>
  );
}
