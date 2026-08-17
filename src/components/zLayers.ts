/**
 * Shared stacking order for overlays that escape their component's place in
 * the tree.
 *
 * A z-index only ranks an element against its siblings inside the nearest
 * stacking context, so an overlay rendered under a positioned, z-indexed
 * ancestor (`#top-bar-root` is `z-[2000]`) can never paint above a portal that
 * sits directly on `document.body`. Every overlay below therefore portals to
 * the body, which makes these values comparable app-wide.
 */
export const Z_LAYERS = {
  /** Slide-over panels — the app menu. */
  slidePanel: 2300,
  /** Fullscreen panels launched from the menu: custom nodes, feedback form. */
  fullscreenPanel: 2600,
  /**
   * Confirmation dialogs opened from a slide-over or fullscreen panel. Above
   * both, so the panel and its backdrop blur never cover the confirmation.
   */
  panelDialog: 2700,
} as const;
