import type {
  Workflow,
  WorkflowNode,
  WorkflowLink,
  WorkflowSubgraphLink,
} from "@/api/types";
import type { MobileLayout } from "@/utils/mobileLayout";
import { buildDefaultLayout } from "@/utils/mobileLayout";
import { orderNodesForMobile } from "@/utils/nodeOrdering";
import { findLayoutPath } from "@/utils/layoutTraversal";
import type { ScopedNodeIdentity } from "@/utils/workflowHierarchy";
import { dedupeScopedNodeIdentities } from "@/utils/workflowHierarchy";
import { isPowerLoraLoaderNodeType } from "@/utils/loraManager";

/**
 * Pure layout/navigation helpers over the mobile layout tree and the raw
 * workflow graph. Extracted from the useWorkflow store body so they can be
 * unit-tested without instantiating the zustand store (mirrors
 * `./metadataNormalization` — same split rationale).
 */

export type RepositionScrollTarget =
  | { type: "node"; id: number }
  | { type: "group"; id: number; subgraphId: string | null }
  | { type: "subgraph"; id: string };

export function buildLayoutForWorkflow(
  workflow: Workflow,
  hiddenItems: Record<string, boolean>,
): MobileLayout {
  return buildDefaultLayout(
    orderNodesForMobile(workflow),
    workflow,
    hiddenItems,
  );
}

interface LayoutPathToTarget {
  groupKeys: string[];
  subgraphIds: string[];
}

export function findPathToRepositionTarget(
  mobileLayout: MobileLayout,
  target: RepositionScrollTarget,
): LayoutPathToTarget | null {
  const path = findLayoutPath(mobileLayout, ({ ref, currentSubgraphId }) => {
    if (ref.type === "node" && target.type === "node") {
      return ref.id === target.id;
    }
    if (ref.type === "group" && target.type === "group") {
      return (
        target.id === ref.id &&
        (target.subgraphId ?? null) === currentSubgraphId
      );
    }
    if (ref.type === "subgraph" && target.type === "subgraph") {
      return target.id === ref.id;
    }
    return false;
  });
  if (!path) return null;
  return {
    groupKeys: path.groupKeys,
    subgraphIds: path.subgraphIds,
  };
}

