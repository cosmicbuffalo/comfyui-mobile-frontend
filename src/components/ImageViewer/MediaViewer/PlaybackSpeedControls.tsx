import { useCallback, useEffect, useRef, useState } from 'react';
import { OverlayCircleButton } from '@/components/buttons/OverlayCircleButton';
import { ReloadIcon, SpeedIcon } from '@/components/icons';
import { useI18n } from '@/i18n';

const MIN_PLAYBACK_RATE = 0.1;
const MAX_PLAYBACK_RATE = 2;
const SPEED_TRACK_LENGTH_PX = 176;
const SPEED_THUMB_SIZE_PX = 18;

interface PlaybackSpeedControlsProps {
  rate: number;
  open: boolean;
  isIdle: boolean;
  zIndex: number;
  rightInset?: string;
  onOpenChange: (open: boolean) => void;
  onRateChange: (rate: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

function formatRatePercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function PlaybackSpeedControls({
  rate,
  open,
  isIdle,
  zIndex,
  rightInset,
  onOpenChange,
  onRateChange,
  onInteractionStart,
  onInteractionEnd,
}: PlaybackSpeedControlsProps) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const [sliderReady, setSliderReady] = useState(false);
  const normalizedRate = Math.min(
    1,
    Math.max(0, (rate - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE)),
  );
  const percent = formatRatePercent(rate);
  const isDefaultRate = Math.abs(rate - 1) < 0.001;
  const right = rightInset ? `calc(0.75rem + ${rightInset})` : undefined;
  // Native range thumbs travel between their radii rather than all the way to
  // the input edges. Match that geometry so the readout's center stays exactly
  // level with the visible thumb throughout the drag.
  const bubbleTop = 12 + SPEED_THUMB_SIZE_PX / 2
    + (1 - normalizedRate) * (SPEED_TRACK_LENGTH_PX - SPEED_THUMB_SIZE_PX);

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    onInteractionEnd();
  }, [onInteractionEnd]);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('pointerup', finishDrag, { once: true });
    window.addEventListener('pointercancel', finishDrag, { once: true });
    return () => {
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [dragging, finishDrag]);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the range must be disarmed whenever its controlled popover closes
      setSliderReady(false);
      return;
    }
    // Do not put the range beneath the pointer that opened the control. Some
    // touch engines retarget the end of that same gesture after the button has
    // stretched, which turns the opening tap into an unintended speed change.
    // Fade the range in only after the height morph has completed.
    const timer = window.setTimeout(() => setSliderReady(true), 300);
    return () => window.clearTimeout(timer);
  }, [open]);

  const rateFromPointer = (element: HTMLDivElement, clientY: number): number => {
    const rect = element.getBoundingClientRect();
    const thumbRadius = SPEED_THUMB_SIZE_PX / 2;
    const top = rect.top + 12 + thumbRadius;
    const bottom = rect.top + 12 + SPEED_TRACK_LENGTH_PX - thumbRadius;
    const pointerRatio = 1 - (Math.min(bottom, Math.max(top, clientY)) - top) / (bottom - top);
    return Math.round(
      (MIN_PLAYBACK_RATE + pointerRatio * (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE)) * 100,
    ) / 100;
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    onInteractionStart();
    onRateChange(rateFromPointer(event.currentTarget, event.clientY));
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    onRateChange(rateFromPointer(event.currentTarget, event.clientY));
  };

  const handleSliderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextRate: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') nextRate = rate + 0.01;
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') nextRate = rate - 0.01;
    if (event.key === 'Home') nextRate = MIN_PLAYBACK_RATE;
    if (event.key === 'End') nextRate = MAX_PLAYBACK_RATE;
    if (nextRate == null) return;
    event.preventDefault();
    onInteractionStart();
    onRateChange(Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, nextRate)));
    onInteractionEnd();
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label={t('Close playback speed controls')}
          className="playback-speed-dismiss fixed inset-0 cursor-default bg-transparent"
          style={{ zIndex: zIndex - 1 }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onOpenChange(false);
          }}
        />
      )}

      <div
        className={`playback-speed-control fixed top-[6.5rem] flex flex-col items-center gap-3 transition-opacity duration-300 ${
          isIdle ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
        }`}
        style={{ right: right ?? '0.75rem', zIndex }}
      >
        <div
          data-state={open ? 'open' : 'closed'}
          className={`relative w-9 rounded-[18px] shadow-lg backdrop-blur-sm ${
            open
              ? 'bg-black/55'
              : isDefaultRate
                ? 'bg-black/45 hover:bg-black/60'
                : 'bg-cyan-400/25 shadow-cyan-400/25 hover:bg-cyan-400/35'
          }`}
          style={{
            height: open ? 200 : 36,
            transition: 'height 300ms cubic-bezier(0, 0, 0.2, 1), background-color 200ms ease',
          }}
        >
          {!open ? (
            <button
              type="button"
              aria-label={t('Playback speed')}
              aria-expanded="false"
              title={`${t('Playback speed')}: ${percent}`}
              className={`flex h-full w-full items-center justify-center rounded-full ${
                isDefaultRate ? 'text-white' : 'text-cyan-100'
              }`}
              onClick={() => onOpenChange(true)}
            >
              <SpeedIcon className="h-5 w-5" />
            </button>
          ) : sliderReady ? (
            <div className="absolute inset-0">
              {dragging && (
                <output
                  aria-live="off"
                  className="pointer-events-none absolute right-[calc(100%+0.5rem)] min-w-14 -translate-y-1/2 rounded-md bg-black/75 px-2 py-1 text-center text-sm font-semibold text-white tabular-nums shadow-lg"
                  style={{ top: bubbleTop }}
                >
                  {percent}
                  <span
                    aria-hidden="true"
                    className="absolute left-full top-1/2 -translate-y-1/2 border-y-[5px] border-l-[6px] border-y-transparent border-l-black/75"
                  />
                </output>
              )}
              <div
                role="slider"
                tabIndex={0}
                aria-label={t('Playback speed')}
                aria-valuemin={MIN_PLAYBACK_RATE}
                aria-valuemax={MAX_PLAYBACK_RATE}
                aria-valuenow={rate}
                aria-valuetext={percent}
                className="absolute inset-0 cursor-ns-resize touch-none rounded-[18px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                onPointerDown={beginDrag}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onKeyDown={handleSliderKeyDown}
              >
                <div className="pointer-events-none absolute left-1/2 top-[21px] bottom-[21px] w-1 -translate-x-1/2 overflow-hidden rounded-full bg-white/35">
                  <div
                    className="absolute inset-x-0 bottom-0 bg-cyan-400"
                    style={{ height: `${normalizedRate * 100}%` }}
                  />
                </div>
                <div
                  className="pointer-events-none absolute left-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400 shadow-md"
                  style={{ top: bubbleTop }}
                />
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-[7px] text-white/50">
              <SpeedIcon className="h-5 w-5 scale-75 opacity-0 transition-[opacity,transform] duration-200" />
            </div>
          )}
        </div>

        {!isDefaultRate && (
          <div className="playback-speed-reset transition-transform duration-300 ease-out">
            <OverlayCircleButton
              onClick={() => {
                onRateChange(1);
                onInteractionEnd();
              }}
              ariaLabel={t('Reset playback speed')}
              title={t('Reset playback speed')}
              className="text-white"
              icon={<ReloadIcon className="h-4.5 w-4.5" />}
            />
          </div>
        )}
      </div>
    </>
  );
}
