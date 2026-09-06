import { useCallback, useEffect, useRef } from "react";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useGenerationSettingsStore } from "@/hooks/useGenerationSettings";
import { userScrolledSince } from "@/utils/scrollInterrupt";
import { resolveFollowTargetInScope } from "@/utils/executionFollowTarget";

// Grace window right after engaging follow during which a scroll/drag is ignored,
// so the very gesture that turned follow on (a tap, or a touch that emits a stray
// touchmove) isn't immediately misread as the user scrolling away.
const ENGAGE_GRACE_MS = 1500;

/**
 * Auto-scrolls the workflow list to the currently-executing node and keeps
 * following it as execution advances — navigating into the owning subgraph
 * scope when "follow into subgraphs" is on.
 *
 * Engaged by the `workflow-follow-executing-node` window event. It disengages
 * for the rest of the run as soon as the user manually scrolls/drags (after a
 * short engage grace) — detected via the shared scrollInterrupt signal, which
 * also aborts the in-flight scrollToNode reveal so it stops fighting them. Also
 * disengages on the `workflow-stop-following-executing-node` event (the progress
 * card's dismiss button) and when execution ends.
 */
export function useExecutionFollower(visible: boolean): void {
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const executingNodePath = useWorkflowStore((s) => s.executingNodePath);
  const executingNodeHierarchicalKey = useWorkflowStore(
    (s) => s.executingNodeHierarchicalKey,
  );
  const expandedNodeIdMap = useWorkflowStore((s) => s.expandedNodeIdMap);
  const followIntoSubgraphs = useGenerationSettingsStore(
    (s) => s.followIntoSubgraphs,
  );
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const navigateToSubgraphTrail = useWorkflowStore(
    (s) => s.navigateToSubgraphTrail,
  );

  const followExecutingNodeRef = useRef(false);
  const followEngagedAtRef = useRef(0);

  const scrollToExecutingNode = useCallback(() => {
    const executionItemKey =
      executingNodeHierarchicalKey ??
      (executingNodePath ? expandedNodeIdMap[executingNodePath] : null) ??
      (executingNodeId ? expandedNodeIdMap[executingNodeId] : null) ??
      null;
    if (!executionItemKey) return false;

    const subgraphSegments = executionItemKey.match(/subgraph:([^/]+)/g);
    const executingTrail = (subgraphSegments ?? []).map((segment) =>
      segment.replace('subgraph:', ''),
    );

    if (followIntoSubgraphs) {
      if (executingTrail.length > 0) {
        navigateToSubgraphTrail(executingTrail);
      } else {
        // Executing node is at root — exit any subgraph scope
        const currentScope = useWorkflowStore.getState().scopeStack;
        if (currentScope.length > 1) {
          useWorkflowStore.getState().exitToRoot();
        }
      }
      requestAnimationFrame(() => scrollToNode(executionItemKey, "Running"));
      return true;
    }

    // Follow, but do not descend. Execution inside a subgraph is followed as far
    // as the placeholder standing for it in the scope the user is in — the run
    // is still tracked, just at the depth they chose to watch it from. Landing
    // on the inner node would take them in, which is the thing this setting
    // exists to refuse.
    const { workflow, scopeStack } = useWorkflowStore.getState();
    const target = resolveFollowTargetInScope(workflow, scopeStack, executionItemKey);
    if (!target) return false;
    requestAnimationFrame(() => scrollToNode(target, "Running"));
    return true;
  }, [
    executingNodeHierarchicalKey,
    executingNodeId,
    executingNodePath,
    expandedNodeIdMap,
    followIntoSubgraphs,
    navigateToSubgraphTrail,
    scrollToNode,
  ]);

  useEffect(() => {
    const handleFollowExecutingNode = () => {
      followExecutingNodeRef.current = true;
      followEngagedAtRef.current = Date.now();
      scrollToExecutingNode();
    };
    const handleStopFollowing = () => {
      followExecutingNodeRef.current = false;
    };

    window.addEventListener(
      "workflow-follow-executing-node",
      handleFollowExecutingNode as EventListener,
    );
    window.addEventListener(
      "workflow-stop-following-executing-node",
      handleStopFollowing as EventListener,
    );
    return () => {
      window.removeEventListener(
        "workflow-follow-executing-node",
        handleFollowExecutingNode as EventListener,
      );
      window.removeEventListener(
        "workflow-stop-following-executing-node",
        handleStopFollowing as EventListener,
      );
    };
  }, [scrollToExecutingNode]);

  useEffect(() => {
    if (!visible || !followExecutingNodeRef.current || !isExecuting) return;
    // A deliberate scroll/drag since engaging (past the grace) ends follow for
    // the rest of this run — checked before re-scrolling so we never yank the
    // user back to a new executing node after they've taken control.
    if (userScrolledSince(followEngagedAtRef.current + ENGAGE_GRACE_MS)) {
      followExecutingNodeRef.current = false;
      return;
    }
    scrollToExecutingNode();
  }, [
    executingNodeId,
    executingNodePath,
    isExecuting,
    scrollToExecutingNode,
    visible,
  ]);

  useEffect(() => {
    if (isExecuting) return;
    followExecutingNodeRef.current = false;
  }, [isExecuting]);
}
