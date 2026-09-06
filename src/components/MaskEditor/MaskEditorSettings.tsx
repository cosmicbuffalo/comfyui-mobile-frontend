import { useI18n } from '@/i18n';
import { useMaskEditorStore } from '@/hooks/useMaskEditor';
import { BRUSH_SIZE_MAX, BRUSH_SIZE_MIN, type ColorComparisonMethod, type MaskBlendMode } from '@/utils/maskEditor/types';

/**
 * The tool-settings strip below the toolbar.
 *
 * Which controls appear follows the active tool, the way the desktop editor
 * swaps its side panel: brush settings for the two brushes and the eraser,
 * tolerance/opacity for the paint bucket, and the fuller colour-matching set
 * for color select. The mask display controls are always visible because they
 * affect how you read the mask regardless of what you are holding.
 */

function Slider({
  label, value, min, max, step, onChange, format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="mask-editor-slider flex flex-col gap-1 py-1.5">
      <span className="mask-editor-slider-header flex items-baseline justify-between gap-2">
        <span className="mask-editor-slider-label text-xs text-slate-400">{label}</span>
        <span className="mask-editor-slider-value text-xs tabular-nums text-slate-300">
          {format ? format(value) : value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mask-editor-slider-input w-full accent-cyan-400"
      />
    </label>
  );
}

/**
 * A labelled row of choice buttons.
 *
 * Stacked for the same reason as the slider: a fixed label column plus three
 * buttons does not fit the 320px desktop rail, and "Negative" was being clipped
 * off the edge.
 */
function ChoiceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mask-editor-choice-row flex flex-col gap-1 py-1.5">
      <span className="mask-editor-choice-label text-xs text-slate-400">{label}</span>
      <div className="mask-editor-choice-options flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Toggle({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mask-editor-toggle flex items-center gap-3 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mask-editor-toggle-input w-4 h-4 accent-cyan-400"
      />
      <span className="mask-editor-toggle-label text-xs text-slate-400">{label}</span>
    </label>
  );
}

