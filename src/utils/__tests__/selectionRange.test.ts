import { describe, expect, it } from 'vitest';
import { getSelectionRangeIds, resolveSelectionToggle } from '@/utils/selectionRange';

describe('getSelectionRangeIds', () => {
  it('returns the inclusive range between anchor and target', () => {
    expect(getSelectionRangeIds(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd']);
  });

  it('handles reverse ranges', () => {
    expect(getSelectionRangeIds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('returns null when the anchor is not available', () => {
    expect(getSelectionRangeIds(['a', 'b', 'c'], null, 'c')).toBeNull();
    expect(getSelectionRangeIds(['a', 'b', 'c'], 'x', 'c')).toBeNull();
  });
});

describe('resolveSelectionToggle', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('plain-toggles and anchors when there is no anchor yet', () => {
    expect(
      resolveSelectionToggle({
        selectableIds: ids,
        isSelected: false,
        id: 'b',
        anchor: null,
        rangeRequested: true,
      }),
    ).toEqual({ type: 'toggle', id: 'b', select: true, nextAnchor: { id: 'b', select: true } });
  });

  it('range-selects when the anchor direction matches (select → select)', () => {
    expect(
      resolveSelectionToggle({
        selectableIds: ids,
        isSelected: false,
        id: 'd',
        anchor: { id: 'b', select: true },
        rangeRequested: true,
      }),
    ).toEqual({ type: 'range', ids: ['b', 'c', 'd'], select: true });
  });

  it('extends the span when the range lands on an already-selected item', () => {
    // "Range-click to here" is an extend gesture. Reading it as a one-item
    // deselect (because that item happened to be selected already) silently
    // loses the span the user meant to grab and moves the anchor, so the next
    // range click sweeps the wrong way. The anchor decides the direction.
    expect(
      resolveSelectionToggle({
        selectableIds: ids,
        isSelected: true,
        id: 'd',
        anchor: { id: 'b', select: true },
        rangeRequested: true,
      }),
    ).toEqual({ type: 'range', ids: ['b', 'c', 'd'], select: true });
  });

  it('bulk-deselects from a deselect anchor set by a plain tap', () => {
    // The reachable path to bulk deselect: plain-tap turns one item off and
    // anchors the direction, then the range click sweeps it.
    const tap = resolveSelectionToggle({
      selectableIds: ids,
      isSelected: true,
      id: 'a',
      anchor: { id: 'x', select: true },
      rangeRequested: false,
    });
    expect(tap).toEqual({
      type: 'toggle', id: 'a', select: false, nextAnchor: { id: 'a', select: false },
    });

    expect(
      resolveSelectionToggle({
        selectableIds: ids,
        isSelected: true,
        id: 'd',
        anchor: { id: 'a', select: false },
        rangeRequested: true,
      }),
    ).toEqual({ type: 'range', ids: ['a', 'b', 'c', 'd'], select: false });
  });

  it('range-deselects once a deselect anchor is established', () => {
    // Anchor direction is what drives the span, in both directions.
    expect(
      resolveSelectionToggle({
        selectableIds: ids,
        isSelected: true,
        id: 'a',
        anchor: { id: 'd', select: false },
        rangeRequested: true,
      }),
    ).toEqual({ type: 'range', ids: ['a', 'b', 'c', 'd'], select: false });
  });

  it('plain-toggles when no range is requested (card-body tap)', () => {
    expect(
      resolveSelectionToggle({
        selectableIds: ids,
        isSelected: true,
        id: 'c',
        anchor: { id: 'a', select: false },
        rangeRequested: false,
      }),
    ).toEqual({ type: 'toggle', id: 'c', select: false, nextAnchor: { id: 'c', select: false } });
  });
});
