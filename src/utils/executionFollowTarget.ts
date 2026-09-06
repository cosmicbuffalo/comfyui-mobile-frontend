import type { Workflow } from '@/api/types';
import { resolveCurrentScope, type ScopeFrame } from '@/utils/canonicalWorkflowOps';

/** The subgraph ids an item key passes through, outermost first. */
export function subgraphTrailFromItemKey(itemKey: string): string[] {
  return (itemKey.match(/subgraph:([^/]+)/g) ?? []).map((segment) =>
    segment.replace('subgraph:', ''),
  );
}

/**
 * What to follow when following must not change scope.
 *
 * With "follow into subgraphs" off, execution inside a subgraph is still worth
 * tracking — just at the depth the user chose to watch from. So the target is
 * the executing node when it is in this scope, and otherwise the placeholder
 * standing for the next subgraph down: the run stays visible without the view
 * being taken somewhere the user declined to go.
 *
 * Null when the executing node is on a branch this scope cannot see. There is
 * nothing to point at from here, and pointing at anything else would be a lie
 * about where execution is.
 */
export function resolveFollowTargetInScope(
  workflow: Workflow | null,
  scopeStack: ScopeFrame[],
  executionItemKey: string,
): string | null {
  if (!workflow) return null;
  const executingTrail = subgraphTrailFromItemKey(executionItemKey);
  const currentTrail = scopeStack
    .filter((frame): frame is Extract<ScopeFrame, { type: 'subgraph' }> =>
      frame.type === 'subgraph',
    )
    .map((frame) => frame.id);

  const sharesPrefix = currentTrail.every((id, index) => executingTrail[index] === id);
  if (!sharesPrefix) return null;
  if (executingTrail.length === currentTrail.length) return executionItemKey;

  const nextDown = executingTrail[currentTrail.length];
  const scope = resolveCurrentScope(scopeStack, workflow);
  return scope.nodes.find((node) => node.type === nextDown)?.itemKey ?? null;
}
