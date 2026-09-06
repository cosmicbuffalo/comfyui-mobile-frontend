import type { ParentChip } from '@/utils/itemParentage';
import { ParentageEntry } from '@/components/ParentageEntry';

interface SubgraphInstanceEntryProps {
  /** What this instance is called — its own name, or the type's rendered one. */
  label: string;
  /** The containers it sits in, outermost first. */
  parents: ParentChip[];
  surfaceColor?: string;
  borderColor?: string;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}

/**
 * One instance of a subgraph type, drawn as the bookmark bar draws a bookmark:
 * what it is called on top, where it lives beneath.
 *
 * Two instances of one type are identical apart from where they sit, so the
 * parentage is not decoration — it is the only thing that tells them apart.
 * This is a thin naming of `ParentageEntry` for that case: instances have no
 * parents to navigate to and nothing to remove, so neither affordance is
 * passed, and the three lists that show instances cannot drift apart.
 */
export function SubgraphInstanceEntry({
  label,
  parents,
  surfaceColor,
  borderColor,
  selected = false,
  disabled = false,
  className = '',
  onClick,
}: SubgraphInstanceEntryProps) {
  return (
    <ParentageEntry
      label={label}
      parents={parents}
      surfaceColor={surfaceColor}
      borderColor={borderColor}
      selected={selected}
      disabled={disabled}
      className={`subgraph-instance-entry ${className}`}
      parentClassName="subgraph-instance-parent"
      onClick={onClick}
    />
  );
}
