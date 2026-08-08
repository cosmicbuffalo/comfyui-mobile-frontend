import { describe, expect, it } from 'vitest';
import { compareClipPath, DEFAULT_COMPARE_CLIP } from '../compareClip';

// The inset percentage carries float noise (30.000000000000004%), which is
// harmless in CSS — compare the number, not the string.
function insetPercent(clip: string): number {
  return Number(/inset\(0 ([\d.]+)% 0 0\)/.exec(clip)![1]);
}

// Image A is revealed to the LEFT of the divider, so the clip insets from the
// right: a divider at the image's midpoint leaves `inset(0 50% 0 0)`.
describe('compareClipPath', () => {
  it('clips at the divider for an unzoomed, unpanned image', () => {
    expect(compareClipPath({ dividerX: 500, imageLeft: 0, scaledWidth: 1000 })).toBe(
      'inset(0 50% 0 0)',
    );
    expect(compareClipPath({ dividerX: 250, imageLeft: 0, scaledWidth: 1000 })).toBe(
      'inset(0 75% 0 0)',
    );
  });

  it('tracks the screen-fixed divider as the image is panned', () => {
    // Image dragged 200px left: the divider now sits further into the picture.
    expect(insetPercent(compareClipPath({ dividerX: 500, imageLeft: -200, scaledWidth: 1000 })))
      .toBeCloseTo(30);
  });

  it('tracks the divider as the image scales', () => {
    // Same divider, image zoomed 2x about its left edge — the boundary must stay
    // welded to the divider rather than drifting with the image width.
    expect(compareClipPath({ dividerX: 500, imageLeft: 0, scaledWidth: 2000 })).toBe(
      'inset(0 75% 0 0)',
    );
  });

  it('clamps when the divider falls outside the image', () => {
    // Fully revealed / fully hidden rather than a nonsense negative inset.
    expect(compareClipPath({ dividerX: 1200, imageLeft: 0, scaledWidth: 1000 })).toBe(
      'inset(0 0% 0 0)',
    );
    expect(compareClipPath({ dividerX: -50, imageLeft: 0, scaledWidth: 1000 })).toBe(
      'inset(0 100% 0 0)',
    );
  });

  it('falls back to a half wipe when the image has no measurable width', () => {
    expect(compareClipPath({ dividerX: 500, imageLeft: 0, scaledWidth: 0 })).toBe(
      DEFAULT_COMPARE_CLIP,
    );
    expect(compareClipPath({ dividerX: 500, imageLeft: 0, scaledWidth: Number.NaN })).toBe(
      DEFAULT_COMPARE_CLIP,
    );
  });
});
