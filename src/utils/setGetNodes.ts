import type { Workflow, WorkflowNode } from "@/api/types";

// KJNodes-style "wireless" relay nodes: a SetNode stores its single input under a
// name (its first widget value); a GetNode with the same name re-emits that value
// elsewhere. They carry no drawn link between the pair — they match by name — so
// they exist purely to declutter desktop wiring. On mobile we render them like
// reroutes and resolve the Set<->Get hop by name.

export function isSetNode(node: WorkflowNode): boolean {
  return node.type === "SetNode";
}

export function isGetNode(node: WorkflowNode): boolean {
  return node.type === "GetNode";
}

export function isSetGetNode(node: WorkflowNode): boolean {
  return isSetNode(node) || isGetNode(node);
}

// The shared name linking a Set/Get pair — the node's first widget value (array
// form `["name"]` or record form `{0|value|name: "name"}`).
export function getSetGetName(node: WorkflowNode): string | null {
  const values = node.widgets_values;
  if (Array.isArray(values)) {
    const value = values[0];
    return typeof value === "string" && value ? value : null;
  }
  if (values && typeof values === "object") {
    const record = values as Record<string, unknown>;
    const value = record[0] ?? record.value ?? record.name;
    return typeof value === "string" && value ? value : null;
  }
  return null;
}

// All SetNode names present in a workflow (deduped, in document order) — used to
// offer a GetNode the set of relays it can read from.
export function collectSetNodeNames(workflow: Workflow): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const node of workflow.nodes ?? []) {
    if (!isSetNode(node)) continue;
    const name = getSetGetName(node);
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
