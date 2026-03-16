import { hexToRgba } from "@/utils/grouping";

interface ContainerFooterProps {
  id: string;
  headerId: string;
  title: string;
  nodeCount?: number;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  textClassName: string;
  className?: string;
  allBypassed?: boolean;
}

export function ContainerFooter({
  id,
  headerId,
  title,
  nodeCount,
  color,
  backgroundColor,
  borderColor,
  textClassName,
  className = '',
  allBypassed = false
}: ContainerFooterProps) {
  const handleClick = () => {
    const header = document.getElementById(headerId);
    header?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <button
      type="button"
      id={id}
      className={`p-3 -mx-1 w-full text-left ${className}`}
      onClick={handleClick}
      style={{
        backgroundColor: allBypassed ? hexToRgba('#9333ea', 0.12) : color ? hexToRgba(color, 0.15) : backgroundColor,
        borderColor: allBypassed ? hexToRgba('#9333ea', 0.3) : color ? hexToRgba(color, 0.3) : borderColor,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`text-xs select-none ${textClassName}`}>
          {title}
        </span>
        {typeof nodeCount === 'number' && (
          <span className={`text-xs select-none ${textClassName}`}>
            {nodeCount} node{nodeCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  );
}