export function MaskEditorSettings() {
  const { t } = useI18n();
  const s = useMaskEditorStore();
  const isBrushTool = s.tool === 'pen' || s.tool === 'eraser' || s.tool === 'rgbPaint';

  return (
    <div className="mask-editor-settings max-h-[38vh] overflow-y-auto border-t border-white/10 px-3 py-2 lg:max-h-none lg:overflow-y-visible">
      {isBrushTool && (
        <div className="mask-editor-brush-settings">
          <Slider
            label={t('Brush size')}
            value={s.brush.size}
            min={BRUSH_SIZE_MIN}
            max={BRUSH_SIZE_MAX}
            step={1}
            onChange={(size) => s.setBrush({ size })}
          />
          <Slider
            label={t('Opacity')}
            value={Math.round(s.brush.opacity * 100)}
            min={1}
            max={100}
            step={1}
            onChange={(v) => s.setBrush({ opacity: v / 100 })}
            format={(v) => `${v}%`}
          />
          <Slider
            label={t('Hardness')}
            value={Math.round(s.brush.hardness * 100)}
            min={0}
            max={100}
            step={1}
            onChange={(v) => s.setBrush({ hardness: v / 100 })}
            format={(v) => `${v}%`}
          />
          <Slider
            label={t('Spacing')}
            // Stamp spacing as a percentage of the brush radius: lower is a
            // smoother but heavier stroke.
            value={s.brush.stepSize}
            min={1}
            max={100}
            step={1}
            onChange={(stepSize) => s.setBrush({ stepSize })}
            format={(v) => `${v}%`}
          />
          <ChoiceRow label={t('Brush shape')}>
              {(['arc', 'rect'] as const).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => s.setBrush({ type: shape })}
                  className={`mask-editor-brush-shape-option px-3 py-1 rounded-lg border text-xs ${
                    s.brush.type === shape
                      ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
                      : 'border-white/10 text-slate-300'
                  }`}
                >
                  {shape === 'arc' ? t('Round') : t('Square')}
                </button>
              ))}
          </ChoiceRow>
          {s.tool === 'rgbPaint' && (
            <label className="mask-editor-paint-color flex items-center justify-between gap-3 py-1.5">
              <span className="text-xs text-slate-400">{t('Paint color')}</span>
              <input
                type="color"
                value={s.rgbColor}
                onChange={(e) => s.setRgbColor(e.target.value)}
                className="mask-editor-paint-color-input h-8 w-14 rounded border border-white/10 bg-transparent"
              />
            </label>
          )}
        </div>
      )}

      {s.tool === 'paintBucket' && (
        <div className="mask-editor-bucket-settings">
          <Slider
            label={t('Tolerance')}
            value={s.paintBucketTolerance}
            min={0}
            max={255}
            step={1}
            onChange={s.setPaintBucketTolerance}
          />
          <Slider
            label={t('Fill opacity')}
            value={s.fillOpacity}
            min={1}
            max={100}
            step={1}
            onChange={s.setFillOpacity}
            format={(v) => `${v}%`}
          />
          <p className="mask-editor-hint pt-1 text-[11px] leading-snug text-slate-500">
            {t('Fills the connected area that shares the tapped point’s mask state. Tap masked pixels to clear that area instead.')}
          </p>
        </div>
      )}

      {s.tool === 'colorSelect' && (
        <div className="mask-editor-color-select-settings">
          <Slider
            label={t('Tolerance')}
            value={s.colorSelectTolerance}
            min={0}
            max={255}
            step={1}
            onChange={s.setColorSelectTolerance}
          />
          <Slider
            label={t('Selection opacity')}
            value={s.selectionOpacity}
            min={1}
            max={100}
            step={1}
            onChange={s.setSelectionOpacity}
            format={(v) => `${v}%`}
          />
          <ChoiceRow label={t('Compare by')}>
              {(['simple', 'hsl', 'lab'] as ColorComparisonMethod[]).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => s.setColorComparisonMethod(method)}
                  className={`mask-editor-compare-option px-3 py-1 rounded-lg border text-xs uppercase ${
                    s.colorComparisonMethod === method
                      ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
                      : 'border-white/10 text-slate-300'
                  }`}
                >
                  {method === 'simple' ? t('RGB') : method.toUpperCase()}
                </button>
              ))}
          </ChoiceRow>
          <Toggle
            label={t('Apply to the whole image, not just the tapped area')}
            checked={s.applyWholeImage}
            onChange={s.setApplyWholeImage}
          />
          <Toggle
            label={t('Stop at existing mask edges')}
            checked={s.maskBoundary}
            onChange={s.setMaskBoundary}
          />
          {s.maskBoundary && (
            <Slider
              label={t('Edge tolerance')}
              value={s.maskTolerance}
              min={0}
              max={255}
              step={1}
              onChange={s.setMaskTolerance}
            />
          )}
        </div>
      )}

      <div className="mask-editor-display-settings mt-2 border-t border-white/5 pt-2">
        <ChoiceRow label={t('Mask display')}>
            {(['black', 'white', 'negative'] as MaskBlendMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => s.setMaskBlendMode(mode)}
                className={`mask-editor-blend-option px-3 py-1 rounded-lg border text-xs ${
                  s.maskBlendMode === mode
                    ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
                    : 'border-white/10 text-slate-300'
                }`}
              >
                {mode === 'black' ? t('Black') : mode === 'white' ? t('White') : t('Negative')}
              </button>
            ))}
        </ChoiceRow>
        {/* Negative draws the mask as a difference blend at full strength, so
            an opacity slider would do nothing there. */}
        {s.maskBlendMode !== 'negative' && (
          <Slider
            label={t('Mask opacity')}
            value={Math.round(s.maskOpacity * 100)}
            min={10}
            max={100}
            step={1}
            onChange={(v) => s.setMaskOpacity(v / 100)}
            format={(v) => `${v}%`}
          />
        )}
      </div>
    </div>
  );
}
