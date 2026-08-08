import { useEffect, useRef, useState } from 'react';
import { DownloadDeviceIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface DownloadButtonProps {
  /**
   * Fires when the user taps the button. May return a Promise — when it
   * does, the in-button spinner stays on screen until the Promise resolves
   * (so a slow save reads as actively working) and `onLoadingChange` is
   * fired at both ends of the wait. Sync onClicks fall back to a short
   * fixed flash so the tap doesn't feel dead.
   */
  onClick: () => void | Promise<void>;
  /** Reserved for callers that pass a stable per-image id; currently unused. */
  fileId?: string | null;
  /**
   * Bubbles the loading state up so a parent (e.g. the image viewer) can
   * suppress its idle/auto-hide timer while the download is in flight.
   */
  onLoadingChange?: (loading: boolean) => void;
}

// Minimum spinner hold for synchronous onClicks. Long enough that the user
// sees the tap registered, short enough that consecutive downloads don't
// queue spinners on top of each other.
const SYNC_SPINNER_MS = 700;

export function DownloadButton({
  onClick,
  onLoadingChange,
}: DownloadButtonProps) {
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The re-entrancy guard has to be a ref, not `loading`: state doesn't update
  // within the tick, so two clicks delivered before a re-render (a double-tap
  // that lands in one batch, or a touch followed by its synthetic click) would
  // both get past a state check and save the file twice.
  const inFlightRef = useRef(false);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const finishLoading = () => {
    inFlightRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLoading(false);
    onLoadingChange?.(false);
  };

  const startDownload = () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    onLoadingChange?.(true);
    let result: void | Promise<void>;
    try {
      result = onClick();
    } catch (err) {
      console.error('DownloadButton onClick threw', err);
      finishLoading();
      return;
    }
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).finally(finishLoading);
      return;
    }
    // Sync click — hold the spinner briefly so a fast download still flashes
    // feedback, then drop back to the disk icon.
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      inFlightRef.current = false;
      setLoading(false);
      onLoadingChange?.(false);
    }, SYNC_SPINNER_MS);
  };

  const ariaLabel = loading ? 'Downloading…' : 'Download';

  return (
    <OverlayCircleButton
      onClick={startDownload}
      ariaLabel={ariaLabel}
      className="text-white"
      icon={
        loading ? (
          <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        ) : (
          <DownloadDeviceIcon className="w-5 h-5" />
        )
      }
    />
  );
}
