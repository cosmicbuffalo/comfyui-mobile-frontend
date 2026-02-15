import type { ItemRef, MobileLayout } from '@/utils/mobileLayout';

export interface LayoutPath {
  groupKeys: string[];
  subgraphIds: string[];
  currentSubgraphId: string | null;
}

interface MatchContext extends LayoutPath {
  ref: ItemRef;
}

export function findLayoutPath(
  layout: MobileLayout,
  matches: (context: MatchContext) => boolean
): LayoutPath | null {
  const visit = (
    refs: ItemRef[],
    groupTrail: string[],
    subgraphTrail: string[],
    currentSubgraphId: string | null
  ): LayoutPath | null => {
    for (const ref of refs) {
      if (
        matches({
          ref,
          groupKeys: groupTrail,
          subgraphIds: subgraphTrail,
          currentSubgraphId
        })
      ) {
        return {
          groupKeys: groupTrail,
          subgraphIds: subgraphTrail,
          currentSubgraphId
        };
      }

      if (ref.type === 'group') {
        const child = visit(
          layout.groups[ref.stableKey] ?? [],
          [...groupTrail, ref.stableKey],
          subgraphTrail,
          currentSubgraphId
        );
        if (child) return child;
        continue;
      }

      if (ref.type === 'subgraph') {
        const child = visit(
          layout.subgraphs[ref.id] ?? [],
          groupTrail,
          [...subgraphTrail, ref.id],
          ref.id
        );
        if (child) return child;
      }
    }
    return null;
  };

  return visit(layout.root, [], [], null);
}

