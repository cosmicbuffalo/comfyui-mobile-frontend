import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnectionStatusStore } from '../hooks/useConnectionStatus';

// How long the websocket may stay disconnected before we block the UI with the
// connection-lost overlay. Short outages (a quick restart, a momentary network
// hiccup) recover on their own well within this window, so we hold off rather
// than flashing a full-screen modal for a blip.
export const CONNECTION_LOST_OVERLAY_DELAY_MS = 4000;

interface BackendStatusOverlayProps {
  eyebrow: string;
  title: string;
  message: string;
}

/**
 * Full-screen, non-dismissable overlay used while the backend is unavailable.
 * It both informs the user and blocks every interaction underneath, so any
 * action that would hit the backend is inert until we recover.
 */
export function BackendStatusOverlay({ eyebrow, title, message }: BackendStatusOverlayProps) {
  return createPortal(
    <div className="fixed inset-0 z-[3200] bg-slate-950/88 backdrop-blur-md flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-slate-900/95 shadow-2xl px-6 py-7 text-white">
        <div className="flex items-center gap-4">
          <div className="relative h-12 w-12 shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-400/25" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-300 animate-spin" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/80">
              {eyebrow}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              {title}
            </h2>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-300">
          {message}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Watches the live connection and, once we've been disconnected longer than the
 * grace window, drops a blocking overlay over the whole app until the backend
 * comes back. Defers to the server-restart overlay during a deliberate restart.
 */
export function ConnectionLostOverlay() {
  const isConnected = useConnectionStatusStore((s) => s.isConnected);
  const hasEverConnected = useConnectionStatusStore((s) => s.hasEverConnected);
  const serverRestarting = useConnectionStatusStore((s) => s.serverRestarting);

  // Until the first successful connect, a disconnected socket just means we're
  // still establishing contact — not that we lost a backend we had. Showing
  // "Lost contact" there would be wrong, so hold the overlay back. Mounting
  // the grace-timer component only while disconnected means reconnecting
  // unmounts it and a fresh disconnect always starts a fresh grace window.
  if (isConnected || !hasEverConnected || serverRestarting) return null;

  return <ConnectionLostOverlayAfterGrace />;
}

function ConnectionLostOverlayAfterGrace() {
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setGraceElapsed(true),
      CONNECTION_LOST_OVERLAY_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  if (!graceElapsed) return null;

  return (
    <BackendStatusOverlay
      eyebrow="Connection Lost"
      title="Reconnecting…"
      message="Lost contact with the ComfyUI backend. Trying to reconnect — the app will recover automatically as soon as the server is back online."
    />
  );
}
