import type { WorkflowGroup } from '@/api/types';
import { hexToRgba } from '@/utils/grouping';

interface GroupPlaceholderProps {
  group: WorkflowGroup;
}

export function GroupPlaceholder({ group }: GroupPlaceholderProps) {
  const backgroundColor = hexToRgba(group.color, 0.05);
  const borderColor = hexToRgba(group.color, 0.3);
  const dashedBorderColor = hexToRgba(group.color, 0.4);

  return (
    <div
      id={`group-placeholder-${group.id}`}
      className="group-placeholder flex items-center justify-center px-4 py-6 border-l border-r"
      style={{ backgroundColor, borderColor }}
    >
      <div
        className="w-full rounded-lg border-2 border-dashed flex items-center justify-center py-4"
        style={{ borderColor: dashedBorderColor }}
      >
        <span className="text-sm text-gray-400 select-none">
          No nodes in group
        </span>
      </div>
    </div>
  );
}
