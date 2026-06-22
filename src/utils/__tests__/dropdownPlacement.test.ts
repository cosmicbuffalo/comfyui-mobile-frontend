import { describe, expect, it } from 'vitest';
import {
  computeDropdownPlacement,
  MIN_BELOW_SPACE,
  ROW_HEIGHT,
} from '../dropdownPlacement';

const base = {
  fieldLeft: 20,
  fieldWidth: 300,
  viewportTop: 0,
  viewportBottom: 800,
  windowHeight: 800,
};

describe('computeDropdownPlacement', () => {
  it('anchors below the caret line when there is room', () => {
    const p = computeDropdownPlacement({ ...base, caretLineTop: 100, caretLineBottom: 124 });
    expect(p.placeAbove).toBe(false);
    expect(p.top).toBe(124 + 4); // caret line bottom + gap
    expect(p.bottom).toBeUndefined();
    expect(p.left).toBe(20);
    expect(p.width).toBe(300);
  });

  it('flips above the caret line when there is not room for ~2 rows below', () => {
    // Caret line near the bottom: only ~30px below, plenty above.
    const p = computeDropdownPlacement({
      ...base,
      caretLineTop: 740,
      caretLineBottom: 766, // belowSpace = 800 - 766 - 4 = 30 < MIN_BELOW_SPACE
    });
    expect(p.placeAbove).toBe(true);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(800 - 740 + 4); // window height - caret line top + gap
  });

  it('stays below at exactly the 2-row threshold', () => {
    // belowSpace == MIN_BELOW_SPACE → not less-than, so stays below.
    const caretLineBottom = base.viewportBottom - MIN_BELOW_SPACE - 4;
    const p = computeDropdownPlacement({ ...base, caretLineTop: caretLineBottom - 24, caretLineBottom });
    expect(p.placeAbove).toBe(false);
  });

  it('respects the shrunken viewport bottom (keyboard open)', () => {
    // Visible viewport ends at 400 (keyboard covers below); caret line at 380.
    const p = computeDropdownPlacement({
      ...base,
      viewportBottom: 400,
      caretLineTop: 356,
      caretLineBottom: 380, // belowSpace = 400 - 380 - 4 = 16 → flip above
    });
    expect(p.placeAbove).toBe(true);
  });

  it('clamps maxHeight to the available space and the cap', () => {
    // Stays below (little room above), below space under the cap → maxHeight = below space.
    const below = computeDropdownPlacement({ ...base, caretLineTop: 52, caretLineBottom: 76, viewportBottom: 200 });
    expect(below.placeAbove).toBe(false);
    expect(below.maxHeight).toBe(200 - 76 - 4); // 120
    // Lots of room → capped at the maximum.
    const roomy = computeDropdownPlacement({ ...base, caretLineTop: 100, caretLineBottom: 124 });
    expect(roomy.maxHeight).toBeLessThanOrEqual(280);
    expect(roomy.maxHeight).toBeGreaterThanOrEqual(ROW_HEIGHT);
  });
});
