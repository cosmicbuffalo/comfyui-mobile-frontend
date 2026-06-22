// Pure geometry for placing the autocomplete dropdown relative to the caret's
// line, measured against the visible viewport (which the on-screen keyboard
// shrinks from the bottom). Kept DOM-free so the below/above decision is
// unit-testable.

export const ROW_HEIGHT = 36;
export const MAX_DROPDOWN_HEIGHT = 280;
// Require room for ~2 rows (+ the list's own padding) below the caret before
// placing the dropdown below; otherwise flip it above the caret line.
export const MIN_BELOW_SPACE = ROW_HEIGHT * 2 + 8;
const GAP = 4;

export interface PlacementInput {
  /** Viewport y of the caret line's top and bottom. */
  caretLineTop: number;
  caretLineBottom: number;
  /** Horizontal anchor (the textarea's left edge + width). */
  fieldLeft: number;
  fieldWidth: number;
  /** Visible viewport bounds (visualViewport offsetTop .. offsetTop+height). */
  viewportTop: number;
  viewportBottom: number;
  /** window.innerHeight, for converting a top anchor into a `bottom` anchor. */
  windowHeight: number;
}

export interface Placement {
  left: number;
  width: number;
  /** Set when anchored below the caret (fixed `top`). */
  top?: number;
  /** Set when flipped above the caret (fixed `bottom`). */
  bottom?: number;
  maxHeight: number;
  placeAbove: boolean;
}

export function computeDropdownPlacement(input: PlacementInput): Placement {
  const belowSpace = input.viewportBottom - input.caretLineBottom - GAP;
  const aboveSpace = input.caretLineTop - input.viewportTop - GAP;
  // Flip above only when there isn't room for ~2 rows below AND there's more
  // room above than below.
  const placeAbove = belowSpace < MIN_BELOW_SPACE && aboveSpace > belowSpace;
  const space = placeAbove ? aboveSpace : belowSpace;

  return {
    left: input.fieldLeft,
    width: input.fieldWidth,
    top: placeAbove ? undefined : input.caretLineBottom + GAP,
    bottom: placeAbove ? input.windowHeight - input.caretLineTop + GAP : undefined,
    maxHeight: Math.min(MAX_DROPDOWN_HEIGHT, Math.max(ROW_HEIGHT, space)),
    placeAbove,
  };
}
