import { useEffect, useMemo, useState } from 'react';
import { CheckIcon } from '@/components/icons';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useI18n } from '@/i18n';
import {
  formatVariationValue,
  type WidgetVariationTarget,
} from '@/utils/widgetVariations';

interface WidgetVariationsModalProps {
  /** Which widget the runs vary, and where it lives. */
  target: WidgetVariationTarget;
  /** Widget label, shown in the header and written into each run's queue label. */
  widgetName: string;
  /** The node the widget belongs to, for the header's context line. */
  nodeName: string;
  /** Every option the widget can take, already de-duplicated. */
  options: unknown[];
  /** The widget's value right now — preselected, and marked in the list. */
  currentValue: unknown;
  onClose: () => void;
}

/**
 * Pick which of a combo widget's options to enqueue a run for.
 *
 * One run per checked option, everything else in the workflow held exactly as
 * it stands — seed modes included, so a seed set to randomize does NOT advance
 * between the runs. That is the whole point: the checked widget is the only
 * thing that differs, which is what makes the outputs comparable.
 *
 * The list scrolls between a pinned header and footer so the selection tools
 * and the submit button stay reachable on a phone, however long the list is
 * (a `lora_name` combo can run to hundreds of entries).
 */
export function WidgetVariationsModal({
  target,
  widgetName,
  nodeName,
  options,
  currentValue,
  onClose,
}: WidgetVariationsModalProps) {
  const { t } = useI18n();
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const [submitting, setSubmitting] = useState(false);

  // Keyed by the formatted value: an option list is not guaranteed to hold
  // primitives, and index keys would break if the list is ever re-resolved.
  const keys = useMemo(() => options.map((option) => formatVariationValue(option)), [options]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set([formatVariationValue(currentValue)].filter((key) => keys.includes(key))),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRun = async () => {
    // Preserve the list's order rather than click order, so the queue reads
    // the same way the picker did.
    const values = options.filter((_, index) => selected.has(keys[index]));
    if (values.length === 0 || submitting) return;
    setSubmitting(true);
    const queued = await queueWorkflow(values.length, undefined, false, false, {
      ...target,
      widgetName,
      values,
    });
    setSubmitting(false);
    if (queued) onClose();
  };

  const selectedCount = selected.size;

  return (
    <div
      id="widget-variations-overlay"
      className="fixed inset-0 z-[2150] bg-black/50 flex items-center justify-center p-4"
      onClick={submitting ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('Enqueue with variations')}
    >
      <div
        id="widget-variations-modal"
        className="w-full max-w-sm max-h-[85vh] flex flex-col bg-slate-900 border border-white/10 text-slate-100 rounded-xl shadow-lg overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="widget-variations-header shrink-0 px-4 py-3 border-b border-white/10">
          <div className="text-sm font-semibold text-slate-100">
            {t('Enqueue with variations')}
          </div>
          <div className="widget-variations-subject mt-0.5 text-xs text-slate-400 truncate">
            {nodeName} · {widgetName}
          </div>
        </div>

        <div className="widget-variations-toolbar shrink-0 px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <button
            type="button"
            className="widget-variations-select-all px-2.5 py-1.5 text-xs font-medium text-cyan-300 hover:bg-white/10 rounded-lg disabled:opacity-40"
            onClick={() => setSelected(new Set(keys))}
            disabled={submitting || selectedCount === keys.length}
          >
            {t('Select all')}
          </button>
          <button
            type="button"
            className="widget-variations-deselect-all px-2.5 py-1.5 text-xs font-medium text-cyan-300 hover:bg-white/10 rounded-lg disabled:opacity-40"
            onClick={() => setSelected(new Set())}
            disabled={submitting || selectedCount === 0}
          >
            {t('Deselect all')}
          </button>
          <span className="widget-variations-count ml-auto text-xs text-slate-400 tabular-nums">
            {t('{count} of {total}', { count: selectedCount, total: options.length })}
          </span>
        </div>

        <div className="widget-variations-options flex-1 min-h-0 overflow-y-auto">
          {options.map((option, index) => {
            const key = keys[index];
            const checked = selected.has(key);
            const isCurrent = key === formatVariationValue(currentValue);
            return (
              <button
                key={`${key}:${index}`}
                type="button"
                role="checkbox"
                aria-checked={checked}
                className="widget-variations-option w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/10 disabled:opacity-60"
                onClick={() => toggle(key)}
                disabled={submitting}
              >
                <span
                  aria-hidden="true"
                  className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center ${
                    checked
                      ? 'bg-cyan-400 border-cyan-300 text-slate-900'
                      : 'border-white/25 text-transparent'
                  }`}
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                </span>
                <span className="flex-1 text-sm text-slate-100 break-all">{key}</span>
                {isCurrent && (
                  <span className="widget-variations-current shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
                    {t('current')}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="widget-variations-footer shrink-0 px-4 py-3 border-t border-white/10">
          <p className="widget-variations-note text-xs text-slate-400">
            {t('Every other setting is held fixed, including seeds set to randomize.')}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 rounded-lg disabled:opacity-60"
              onClick={onClose}
              disabled={submitting}
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="widget-variations-run px-3 py-2 text-sm font-medium text-slate-900 bg-cyan-300 hover:bg-cyan-200 rounded-lg disabled:opacity-40"
              onClick={handleRun}
              disabled={submitting || selectedCount === 0}
            >
              {submitting ? t('Queuing…') : t('Run variations')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
