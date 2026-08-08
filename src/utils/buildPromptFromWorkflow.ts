import type { NodeTypes, Workflow } from '@/api/types';
import { expandWorkflowSubgraphs } from '@/utils/expandWorkflowSubgraphs';
import { buildWorkflowPromptInputs, getNodeWidgetIndexMap } from '@/utils/workflowInputs';
import { isSetGetNode } from '@/utils/setGetNodes';
import { validateAndNormalizeWorkflow } from '@/utils/workflowValidator';

/**
 * Convert a canonical workflow into the ComfyUI `/api/prompt` execution map
 * (`{ [promptKey]: { class_type, inputs } }`).
 *
 * This is the same validate → expand → classify → build-inputs pipeline that
 * `queueWorkflow` runs inline (see `useWorkflow.ts`), factored out so callers
 * that aren't the active workflow panel — e.g. the outputs panel's bulk-process
 * flow — can build an executable prompt from an arbitrary workflow without
 * loading it into a session.
 *
 * Deliberately omits the two pieces of `queueWorkflow` that only make sense for
 * the in-panel workflow: seed-mode overrides (the caller leaves seeds exactly as
 * saved) and the expanded-id → itemKey progress-routing maps (`writeExpandedMaps`,
 * which feed node-progress badges back into the panel).
 */
export function buildPromptFromWorkflow(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Record<string, unknown> {
  // Repair link/slot consistency before building the prompt — the prompt is
  // built from inputs[].link, so a stale link would silently drop a branch.
  const validated = validateAndNormalizeWorkflow(workflow);

  // Expand subgraph placeholders to flat prompt keys (e.g. "50:7").
  const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(validated, nodeTypes);

  const prompt: Record<string, unknown> = {};
  const allowedNodeIds = new Set<number>();
  const classTypeById = new Map<number, string>();

  for (const node of expanded.nodes) {
    if (node.mode === 4) continue; // bypassed
    // SetNode/GetNode are virtual relays; consumers resolve through them to the
    // real source, so they never appear in the executed prompt.
    if (isSetGetNode(node)) continue;
    let classType: string | null = null;
    if (nodeTypes[node.type]) {
      classType = node.type;
    } else {
      const match = Object.entries(nodeTypes).find(
        ([, def]) => def.display_name === node.type || def.name === node.type,
      );
      if (match) classType = match[0];
    }
    if (classType) {
      allowedNodeIds.add(node.id);
      classTypeById.set(node.id, classType);
    }
  }

  for (const node of expanded.nodes) {
    if (node.mode === 4) continue;
    const classType = classTypeById.get(node.id);
    if (!classType) continue;
    const inputs = buildWorkflowPromptInputs(
      expanded,
      nodeTypes,
      node,
      classType,
      allowedNodeIds,
      getNodeWidgetIndexMap(expanded, node),
      undefined,
      promptKeyMap,
    );
    const promptKey = promptKeyMap.get(node.id) ?? String(node.id);
    prompt[promptKey] = { class_type: classType, inputs };
  }

  return prompt;
}
