import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { collectAllWorkflowNodes } from '@/utils/workflowNodes';
import { isSetGetNode } from '@/utils/setGetNodes';

// Node types the mobile frontend renders/handles itself, so they are never
// "missing" even when absent from the server's object_info. Mirrors the manager's
// BUILTIN_WORKFLOW_NODE_TYPES; Set/Get are handled separately (they pass through
// as relays and are stripped from the prompt).
const HANDLED_BUILTIN_TYPES = new Set([
  'Note',
  'Reroute',
  'PrimitiveNode',
  'MarkdownNote',
  'GraphInput',
  'GraphOutput',
]);

// Reroute variants (e.g. "Reroute (rgthree)", "ReroutePrimitive|pysssss") are
// virtual passthrough nodes registered client-side by their extension, so they
// never appear in the server's object_info even when the pack is installed.
// Desktop doesn't flag them as missing, so neither do we — treat any reroute as
// handled rather than producing a false "missing node".
function isRerouteType(type: string): boolean {
  return /reroute/i.test(type);
}

// rgthree registers a family of UI-only "virtual" nodes purely client-side (no
// Python class), so they never appear in object_info even when the pack is
// installed — just like its reroute. Without this, an installed rgthree would
// still render these as red "Missing Node" cards (hiding their custom controls,
// e.g. the Fast Groups Bypasser group toggles). Real rgthree nodes that DO have
// backends (Seed, Power Lora Loader, Context, …) appear in object_info and are
// matched there, so they're unaffected.
const RGTHREE_VIRTUAL_TYPES = new Set([
  'Fast Groups Bypasser (rgthree)',
  'Fast Groups Muter (rgthree)',
  'Fast Bypasser (rgthree)',
  'Fast Muter (rgthree)',
  'Fast Actions Button (rgthree)',
  'Mute / Bypass Repeater (rgthree)',
  'Mute / Bypass Relay (rgthree)',
  'Node Collector (rgthree)',
  'Random Unmuter (rgthree)',
  'Label (rgthree)',
  'Bookmark (rgthree)',
]);


function resolvesByDisplayName(type: string, nodeTypes: NodeTypes): boolean {
  return Object.values(nodeTypes).some(
    (def) => def?.display_name === type || def?.name === type,
  );
}

/**
 * Whether a node's type is an uninstalled custom node — i.e. it has no server
 * definition (object_info) and isn't a type the frontend handles itself. Returns
 * false while nodeTypes is still null/empty (object_info not loaded yet) so we
 * never flag a whole workflow as "missing" during the initial load.
 *
 * Subgraph placeholder nodes (type === a subgraph UUID) are NOT excluded here —
 * pass `isPlaceholder` from the caller, or use collectMissingNodeTypes which
 * filters them via the workflow's subgraph ids.
 */
export function isUninstalledNodeType(
  node: WorkflowNode,
  nodeTypes: NodeTypes | null | undefined,
): boolean {
  const type = node.type;
  if (!type) return false;
  if (!nodeTypes || Object.keys(nodeTypes).length === 0) return false;
  if (nodeTypes[type]) return false;
  // The prompt builders resolve a node whose `type` is a display name rather
  // than a class name (buildPromptFromWorkflow.ts and useWorkflow's queue path
  // both fall back to matching def.display_name / def.name). Detection has to
  // agree with them, or a workflow that queues and runs perfectly gets
  // red-outlined cards plus an "Install missing nodes" jump that finds nothing.
  if (resolvesByDisplayName(type, nodeTypes)) return false;
  if (HANDLED_BUILTIN_TYPES.has(type)) return false;
  if (isRerouteType(type)) return false;
  if (RGTHREE_VIRTUAL_TYPES.has(type)) return false;
  if (isSetGetNode(node)) return false;
  return true;
}

/**
 * Unique node types in a workflow (root + subgraphs) that are not installed on
 * the server, in document order. Subgraph placeholder nodes are excluded.
 */
export function collectMissingNodeTypes(
  workflow: Workflow | null | undefined,
  nodeTypes: NodeTypes | null | undefined,
): string[] {
  if (!workflow || !nodeTypes || Object.keys(nodeTypes).length === 0) return [];
  const subgraphIds = new Set(
    workflow.definitions?.subgraphs?.map((subgraph) => subgraph.id) ?? [],
  );
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const node of collectAllWorkflowNodes(workflow)) {
    const type = node?.type;
    if (!type || seen.has(type) || subgraphIds.has(type)) continue;
    if (isUninstalledNodeType(node, nodeTypes)) {
      seen.add(type);
      missing.push(type);
    }
  }
  return missing;
}
