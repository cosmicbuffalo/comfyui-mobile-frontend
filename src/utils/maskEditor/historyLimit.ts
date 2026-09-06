/** Maximum number of mask/paint states kept for a small image. */
export const MAX_MASK_HISTORY_STEPS = 20;

/** Keep the current state plus one state to undo to, even for very large images. */
export const MIN_MASK_HISTORY_STEPS = 2;

/**
 * Target ceiling for the raw pixel buffers held by undo history.
 *
 * One state owns two RGBA ImageData buffers (mask + paint), or eight bytes per
 * image pixel. The minimum-step rule may exceed this target for an image whose
 * two states alone are larger than the budget, but growth is still bounded at
 * two states instead of twenty.
 */
export const MASK_HISTORY_MEMORY_BUDGET_BYTES = 96 * 1024 * 1024;

const BYTES_PER_PIXEL_PER_STEP = 4 * 2;

export function maskHistoryLimitForDimensions(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return MIN_MASK_HISTORY_STEPS;
  }

  const bytesPerStep = Math.ceil(width) * Math.ceil(height) * BYTES_PER_PIXEL_PER_STEP;
  const budgetedSteps = Math.floor(MASK_HISTORY_MEMORY_BUDGET_BYTES / bytesPerStep);
  return Math.max(
    MIN_MASK_HISTORY_STEPS,
    Math.min(MAX_MASK_HISTORY_STEPS, budgetedSteps),
  );
}
