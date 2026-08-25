import type { Workflow, WorkflowNode, NodeTypes } from "@/api/types";
import type { SeedMode } from "@/utils/seedUtils";
import {
  findSeedWidgetIndex,
  getSpecialSeedMode,
} from "@/utils/seedUtils";
import {
  resolveSubgraphBoundaryInputWidgetDefs,
  resolveSubgraphBoundaryWidgetDefs,
  resolveSubgraphPlaceholderInputWidgetDefs,
  resolveSubgraphPlaceholderWidgetDefs,
} from "@/utils/widgetDefinitions";
import { isSubgraphPlaceholder } from "@/utils/canonicalWorkflowOps";
import { collectAllWorkflowNodes } from "@/utils/workflowNodes";

/**
 * Seed-mode inference and subgraph-placeholder seed patching. Pure functions
 * over the workflow graph — extracted from the useWorkflow store body so they
 * are unit-testable without a store (mirrors `./metadataNormalization`).
 */

// Combined widget-descriptor list for a subgraph placeholder node, mirroring
// what NodeCard.tsx builds for the UI — needed so findSeedWidgetIndex (and
// findSeedControlWidgetIndex) can locate a promoted seed on a placeholder,
// whose node.type is a subgraph UUID with no entry in nodeTypes/object_info.
// Deliberately excludes proxy-promoted descriptors (resolveSubgraphProxy*).
// Their widgetIndex is offset by PROXY_INDEX_OFFSET (10000) as a sentinel
// meaning "route this through the inner node via proxyRoutes" — it is not a
// real position in this node's own widgets_values. The UI (NodeCard.tsx)
// knows to check proxyRoutes before falling back to a direct widgets_values
// read/write; the queue-time code below (processSeedNode,
// applySeedOverridesForExpansion) does not have that routing and indexes
// widgets_values directly, so an offset index here would silently read out
// of bounds and, on write, corrupt widgets_values into a huge sparse array.
export function buildSubgraphSeedWidgetDescriptors(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
) {
  const slotPromotedInput = resolveSubgraphPlaceholderInputWidgetDefs(node, workflow, nodeTypes);
  const boundaryPromotedInput = resolveSubgraphBoundaryInputWidgetDefs(node, workflow, nodeTypes);
  const slotPromoted = resolveSubgraphPlaceholderWidgetDefs(node, workflow, nodeTypes);
  const boundaryPromoted = resolveSubgraphBoundaryWidgetDefs(node, workflow, nodeTypes);
  return [
    ...slotPromotedInput,
    ...boundaryPromotedInput,
    ...slotPromoted,
    ...boundaryPromoted,
  ];
}

/**
 * Build a throwaway workflow clone with fresh seed overrides applied to
 * subgraph placeholder nodes' widgets_values, for use ONLY when expanding
 * subgraphs to build the queued prompt — never assign the result back to the
 * persisted workflow.
 *
 * Context: a subgraph placeholder's promoted seed with no real
 * control_after_generate on the boundary gets its randomized value recorded
 * in `seedOverrides` (keyed by the placeholder's own node id) rather than
 * written into its widgets_values directly — mutating it there would bake a
 * concrete number into the saved workflow and lose the "always randomize"
 * mode setting, unlike a node with a real control_after_generate widget.
 *
 * But expandWorkflowSubgraphs treats a promoted widget's value on the
 * placeholder as authoritative and pushes it down into the inner node it
 * proxies to (so user edits on the placeholder card propagate). Without this
 * patch, expansion would push the placeholder's stale saved seed right back
 * over the freshly-randomized one, silently undoing the override every time
 * a prompt is queued — the seed would never actually randomize.
 */
export function applySeedOverridesForExpansion(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  seedOverrides: Record<string, number>,
): Workflow {
  const patches: Array<{ nodeId: number; seedIndex: number; value: number }> = [];
  for (const node of workflow.nodes) {
    const override = seedOverrides[String(node.id)];
    if (override === undefined) continue;
    if (!isSubgraphPlaceholder(node, workflow)) continue;
    const descriptors = buildSubgraphSeedWidgetDescriptors(workflow, nodeTypes, node);
    const seedIndex = findSeedWidgetIndex(workflow, nodeTypes, node, {
      widgetDescriptors: descriptors,
    });
    if (seedIndex === null) continue;
    patches.push({ nodeId: node.id, seedIndex, value: override });
  }
  if (patches.length === 0) return workflow;
  const patchByNodeId = new Map(patches.map((p) => [p.nodeId, p]));
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      const patch = patchByNodeId.get(node.id);
      if (!patch || !Array.isArray(node.widgets_values)) return node;
      const newValues = [...node.widgets_values];
      newValues[patch.seedIndex] = patch.value;
      return { ...node, widgets_values: newValues };
    }),
  };
}

export function inferSeedMode(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  node: WorkflowNode,
): SeedMode {
  const validModes = ["fixed", "randomize", "increment", "decrement"];
  if (Array.isArray(node.widgets_values)) {
    const modeValue = node.widgets_values.find(
      (value) =>
        typeof value === "string" && validModes.includes(value.toLowerCase()),
    );
    if (typeof modeValue === "string") {
      const lowered = modeValue.toLowerCase();
      if (validModes.includes(lowered)) {
        return lowered as SeedMode;
      }
    }
  }

  const seedIndex = findSeedWidgetIndex(workflow, nodeTypes, node);
  if (seedIndex !== null && Array.isArray(node.widgets_values)) {
    const seedValue = Number(node.widgets_values[seedIndex]);
    const specialMode = getSpecialSeedMode(seedValue);
    if (specialMode) {
      return specialMode;
    }
    const outputs = node.outputs ?? [];
    const hasSeedOutput = outputs.some(
      (output) =>
        String(output.name || "")
          .toLowerCase()
          .includes("seed") &&
        String(output.type || "")
          .toUpperCase()
          .includes("INT"),
    );
    const trailingWidgets = node.widgets_values.slice(seedIndex + 1);
    const hasEmptyTrailingWidgets =
      trailingWidgets.length > 0 &&
      trailingWidgets.every(
        (value) => value === "" || value === null || value === undefined,
      );
    const hasSeedRangeProps =
      node.properties &&
      ("randomMin" in node.properties || "randomMax" in node.properties);
    if (hasSeedOutput && hasEmptyTrailingWidgets && hasSeedRangeProps) {
      return "randomize";
    }
  }

  return "fixed";
}

// Derive seed modes for every root + inner-subgraph node that has a seed widget.
export function deriveSeedModes(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
): Record<number, SeedMode> {
  const seedModes: Record<number, SeedMode> = {};
  if (!nodeTypes) return seedModes;
  const allNodesForSeed = collectAllWorkflowNodes(workflow);
  for (const node of allNodesForSeed) {
    const seedWidgetIndex = findSeedWidgetIndex(workflow, nodeTypes, node);
    if (seedWidgetIndex !== null) {
      seedModes[node.id] = inferSeedMode(workflow, nodeTypes, node);
    }
  }
  return seedModes;
}
