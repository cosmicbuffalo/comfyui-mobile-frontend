import type { ItemRef, MobileLayout } from '@/utils/mobileLayout';
import { makeLocationPointer } from '@/utils/mobileLayout';

export interface LayoutHiddenState {
  hiddenNodeKeys: Set<string>;
  hiddenGroupKeys: Set<string>;
  hiddenSubgraphIds: Set<string>;
  hiddenNodeCount: number;
}

export function collectLayoutHiddenState(
  refs: ItemRef[],
  options: {
    layout: MobileLayout;
    hiddenItems: Record<string, boolean>;
    stableKeyByPointer: Record<string, string>;
  },
  context?: {
    parentHidden?: boolean;
    parentSubgraphId?: string | null;
    visitedGroups?: Set<string>;
    visitedSubgraphs?: Set<string>;
    hiddenNodeKeys?: Set<string>;
    hiddenGroupKeys?: Set<string>;
    hiddenSubgraphIds?: Set<string>;
  }
): LayoutHiddenState {
  const parentHidden = context?.parentHidden ?? false;
  const parentSubgraphId = context?.parentSubgraphId ?? null;
  const visitedGroups = context?.visitedGroups ?? new Set<string>();
  const visitedSubgraphs = context?.visitedSubgraphs ?? new Set<string>();
  const hiddenNodeKeys = context?.hiddenNodeKeys ?? new Set<string>();
  const hiddenGroupKeys = context?.hiddenGroupKeys ?? new Set<string>();
  const hiddenSubgraphIds = context?.hiddenSubgraphIds ?? new Set<string>();
  const {
    layout,
    hiddenItems,
    stableKeyByPointer
  } = options;
  const hasStableFlag = (state: Record<string, boolean>, pointer: string): boolean => {
    const stableKey = stableKeyByPointer[pointer];
    if (stableKey) return Boolean(state[stableKey]);
    return Boolean(state[pointer]);
  };

  let hiddenNodeCount = 0;
  for (const ref of refs) {
    if (ref.type === 'node') {
      const nodeKey = makeLocationPointer({
        type: 'node',
        nodeId: ref.id,
        subgraphId: parentSubgraphId
      });
      const isHidden = parentHidden || hasStableFlag(hiddenItems, nodeKey);
      if (isHidden) hiddenNodeCount += 1;
      if (hasStableFlag(hiddenItems, nodeKey)) hiddenNodeKeys.add(nodeKey);
      continue;
    }

    if (ref.type === 'hiddenBlock') {
      const ids = layout.hiddenBlocks[ref.blockId] ?? [];
      for (const id of ids) {
        const nodeKey = makeLocationPointer({
          type: 'node',
          nodeId: id,
          subgraphId: parentSubgraphId
        });
        const isHidden = parentHidden || hasStableFlag(hiddenItems, nodeKey);
        if (isHidden) hiddenNodeCount += 1;
        if (hasStableFlag(hiddenItems, nodeKey)) hiddenNodeKeys.add(nodeKey);
      }
      continue;
    }

    if (ref.type === 'group') {
      if (visitedGroups.has(ref.stableKey)) continue;
      const groupHidden = parentHidden || hasStableFlag(hiddenItems, ref.stableKey);
      if (hasStableFlag(hiddenItems, ref.stableKey)) hiddenGroupKeys.add(ref.stableKey);
      visitedGroups.add(ref.stableKey);
      const nested = collectLayoutHiddenState(
        layout.groups[ref.stableKey] ?? [],
        options,
        {
          parentHidden: groupHidden,
          parentSubgraphId: ref.subgraphId,
          visitedGroups,
          visitedSubgraphs,
          hiddenNodeKeys,
          hiddenGroupKeys,
          hiddenSubgraphIds
        }
      );
      hiddenNodeCount += nested.hiddenNodeCount;
      visitedGroups.delete(ref.stableKey);
      continue;
    }

    if (visitedSubgraphs.has(ref.id)) continue;
    const subgraphKey = makeLocationPointer({ type: 'subgraph', subgraphId: ref.id });
    const subgraphHidden = parentHidden || hasStableFlag(hiddenItems, subgraphKey);
    if (hasStableFlag(hiddenItems, subgraphKey)) hiddenSubgraphIds.add(ref.id);
    visitedSubgraphs.add(ref.id);
    const nested = collectLayoutHiddenState(
      layout.subgraphs[ref.id] ?? [],
      options,
      {
        parentHidden: subgraphHidden,
        parentSubgraphId: ref.id,
        visitedGroups,
        visitedSubgraphs,
        hiddenNodeKeys,
        hiddenGroupKeys,
        hiddenSubgraphIds
      }
    );
    hiddenNodeCount += nested.hiddenNodeCount;
    visitedSubgraphs.delete(ref.id);
  }

  return {
    hiddenNodeKeys,
    hiddenGroupKeys,
    hiddenSubgraphIds,
    hiddenNodeCount
  };
}
