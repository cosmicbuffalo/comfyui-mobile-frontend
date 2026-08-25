import type { Workflow } from "@/api/types";

/**
 * Stable-identity signatures for a workflow node graph: structural
 * (topology-only, for duration/timing stat keys) and full-content (for
 * unsaved-changes detection). Extracted from the tail of the useWorkflow
 * store file (mirrors `./metadataNormalization`).
 */

// Cache signatures by workflow object reference. The store replaces the
// `workflow` reference on every edit, so a cache hit means "same workflow
// object" — safe to reuse. Parked tabs keep a stable reference across renders,
// so this makes the per-tab dirty check in WorkflowTabline O(1) between edits.
const signatureCache = new WeakMap<Workflow, string>();
const dirtySignatureCache = new WeakMap<Workflow, string>();

/** Structural signature: topology only (ignores widget values), used to key
 *  duration/timing stats so they aggregate across runs that differ only by
 *  seed/prompt. NOT suitable for unsaved-changes detection. */
export function getWorkflowSignature(workflow: Workflow): string {
  const cached = signatureCache.get(workflow);
  if (cached !== undefined) return cached;
  const nodes = [...workflow.nodes]
    .sort((a, b) => a.id - b.id)
    .map((node) => ({
      id: node.id,
      type: node.type,
      mode: node.mode,
      inputs: node.inputs?.map((input) => input.link ?? null) ?? [],
      outputs: node.outputs?.map((output) => output.links ?? []) ?? [],
    }));
  const signature = JSON.stringify({
    nodes,
    links: workflow.links ?? [],
  });
  signatureCache.set(workflow, signature);
  return signature;
}

/** Full content signature including widget values. Used for unsaved-changes
 *  detection so widget-only edits (prompt text, steps, cfg, seed) register. */
function getWorkflowDirtySignature(workflow: Workflow): string {
  const cached = dirtySignatureCache.get(workflow);
  if (cached !== undefined) return cached;
  const signature = JSON.stringify(workflow);
  dirtySignatureCache.set(workflow, signature);
  return signature;
}

/** Whether `workflow` has unsaved changes relative to `original`. Single source
 *  of truth for the tab `*` indicator and close/discard confirmations — must
 *  stay consistent with the structural dirty checks elsewhere in the app. */
export function isWorkflowModified(
  workflow: Workflow | null | undefined,
  original: Workflow | null | undefined,
): boolean {
  if (!workflow || !original) return false;
  return getWorkflowDirtySignature(workflow) !== getWorkflowDirtySignature(original);
}
