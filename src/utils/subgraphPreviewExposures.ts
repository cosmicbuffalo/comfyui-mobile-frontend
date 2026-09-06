import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';

/**
 * Subgraph preview exposures — ComfyUI >= 1.49's `properties.previewExposures`.
 *
 * A subgraph placeholder can adopt the preview of one node inside it, so the
 * collapsed card shows a result instead of nothing. Desktop stores that as
 * `[{ name, sourceNodeId, sourcePreviewName }]` on the placeholder and walks it
 * downwards to the producing node (`previewExposureChain.ts`).
 *
 * We need the inverse: an output arrives addressed to the inner node's prompt
 * key ("30:3"), and we want to know which placeholder cards should mirror it.
 * Without this the result only ever lands on the inner node's card, which the
 * user cannot see until they navigate into the subgraph — the root-level
 * placeholder stays blank for the whole run.
 */

interface PreviewExposure {
  name?: string;
  sourceNodeId?: string | number;
  sourcePreviewName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPreviewExposures(node: WorkflowNode): PreviewExposure[] {
  const raw = (node.properties as Record<string, unknown> | undefined)?.previewExposures;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord) as PreviewExposure[];
}

function exposesSource(node: WorkflowNode, sourceNodeId: string): boolean {
  return readPreviewExposures(node).some(
    (exposure) => String(exposure.sourceNodeId) === sourceNodeId,
  );
}

/** The canonical itemKey for a node, deriving one when the scope was never opened. */
function keyForNode(node: WorkflowNode, containingSubgraphId: string | null): string | null {
  if (node.itemKey) return node.itemKey;
  if (containingSubgraphId === null) return null;
  return `root/subgraph:${containingSubgraphId}/node:${node.id}`;
}

/**
 * Placeholder itemKeys that should mirror the output of the node addressed by
 * `promptKey` ("30:3", or "30:60:3" when nested).
 *
 * Walks outwards from the innermost placeholder: each level mirrors only while
 * the level above it also exposes the level below, matching how desktop chains
 * an exposure up through nested subgraphs.
 */
export function resolvePreviewExposureHostKeys(
  workflow: Workflow | null | undefined,
  promptKey: string,
): string[] {
  if (!workflow) return [];
  const segments = promptKey.split(':');
  if (segments.length < 2) return [];

  const subgraphById = new Map<string, WorkflowSubgraphDefinition>(
    (workflow.definitions?.subgraphs ?? []).map((subgraph) => [subgraph.id, subgraph]),
  );
  if (subgraphById.size === 0) return [];

  // Descend the placeholder chain, recording each host and the subgraph it lives in.
  const hosts: Array<{ node: WorkflowNode; containingSubgraphId: string | null }> = [];
  let scopeNodes: WorkflowNode[] = workflow.nodes;
  let scopeSubgraphId: string | null = null;

  for (const segment of segments.slice(0, -1)) {
    const id = Number(segment);
    const host = scopeNodes.find((node) => node.id === id);
    const definition = host ? subgraphById.get(host.type) : undefined;
    if (!host || !definition) return [];
    hosts.push({ node: host, containingSubgraphId: scopeSubgraphId });
    scopeNodes = definition.nodes ?? [];
    scopeSubgraphId = definition.id;
  }

  const keys: string[] = [];
  let exposedChildId = segments[segments.length - 1];
  for (let index = hosts.length - 1; index >= 0; index -= 1) {
    const { node, containingSubgraphId } = hosts[index];
    if (!exposesSource(node, exposedChildId)) break;
    const key = keyForNode(node, containingSubgraphId);
    if (key) keys.push(key);
    exposedChildId = String(node.id);
  }
  return keys;
}
