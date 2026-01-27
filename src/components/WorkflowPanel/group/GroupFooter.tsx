import type { WorkflowGroup } from '@/api/types';
import { hexToRgba } from '@/utils/grouping';

interface GroupFooterProps {
  group: WorkflowGroup;
}

export function GroupFooter({ group }: GroupFooterProps) {
  const backgroundColor = hexToRgba(group.color, 0.15);
  const borderColor = hexToRgba(group.color, 0.3);
  const handleClick = () => {
    const header = document.getElementById(`group-header-${group.id}`);
    header?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      id={`group-footer-${group.id}`}
      className="group-footer px-3 py-1.5 -mx-1 rounded-b-xl cursor-pointer"
      onClick={handleClick}
      style={{
        backgroundColor,
        borderColor
      }}
    >
      <span className="text-xs text-gray-500 dark:text-gray-400 select-none">
        {group.title}
      </span>
    </div>
  );
}
