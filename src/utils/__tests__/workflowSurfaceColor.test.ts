import { describe, expect, it } from 'vitest';
import {
  PANEL_SURFACE,
  compositeOver,
  groupBorderSurface,
  groupHeaderSurface,
  groupWrapperSurface,
  nodeCardBorderSurface,
  nodeCardSurface,
} from '@/utils/workflowSurfaceColor';

// Expected values are worked out by hand from the alphas the panel actually
// paints with, so they stay an independent check on the maths rather than a
// snapshot of it. Reference: the panel surface is slate-950 #020617 = (2, 6, 23).
describe('workflowSurfaceColor', () => {
  it('composites an overlay onto an opaque base', () => {
    // 0.4 * 51 + 0.6 * 2 = 21.6 -> 22, and so on per channel.
    expect(compositeOver('#333355', 0.4, PANEL_SURFACE)).toBe('#161830');
    expect(compositeOver('#ffffff', 0, '#123456')).toBe('#123456');
    expect(compositeOver('#ffffff', 1, '#123456')).toBe('#ffffff');
  });

  it('clamps out-of-range alphas instead of overshooting', () => {
    expect(compositeOver('#ffffff', 2, '#000000')).toBe('#ffffff');
    expect(compositeOver('#ffffff', -1, '#000000')).toBe('#000000');
  });

  it('falls back to the base when a colour cannot be parsed', () => {
    expect(compositeOver('not-a-colour', 0.4, '#123456')).toBe('#123456');
    expect(compositeOver('#333355', 0.4, 'not-a-colour')).toBe(PANEL_SURFACE);
  });

  it('accepts shorthand hex', () => {
    expect(compositeOver('#fff', 1, PANEL_SURFACE)).toBe('#ffffff');
  });

  it('stacks a group header on its own wrapper fill', () => {
    // Wrapper: 0.15 * (51, 51, 85) over (2, 6, 23) -> (9, 13, 32).
    expect(groupWrapperSurface('#333355')).toBe('#090d20');
    // Header: the same tint again, this time over the wrapper -> (15, 19, 40).
    expect(groupHeaderSurface('#333355')).toBe('#0f1328');
  });

  it('tints a coloured node card once, at the card alpha', () => {
    expect(nodeCardSurface('#333355', true)).toBe('#161830');
  });

  it('leaves an uncoloured node card on the plain slate-900/95 fill', () => {
    // 0.95 * (15, 23, 42) over (2, 6, 23) -> (14, 22, 41). Notably NOT derived
    // from the palette's "no colour" swatch, which the card never paints.
    expect(nodeCardSurface('#353535', false)).toBe('#0e1629');
  });

  it('carries an enclosing group through as the backdrop', () => {
    // A green node inside a blue group draws on the blue wrapper fill, not on
    // the bare panel, so it is not the same colour as the same node at root.
    const insideBlueGroup = nodeCardSurface(
      '#335533',
      true,
      groupWrapperSurface('#333355'),
    );
    expect(insideBlueGroup).toBe('#1a2a28');
    expect(insideBlueGroup).not.toBe(nodeCardSurface('#335533', true));
  });

  it('derives a node outline from the card fill, not the node colour', () => {
    // `border-white/10`: 0.1 * 255 over (22, 24, 48) -> (45, 47, 69).
    expect(nodeCardBorderSurface('#161830')).toBe('#2d2f45');
  });

  it('derives a group outline from the colour at the wrapper border alpha', () => {
    expect(groupBorderSurface('#333355')).toBe('#161830');
  });
});
