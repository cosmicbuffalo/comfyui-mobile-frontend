import { useMemo } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { interpolateInstanceLabel } from '@/utils/subgraphInstanceLabels';
import { useI18n } from '@/i18n';

/**
 * Breadcrumb bar shown when the user has drilled into a subgraph. Its footprint
 * stays reserved at root so moving between scopes cannot shift the panel below.
 */
export function SubgraphBreadcrumb() {
  const { t } = useI18n();
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const workflow = useWorkflowStore((s) => s.workflow);
  const exitToRoot = useWorkflowStore((s) => s.exitToRoot);
  const exitToDepth = useWorkflowStore((s) => s.exitToDepth);

  // Crumb labels resolve per-frame, walking parent scopes so each frame's
  // placeholder (and its instance number, for {n} name templates) is found in
  // the scope that actually contains it.
  const crumbLabels = useMemo(() => {
    if (!workflow) return [];
    const labels: string[] = [];
    let parentNodes = workflow.nodes ?? [];
    for (const frame of scopeStack.slice(1)) {
      if (frame.type !== 'subgraph') {
        labels.push('');
        continue;
      }
      const subgraph = workflow.definitions?.subgraphs?.find((sg) => sg.id === frame.id);
      const placeholder = parentNodes.find((n) => n.id === frame.placeholderNodeId);
      const rawName = subgraph?.name ?? frame.id.slice(0, 8);
      labels.push(
        (placeholder
          ? interpolateInstanceLabel(rawName, getInstanceNumber(placeholder))
          : rawName) || rawName,
      );
      parentNodes = subgraph?.nodes ?? [];
    }
    return labels;
  }, [workflow, scopeStack]);

  const hasBreadcrumbs = scopeStack.length > 1;

  return (
    <div
      aria-hidden={!hasBreadcrumbs}
      className={`flex min-h-[33px] items-center gap-1 px-3 py-1.5 text-sm overflow-x-auto ${
        hasBreadcrumbs
          ? 'bg-slate-900/95 border-b border-white/10'
          : 'pointer-events-none opacity-0'
      }`}
    >
      {hasBreadcrumbs && (
        <>
          <button
            className="text-cyan-300 hover:text-cyan-200 hover:underline shrink-0"
            onClick={exitToRoot}
          >
            {t('Root')}
          </button>
          {scopeStack.slice(1).map((frame, index) => {
            if (frame.type !== 'subgraph') return null;
            const label = crumbLabels[index] || frame.id.slice(0, 8);
            // index is 0-based into the slice (which starts at frame 1), so
            // the corresponding depth in the full stack is index + 2 (inclusive).
            const isLast = index === scopeStack.length - 2;
            return (
              <span key={`${frame.id}::${index}`} className="flex items-center gap-1 shrink-0">
                <span className="text-slate-500">/</span>
                {isLast ? (
                  <span className="text-slate-200 font-medium">{label}</span>
                ) : (
                  <button
                    className="text-cyan-300 hover:text-cyan-200 hover:underline"
                    onClick={() => exitToDepth(index + 2)}
                  >
                    {label}
                  </button>
                )}
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}