export function removeNodesFromWorkflow(
  workflow: Workflow,
  nodesToRemove: ScopedNodeIdentity[],
): Workflow {
  if (nodesToRemove.length === 0) return workflow;

  const deduped = dedupeScopedNodeIdentities(nodesToRemove);
  const rootNodeIdsToRemove = new Set<number>();
  const subgraphNodeIdsToRemove = new Map<string, Set<number>>();
  for (const node of deduped) {
    if (node.subgraphId == null) {
      rootNodeIdsToRemove.add(node.nodeId);
      continue;
    }
    const scoped = subgraphNodeIdsToRemove.get(node.subgraphId) ?? new Set<number>();
    scoped.add(node.nodeId);
    subgraphNodeIdsToRemove.set(node.subgraphId, scoped);
  }

  const removeNodeIdsFromScope = <
    TLink extends WorkflowLink | WorkflowSubgraphLink,
  >(
    scopeNodes: WorkflowNode[],
    scopeLinks: TLink[],
    nodeIdsToRemoveInScope: Set<number>,
  ): { nodes: WorkflowNode[]; links: TLink[]; changed: boolean } => {
    if (nodeIdsToRemoveInScope.size === 0) {
      return { nodes: scopeNodes, links: scopeLinks, changed: false };
    }

    const linksToRemove = new Set<number>();
    for (const link of scopeLinks) {
      const originId = Array.isArray(link) ? link[1] : link.origin_id;
      const targetId = Array.isArray(link) ? link[3] : link.target_id;
      if (nodeIdsToRemoveInScope.has(originId) || nodeIdsToRemoveInScope.has(targetId)) {
        linksToRemove.add(Array.isArray(link) ? link[0] : link.id);
      }
    }

    const nextLinks = scopeLinks.filter((link) => {
      const linkId = Array.isArray(link) ? link[0] : link.id;
      return !linksToRemove.has(linkId);
    });

    const nextNodes = scopeNodes
      .filter((node) => !nodeIdsToRemoveInScope.has(node.id))
      .map((node) => {
        const nextInputs = (node.inputs ?? []).map((input) =>
          input.link != null && linksToRemove.has(input.link)
            ? { ...input, link: null }
            : input,
        );
        const nextOutputs = (node.outputs ?? []).map((output) => {
          const retained = (output.links ?? []).filter(
            (linkId) => !linksToRemove.has(linkId),
          );
          return {
            ...output,
            links: retained.length > 0 ? retained : null,
          };
        });
        return {
          ...node,
          inputs: nextInputs,
          outputs: nextOutputs,
        };
      });

    const changed =
      nextLinks.length !== scopeLinks.length ||
      nextNodes.length !== scopeNodes.length ||
      nextNodes.some((node, index) => node !== scopeNodes[index]);
    return { nodes: nextNodes, links: nextLinks, changed };
  };

  const rootResult = removeNodeIdsFromScope(
    workflow.nodes ?? [],
    workflow.links ?? [],
    rootNodeIdsToRemove,
  );

  const currentSubgraphs = workflow.definitions?.subgraphs ?? [];
  let subgraphsChanged = false;
  const nextSubgraphs = currentSubgraphs.map((subgraph) => {
    const idsToRemove = subgraphNodeIdsToRemove.get(subgraph.id);
    if (!idsToRemove || idsToRemove.size === 0) return subgraph;
    const scopedResult = removeNodeIdsFromScope(
      subgraph.nodes ?? [],
      subgraph.links ?? [],
      idsToRemove,
    );
    if (!scopedResult.changed) return subgraph;
    subgraphsChanged = true;
    return {
      ...subgraph,
      nodes: scopedResult.nodes,
      links: scopedResult.links,
    };
  });

  if (!rootResult.changed && !subgraphsChanged) {
    return workflow;
  }

  return {
    ...workflow,
    ...(rootResult.changed
      ? { nodes: rootResult.nodes, links: rootResult.links }
      : {}),
    ...(subgraphsChanged
      ? {
          definitions: {
            ...(workflow.definitions ?? {}),
            subgraphs: nextSubgraphs,
          },
        }
      : {}),
  };
}

export function updateNodeWidgetValues(
  node: WorkflowNode,
  widgetIndex: number,
  value: unknown,
  widgetName?: string,
): WorkflowNode {
  if (!Array.isArray(node.widgets_values)) {
    const nextValues = { ...(node.widgets_values || {}) } as Record<
      string,
      unknown
    >;
    if (widgetName) {
      nextValues[widgetName] = value;
      if (
        node.type === "VHS_VideoCombine" &&
        widgetName === "save_image" &&
        "save_output" in nextValues
      ) {
        nextValues.save_output = value;
      }
    } else if (widgetIndex >= 0) {
      nextValues[String(widgetIndex)] = value;
    }
    return { ...node, widgets_values: nextValues };
  }

  let newWidgetValues = [...node.widgets_values];
  if (widgetIndex >= newWidgetValues.length) {
    newWidgetValues.push(value);
  } else {
    newWidgetValues[widgetIndex] = value;
  }

  if (isPowerLoraLoaderNodeType(node.type)) {
    newWidgetValues = newWidgetValues.filter((v) => v !== null);
  }

  return { ...node, widgets_values: newWidgetValues };
}

export function updateNodeWidgetsValues(
  node: WorkflowNode,
  updates: Record<number, unknown>,
): WorkflowNode {
  if (!Array.isArray(node.widgets_values)) {
    return node;
  }
  const newWidgetValues = [...node.widgets_values];
  for (const [idxStr, value] of Object.entries(updates)) {
    const idx = parseInt(idxStr, 10);
    newWidgetValues[idx] = value;
  }
  return { ...node, widgets_values: newWidgetValues };
}
