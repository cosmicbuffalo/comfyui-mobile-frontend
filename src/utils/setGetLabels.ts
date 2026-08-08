import type { Workflow, WorkflowNode } from "@/api/types";
import { getSetGetName, isGetNode, isSetNode } from "@/utils/setGetNodes";

// The output-slot label of whatever feeds a SetNode's single input (the value it
// stores) — following the link to the source node's output name.
function upstreamSourceLabel(workflow: Workflow, setNode: WorkflowNode | undefined): string | null {
  const inputLink = setNode?.inputs?.[0]?.link;
  if (inputLink == null) return null;
  const link = workflow.links.find((l) => l[0] === inputLink);
  if (!link) return null;
  const source = workflow.nodes.find((n) => n.id === link[1]);
  const outputSlot = source?.outputs[link[2]];
  return outputSlot?.localized_name || outputSlot?.name || null;
}

/**
 * Connection-button label for a Set/Get relay, resolved through the wireless
 * name hop so it shows what actually flows through (like reroute labels do).
 * Returns `fallback` for non-Set/Get nodes or when nothing resolves.
 */
export function resolveSetGetConnectionLabel(
  workflow: Workflow,
  nodeId: number,
  direction: "input" | "output",
  fallback: string,
): string {
  const node = workflow.nodes.find((n) => n.id === nodeId);
  if (!node) return fallback;

  if (isSetNode(node)) {
    // The OUTGOING side carries the relay name (what the Gets read); the incoming
    // side names its source.
    if (direction === "output") return getSetGetName(node) ?? fallback;
    return upstreamSourceLabel(workflow, node) ?? fallback;
  }

  if (isGetNode(node)) {
    const name = getSetGetName(node);
    if (!name) return fallback;
    // The INCOMING (synthesized) side carries the relay name it reads; the
    // outgoing side names the underlying value (its Set's source).
    if (direction === "input") return name;
    const setNode = workflow.nodes.find(
      (n) => isSetNode(n) && getSetGetName(n) === name,
    );
    return upstreamSourceLabel(workflow, setNode) ?? fallback;
  }

  return fallback;
}
