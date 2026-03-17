import { useWorkflowStore } from '@/hooks/useWorkflow';

/**
 * Breadcrumb bar shown when the user has drilled into a subgraph.
 * Renders nothing when at the root scope (scopeStack.length === 1).
 */
export function SubgraphBreadcrumb() {
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const workflow = useWorkflowStore((s) => s.workflow);
  const exitToRoot = useWorkflowStore((s) => s.exitToRoot);
  const exitToDepth = useWorkflowStore((s) => s.exitToDepth);

  if (scopeStack.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 border-b border-gray-200 text-sm overflow-x-auto">
      <button
        className="text-blue-600 hover:underline shrink-0"
        onClick={exitToRoot}
      >
        Root
      </button>
      {scopeStack.slice(1).map((frame, index) => {
        if (frame.type !== 'subgraph') return null;
        const subgraph = workflow?.definitions?.subgraphs?.find(
          (sg) => sg.id === frame.id,
        );
        const label = subgraph?.name ?? frame.id.slice(0, 8);
        // index is 0-based into the slice (which starts at frame 1), so
        // the corresponding depth in the full stack is index + 2 (inclusive).
        const isLast = index === scopeStack.length - 2;
        return (
          <span key={frame.id} className="flex items-center gap-1 shrink-0">
            <span className="text-gray-400">/</span>
            {isLast ? (
              <span className="text-gray-700 font-medium">{label}</span>
            ) : (
              <button
                className="text-blue-600 hover:underline"
                onClick={() => exitToDepth(index + 2)}
              >
                {label}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
