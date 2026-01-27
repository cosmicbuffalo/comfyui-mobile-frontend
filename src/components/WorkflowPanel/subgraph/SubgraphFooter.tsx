import type { WorkflowSubgraphDefinition } from '@/api/types';

interface SubgraphFooterProps {
  subgraph: WorkflowSubgraphDefinition;
}

// Default subgraph color - matches header
const SUBGRAPH_BG_COLOR = 'rgba(59, 130, 246, 0.1)'; // blue-500 at 10%
const SUBGRAPH_BORDER_COLOR = 'rgba(59, 130, 246, 0.2)'; // blue-500 at 20%

export function SubgraphFooter({ subgraph }: SubgraphFooterProps) {
  const title = subgraph.name || subgraph.id;
  const handleClick = () => {
    const header = document.getElementById(`subgraph-header-${subgraph.id}`);
    header?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      id={`subgraph-footer-${subgraph.id}`}
      className="subgraph-footer px-3 py-1.5 -mx-1 rounded-b-xl cursor-pointer"
      onClick={handleClick}
      style={{
        backgroundColor: SUBGRAPH_BG_COLOR,
        borderColor: SUBGRAPH_BORDER_COLOR,
      }}
    >
      <span className="text-xs text-blue-600 dark:text-blue-500 select-none">
        {title}
      </span>
    </div>
  );
}
