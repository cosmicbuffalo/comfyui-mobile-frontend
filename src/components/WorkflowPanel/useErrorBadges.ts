import { useEffect, useRef, useState } from "react";

/**
 * Manages the transient per-node "error" badges shown in the workflow list.
 *
 * Listens for the `workflow-label-error-node` window event (dispatched when an
 * action wants to briefly flag a node — e.g. a failed connection) and shows a
 * label on that node for 2s, then clears it. Multiple rapid events for the same
 * node reset its timer rather than stacking. All pending timers are cleared on
 * unmount.
 *
 * Returns a map of nodeId -> badge label for the component to render.
 */
export function useErrorBadges(
  nodes: readonly { id: number }[],
  errorOrderByNodeId: ReadonlyMap<number, number>,
): Record<number, string> {
  const [errorBadgeByNodeId, setErrorBadgeByNodeId] = useState<Record<number, string>>({});
  const errorBadgeTimeoutsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const handleTemporaryLabelErrorNode = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const nodeId = typeof detail === "number" ? detail : detail.nodeId;
      const label = typeof detail === "object" ? detail.label : undefined;

      if (typeof nodeId !== "number") return;
      const nodeExists = nodes.some((node) => node.id === nodeId);
      if (!nodeExists) return;

      const errorOrder = errorOrderByNodeId.get(nodeId);
      const badgeLabel =
        label ?? (errorOrder ? `Error #${errorOrder}` : "Error");

      setErrorBadgeByNodeId((prev) => ({ ...prev, [nodeId]: badgeLabel }));
      const existingTimeout = errorBadgeTimeoutsRef.current.get(nodeId);
      if (existingTimeout) {
        window.clearTimeout(existingTimeout);
      }
      const timeoutId = window.setTimeout(() => {
        setErrorBadgeByNodeId((prev) => {
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
        errorBadgeTimeoutsRef.current.delete(nodeId);
      }, 2000);
      errorBadgeTimeoutsRef.current.set(nodeId, timeoutId);
    };

    window.addEventListener(
      "workflow-label-error-node",
      handleTemporaryLabelErrorNode as EventListener,
    );
    return () =>
      window.removeEventListener(
        "workflow-label-error-node",
        handleTemporaryLabelErrorNode as EventListener,
      );
  }, [nodes, errorOrderByNodeId]);

  useEffect(() => {
    const timeouts = errorBadgeTimeoutsRef.current;
    return () => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeouts.clear();
    };
  }, []);

  return errorBadgeByNodeId;
}
