import { useMemo } from "react";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { usePinnedWidgetStore } from "@/hooks/usePinnedWidget";
import { getWidgetValue } from "@/utils/workflowInputs";
import { WidgetControl } from "../InputControls/WidgetControl";

export function PinnedWidgetOverlayModal() {
  const workflow = useWorkflowStore((s) => s.workflow);
  const pinnedWidget = usePinnedWidgetStore((s) => s.pinnedWidget);
  const pinOverlayOpen = usePinnedWidgetStore((s) => s.pinOverlayOpen);
  const togglePinOverlay = usePinnedWidgetStore((s) => s.togglePinOverlay);
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);

  const pinnedWidgetValue = useMemo(() => {
    if (!pinnedWidget || !workflow) return undefined;
    const node = workflow.nodes.find((n) => n.id === pinnedWidget.nodeId);
    if (!node) return undefined;
    return getWidgetValue(
      node,
      pinnedWidget.widgetName,
      pinnedWidget.widgetIndex,
    );
  }, [pinnedWidget, workflow]);

  if (!pinOverlayOpen || !pinnedWidget) return null;
  const pinnedNode = workflow?.nodes.find((n) => n.id === pinnedWidget.nodeId);
  const pinnedNodeStableKey = pinnedNode?.stableKey ?? null;

  return (
    <div id="pin-overlay-hidden-anchor" className="hidden">
      <WidgetControl
        name={pinnedWidget.widgetName}
        type={pinnedWidget.widgetType}
        value={pinnedWidgetValue}
        options={pinnedWidget.options}
        onChange={(newValue) =>
          pinnedNodeStableKey
            ? updateNodeWidget(
                pinnedNodeStableKey,
                pinnedWidget.widgetIndex,
                newValue,
                pinnedWidget.widgetName,
              )
            : undefined
        }
        hideLabel
        compact
        forceModalOpen={true}
        onModalClose={togglePinOverlay}
      />
    </div>
  );
}
