import { useEffect } from 'react';
import { useWorkflowUndoStore } from '@/hooks/useWorkflowUndo';
import { useI18n } from '@/i18n';

const UNDO_FEEDBACK_MS = 1800;

export function WorkflowUndoToast() {
  const { t } = useI18n();
  const feedback = useWorkflowUndoStore((state) => state.feedback);
  const clearFeedback = useWorkflowUndoStore((state) => state.clearFeedback);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => clearFeedback(feedback.id), UNDO_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [clearFeedback, feedback]);

  if (!feedback) return null;
  const direction = feedback.direction === 'undo' ? t('Undo') : t('Redo');
  const target = feedback.target;

  return (
    <div
      key={feedback.id}
      role="status"
      aria-live="polite"
      className="undo-toast pointer-events-none absolute left-1/2 top-4 z-[1300] max-w-[min(88vw,22rem)] -translate-x-1/2 rounded-lg border border-white/10 bg-slate-900/95 px-4 py-2 text-center shadow-lg animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="undo-toast-action whitespace-nowrap text-sm font-medium text-slate-100">
        {direction}: {t(feedback.actionLabel)}
      </div>
      {/* Which item the step moved. A step that changed something with no card
          of its own (a link, say) has nothing to name, and shows one line. */}
      {target && (
        <div className="undo-toast-target mt-0.5 truncate text-xs font-normal text-slate-400">
          {target.name}
          <span className="ml-1 text-slate-500">#{target.id}</span>
          {/* The widget the step changed, when it changed exactly one — the
              same row the panel scrolls to. */}
          {target.widgetLabel && (
            <span className="undo-toast-widget ml-1 text-slate-400">
              <span className="text-slate-600">·</span> {target.widgetLabel}
            </span>
          )}
          {target.extraCount > 0 && (
            <span className="ml-1 text-slate-500">
              {t('+{count} more', { count: target.extraCount })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
