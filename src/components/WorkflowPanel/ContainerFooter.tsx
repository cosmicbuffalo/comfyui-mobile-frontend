import { themeColors } from "@/theme/colors";
import { hexToRgba } from "@/utils/grouping";

interface ContainerFooterProps {
  id: string;
  headerId: string;
  title: string;
  nodeCount?: number;
  color: string;
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
  textClassName,
  className = '',
  allBypassed = false,
}: ContainerFooterProps) {
  const handleClick = () => {
    const header = document.getElementById(headerId);
    header?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <button
      type="button"
      id={id}
      className={`p-3 w-full cursor-pointer ${className}`}
      onClick={handleClick}
      style={{
        backgroundColor: allBypassed ? hexToRgba(themeColors.brand.bypassPurple, 0.12) : hexToRgba(color, 0.15),
        borderColor: allBypassed ? hexToRgba(themeColors.brand.bypassPurple, 0.3) : hexToRgba(color, 0.3),
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
