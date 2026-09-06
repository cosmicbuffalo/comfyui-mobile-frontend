import type { NodeTypes, Workflow } from '@/api/types';
import type { GroupParentRef, MobileLayout } from '@/utils/mobileLayout';
import { getGroupKey } from '@/utils/mobileLayout';
import { resolveWorkflowColor } from '@/theme/colors';
import {
  findWorkflowNodeInScope,
  resolveWorkflowNodeDisplayName,
} from '@/utils/subgraphPlaceholderLabels';
import { findScopeTrailForPlaceholder } from '@/utils/subgraphInstanceNavigation';
import {
  GROUP_TINT_ALPHA,
  PANEL_SURFACE,
  compositeOver,
  groupBorderSurface,
  groupHeaderSurface,
  nodeCardBorderSurface,
  nodeCardSurface,
} from '@/utils/workflowSurfaceColor';

/**
 * The containers a node sits inside, outermost first, each carrying the colour
 * it is actually drawn in — the "→ Group → Subgraph" trail the bookmark bar
 * shows beneath a bookmark.
 *
 * The enclosing SUBGRAPHS come from the workflow rather than the layout:
 * `layout.subgraphs` is keyed by definition id, so two instances of one shared
 * type share an entry and a layout walk cannot tell which one it reached.
 * `findScopeTrailForPlaceholder` resolves the real chain per placeholder.
 * Groups have no such ambiguity and come from the layout, which is where
 * grouping actually lives.
 */
export interface ParentChip {
  key: string;
  label: string;
  surfaceColor: string;
  borderColor: string;
}

/** The shared visual data for a workflow item reference and its parent trail. */
export interface ItemReferenceAppearance {
  parents: ParentChip[];
  surfaceColor: string;
  borderColor: string;
}

export function resolveItemReferenceAppearance(
  workflow: Workflow | null,
  layout: MobileLayout | null,
  nodeTypes: NodeTypes | null,
  target: { nodeId: number; subgraphId: string | null },
): ItemReferenceAppearance {
  if (!workflow) {
    const surfaceColor = nodeCardSurface(resolveWorkflowColor(undefined), false);
    return { parents: [], surfaceColor, borderColor: nodeCardBorderSurface(surfaceColor) };
  }

  // Each enclosing GROUP paints its wrapper fill before its children draw on
  // top, so a chip's colour depends on the whole chain above it. A subgraph is
  // a separate scope rather than a nested surface, so it adds no layer.
  let backdrop = PANEL_SURFACE;
  const chips: ParentChip[] = [];

  const pushGroups = (nodeId: number, scopeId: string | null) => {
    for (const groupId of groupChainFor(layout, nodeId, scopeId)) {
      const groups = scopeId
        ? workflow.definitions?.subgraphs?.find((sg) => sg.id === scopeId)?.groups
        : workflow.groups;
      const group = groups?.find((entry) => entry.id === groupId);
      const color = resolveWorkflowColor(group?.color);
      chips.push({
        key: `group:${scopeId ?? 'root'}:${groupId}`,
        label: group?.title?.trim() || `Group ${groupId}`,
        surfaceColor: groupHeaderSurface(color, backdrop),
        borderColor: groupBorderSurface(color, backdrop),
      });
      backdrop = compositeOver(color, GROUP_TINT_ALPHA, backdrop);
    }
  };

  const pushPlaceholder = (nodeId: number, scopeId: string | null) => {
    const node = findWorkflowNodeInScope(workflow, nodeId, scopeId);
    const raw =
      (typeof node?.bgcolor === 'string' && node.bgcolor.trim() ? node.bgcolor : undefined) ??
      (typeof node?.color === 'string' && node.color.trim() ? node.color : undefined);
    const surfaceColor = nodeCardSurface(resolveWorkflowColor(raw), Boolean(raw), backdrop);
    chips.push({
      key: `node:${scopeId ?? 'root'}:${nodeId}`,
      label: node ? resolveWorkflowNodeDisplayName(workflow, node, nodeTypes) : String(nodeId),
      surfaceColor,
      borderColor: nodeCardBorderSurface(surfaceColor),
    });
  };

  // Walk down the scope trail: at each level, the groups holding that level's
  // placeholder, then the placeholder itself.
  const trail = findScopeTrailForPlaceholder(workflow, target.nodeId) ?? [{ type: 'root' as const }];
  let scopeId: string | null = null;
  for (const frame of trail) {
    if (frame.type === 'root') continue;
    pushGroups(frame.placeholderNodeId, scopeId);
    pushPlaceholder(frame.placeholderNodeId, scopeId);
    scopeId = frame.id;
  }
  // Finally the groups holding the node itself, in its own scope.
  pushGroups(target.nodeId, scopeId);

  const node = findWorkflowNodeInScope(workflow, target.nodeId, scopeId);
  const raw =
    (typeof node?.bgcolor === 'string' && node.bgcolor.trim() ? node.bgcolor : undefined) ??
    (typeof node?.color === 'string' && node.color.trim() ? node.color : undefined);
  const surfaceColor = nodeCardSurface(resolveWorkflowColor(raw), Boolean(raw), backdrop);
  return { parents: chips, surfaceColor, borderColor: nodeCardBorderSurface(surfaceColor) };
}

/** Group ids containing `nodeId` in `scopeId`, outermost first. */
function groupChainFor(
  layout: MobileLayout | null,
  nodeId: number,
  scopeId: string | null,
): number[] {
  if (!layout) return [];
  let holder: string | null = null;
  for (const [groupKey, refs] of Object.entries(layout.groups)) {
    if (groupKey !== getGroupKey(idFromGroupKey(groupKey), scopeId)) continue;
    // A subgraph placeholder is a `subgraph` ref carrying its node id, not a
    // `node` ref — and placeholders are exactly what the instance lists show,
    // so matching only `node` found a group for nothing they display.
    const holdsNode = refs.some(
      (ref) =>
        (ref.type === 'node' && ref.id === nodeId) ||
        (ref.type === 'subgraph' && ref.nodeId === nodeId),
    );
    if (holdsNode) {
      holder = groupKey;
      break;
    }
  }
  if (!holder) return [];

  const chain: number[] = [];
  const seen = new Set<string>();
  let current: string | null = holder;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    chain.unshift(idFromGroupKey(current));
    const parent: GroupParentRef | undefined = layout.groupParents?.[current];
    current = parent?.scope === 'group' ? parent.groupKey : null;
  }
  return chain;
}

/** The numeric group id inside a group key, whatever the key's scope prefix. */
function idFromGroupKey(groupKey: string): number {
  const match = groupKey.match(/(\d+)$/);
  return match ? Number(match[1]) : Number.NaN;
}
