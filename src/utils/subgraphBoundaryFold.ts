/**
 * Fold key for a subgraph's connections section, in the same store the node
 * cards fold through. It lives here rather than in the section so the controls
 * that need to unfold it — an inner slot revealing the boundary it crosses —
 * do not have to import the section itself.
 */
export function subgraphBoundaryFoldKey(subgraphId: string): string {
  return `subgraph-boundary:${subgraphId}`;
}
