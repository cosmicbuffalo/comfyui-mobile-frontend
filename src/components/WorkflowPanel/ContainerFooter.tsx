interface ContainerFooterProps {
  id: string;
  headerId: string;
  title: string;
  nodeCount?: number;
  backgroundColor: string;
  borderColor: string;
  textClassName: string;
  className?: string;
}

export function ContainerFooter({
  id,
  headerId,
  title,
  nodeCount,
  backgroundColor,
  borderColor,
  textClassName,
  className = ''
}: ContainerFooterProps) {
  const handleClick = () => {
    const header = document.getElementById(headerId);
    header?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      id={id}
      className={`px-3 py-1.5 -mx-1 rounded-b-xl cursor-pointer ${className}`}
      onClick={handleClick}
      style={{
        backgroundColor,
        borderColor
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
    </div>
  );
}
