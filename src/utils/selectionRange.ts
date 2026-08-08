export function getSelectionRangeIds(
  orderedIds: string[],
  anchorId: string | null,
  targetId: string,
): string[] | null {
  if (!anchorId) return null;
  const anchorIndex = orderedIds.indexOf(anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return null;

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return orderedIds.slice(start, end + 1);
}

// The anchor of a range operation: the last item plainly toggled, plus the
// direction that toggle went (`select: true` = it selected, `false` = it
// deselected). A range click extends that same direction.
export interface SelectionAnchor {
  id: string;
  select: boolean;
}

// What a checkbox/shift click should do, decided purely from inputs so it can be
// unit-tested. `range` applies `select` to every id in the span (and keeps the
// anchor put); `toggle` flips a single item and re-anchors on it.
export type SelectionToggleResult =
  | { type: 'range'; ids: string[]; select: boolean }
  | { type: 'toggle'; id: string; select: boolean; nextAnchor: SelectionAnchor };

// Resolve a selection click. A range applies the ANCHOR's direction across the
// whole span, regardless of what state the clicked item happens to be in — the
// same rule as Finder/Explorer. Range-clicking an already-selected item is an
// "extend to here" gesture, so reading it as a one-item deselect (and moving the
// anchor) silently loses the span the user meant to grab, and a follow-up range
// click then sweeps the wrong way.
//
// Bulk deselect stays reachable: plain-tap an item to turn it off, which sets a
// deselect anchor, then range-click the far end.
export function resolveSelectionToggle(params: {
  selectableIds: string[];
  isSelected: boolean;
  id: string;
  anchor: SelectionAnchor | null;
  rangeRequested: boolean;
}): SelectionToggleResult {
  const { selectableIds, isSelected, id, anchor, rangeRequested } = params;
  const willSelect = !isSelected;
  if (rangeRequested && anchor) {
    const ids = getSelectionRangeIds(selectableIds, anchor.id, id);
    if (ids) {
      return { type: 'range', ids, select: anchor.select };
    }
  }
  return { type: 'toggle', id, select: willSelect, nextAnchor: { id, select: willSelect } };
}
