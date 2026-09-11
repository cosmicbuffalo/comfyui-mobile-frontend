import type { MouseEvent } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useLongPress } from '@/hooks/useLongPress';
import { appChromeIconButtonClassName } from '@/components/chromeStyles';

export function RunCountSelector() {
  const runCount = useWorkflowStore((s) => s.runCount);
  const setRunCount = useWorkflowStore((s) => s.setRunCount);

  // Holding either button jumps by a factor instead of a step, so getting from
  // 1 to 64 is six holds rather than sixty-three taps. setRunCount floors and
  // clamps to 1, so halving bottoms out there rather than at zero.
  const { handlers: decrementHoldHandlers, consumeLongPress: consumeDecrementHold } = useLongPress({
    onLongPress: () => { setRunCount(runCount / 2); },
    enabled: runCount > 1,
  });
  const { handlers: incrementHoldHandlers, consumeLongPress: consumeIncrementHold } = useLongPress({
    onLongPress: () => { setRunCount(runCount * 2); },
  });

  // A real pointer click follows pointerup, so a hold that already doubled must
  // eat the click that trails it or the count moves twice. Keyboard activation
  // reports detail 0 and stays an ordinary single step.
  const stepOnClick = (
    consumeHold: () => boolean,
    step: () => void,
  ) => (event: MouseEvent<HTMLButtonElement>) => {
    const triggered = consumeHold();
    if (event.detail !== 0 && triggered) {
      event.preventDefault();
      return;
    }
    step();
  };

  return (
    // `select-none` on the whole control, not just its buttons: holding − or +
    // to halve/double is a first-class gesture here, and iOS answers a long
    // press over any of this by starting a text selection — the glyph and the
    // count between them come up highlighted, with selection handles on top of
    // the buttons. The app-wide `-webkit-touch-callout: none` in index.css only
    // suppresses the share sheet; selection is governed separately.
    <div
      id="run-count-selector"
      className="flex select-none touch-manipulation items-center gap-1 bg-slate-900/95 border border-white/10 rounded-lg p-1"
    >
      <button
        onClick={stepOnClick(consumeDecrementHold, () => setRunCount(runCount - 1))}
        {...decrementHoldHandlers}
        disabled={runCount <= 1}
        className={`run-count-decrement w-10 h-10 rounded-lg flex items-center justify-center text-lg font-medium disabled:opacity-40 disabled:shadow-none ${appChromeIconButtonClassName}`}
      >
        −
      </button>
      <span className="run-count-value w-8 text-center font-semibold text-slate-100">
        {runCount}
      </span>
      <button
        onClick={stepOnClick(consumeIncrementHold, () => setRunCount(runCount + 1))}
        {...incrementHoldHandlers}
        className={`run-count-increment w-10 h-10 rounded-lg flex items-center justify-center text-lg font-medium ${appChromeIconButtonClassName}`}
      >
        +
      </button>
    </div>
  );
}
