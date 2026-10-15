import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchServerLogs,
  formatServerLogEntries,
  SERVER_LOGS_EVENT,
  setServerLogsSubscription,
  type ServerLogEntry,
} from '@/api/client';
import { CheckIcon, CopyIcon } from '@/components/icons';
import { FullscreenModalHeader } from '@/components/modals/FullscreenModalHeader';
import { Z_LAYERS } from '@/components/zLayers';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useConnectionStatusStore } from '@/hooks/useConnectionStatus';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { useServerLogsWindowStore, type WindowGeometry } from '@/hooks/useServerLogsWindow';
import { useI18n } from '@/i18n';
import { copyTextToClipboard } from '@/utils/clipboard';

// Within this many pixels of the end counts as following the live output.
const FOLLOW_THRESHOLD_PX = 24;
// How much of the window must stay on screen while dragging, so it can't be
// lost off an edge.
const MIN_VISIBLE_PX = 80;

// Keep enough of the window on screen to grab its header again.
function clampPosition(x: number, y: number, width: number) {
  return {
    x: Math.min(Math.max(x, MIN_VISIBLE_PX - width), window.innerWidth - MIN_VISIBLE_PX),
    y: Math.min(Math.max(y, 0), window.innerHeight - MIN_VISIBLE_PX),
  };
}

// Where the window opens: where the user last left it, or centered at half the
// screen the first time.
function initialGeometry(saved: WindowGeometry | null): WindowGeometry {
  const width = Math.min(window.innerWidth, Math.max(320, saved?.width ?? Math.round(window.innerWidth / 2)));
  const height = Math.min(window.innerHeight, Math.max(200, saved?.height ?? Math.round(window.innerHeight / 2)));
  const { x, y } = saved
    ? clampPosition(saved.x, saved.y, width)
    : { x: Math.round(window.innerWidth / 4), y: Math.round(window.innerHeight / 4) };
  return { x, y, width, height };
}

interface ServerLogsWindowProps {
  onClose: () => void;
}

// On desktop, a floating window you can move (drag the header) and resize (the
// corner handle) and keep open while working; nothing behind it is blocked. On
// phones there's no room to work beside it, so it's a fullscreen modal.
export function ServerLogsWindow({ onClose }: ServerLogsWindowProps) {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const windowRef = useRef<HTMLDivElement>(null);
  const setGeometry = useServerLogsWindowStore((s) => s.setGeometry);
  // Size is only applied at open; after that the CSS resize handle owns it.
  const [opening] = useState(() => initialGeometry(useServerLogsWindowStore.getState().geometry));
  const [position, setPosition] = useState({ x: opening.x, y: opening.y });
  // Read by the resize observer, which outlives a render.
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  useBodyScrollLock(!isDesktop);
  useModalKeyboard(!isDesktop, onClose, windowRef);
  const isConnected = useConnectionStatusStore((s) => s.isConnected);
  const [logs, setLogs] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(true);

  // Subscribe before taking the snapshot so output cannot fall between them.
  // Keep snapshot identities until their delayed flush arrives over the socket.
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    let loading = true;
    let snapshotTime = '';
    const pending: ServerLogEntry[] = [];
    const snapshotCounts = new Map<string, number>();
    const entryKey = (entry: ServerLogEntry) => JSON.stringify([entry.t, entry.m]);
    const withoutSnapshotDuplicates = (entries: ServerLogEntry[]) => entries.filter((entry) => {
      const key = entryKey(entry);
      const count = snapshotCounts.get(key) ?? 0;
      // The server can overwrite progress entries before flushing them. Those
      // older updates are already represented by the snapshot's latest line.
      if (!count) return entry.t >= snapshotTime;
      if (count === 1) snapshotCounts.delete(key);
      else snapshotCounts.set(key, count - 1);
      return false;
    });
    const onLogs = (event: Event) => {
      const { entries } = (event as CustomEvent<{ entries: ServerLogEntry[] }>).detail;
      if (loading) {
        pending.push(...entries);
      } else {
        const fresh = withoutSnapshotDuplicates(entries);
        if (fresh.length) setLogs((prev) => formatServerLogEntries(fresh, prev ?? ''));
      }
    };
    window.addEventListener(SERVER_LOGS_EVENT, onLogs);
    const stop = () => {
      if (cancelled) return;
      cancelled = true;
      pending.length = 0;
      window.removeEventListener(SERVER_LOGS_EVENT, onLogs);
      void setServerLogsSubscription(false).catch(() => {});
    };
    void (async () => {
      // A rejected subscription still allows the snapshot to be read.
      await setServerLogsSubscription(true).catch(() => {});
      if (cancelled) return;
      let backlog: ServerLogEntry[];
      try {
        backlog = await fetchServerLogs();
      } catch {
        if (!cancelled) {
          setFailed(true);
          stop();
        }
        return;
      }
      if (cancelled) return;
      for (const entry of backlog) {
        const key = entryKey(entry);
        snapshotCounts.set(key, (snapshotCounts.get(key) ?? 0) + 1);
        if (entry.t > snapshotTime) snapshotTime = entry.t;
      }
      const merged = [...backlog, ...withoutSnapshotDuplicates(pending)]
        .sort((a, b) => a.t.localeCompare(b.t));
      setLogs(formatServerLogEntries(merged));
      setFailed(false);
      pending.length = 0;
      loading = false;
    })();
    return stop;
  }, [isConnected]);

  // The newest output is what you came for: open at the bottom, and keep
  // following new lines unless you've scrolled up to read something.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const handleScroll = () => {
    const el = logRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD_PX;
  };

  useEffect(() => {
    const el = windowRef.current;
    if (!isDesktop || !el) return;
    const keepVisible = () => {
      const next = clampPosition(positionRef.current.x, positionRef.current.y, el.offsetWidth);
      positionRef.current = next;
      setPosition(next);
      setGeometry({ ...next, width: el.offsetWidth, height: el.offsetHeight });
    };
    const observer = new ResizeObserver(keepVisible);
    observer.observe(el);
    window.addEventListener('resize', keepVisible);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', keepVisible);
    };
  }, [isDesktop, setGeometry]);

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDesktop || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const el = windowRef.current;
    if (!el) return;
    const startX = event.clientX - position.x;
    const startY = event.clientY - position.y;
    let last = position;
    const onMove = (move: PointerEvent) => {
      last = clampPosition(move.clientX - startX, move.clientY - startY, el.offsetWidth);
      setPosition(last);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGeometry({ ...last, width: el.offsetWidth, height: el.offsetHeight });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleCopy = async () => {
    if (!logs) return;
    if (await copyTextToClipboard(logs)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return createPortal(
    <div
      ref={windowRef}
      role="dialog"
      aria-modal={!isDesktop}
      aria-label={t('Server logs')}
      data-swipe-nav-ignore="true"
      className={isDesktop
        ? 'server-logs-window fixed flex flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl resize min-w-[320px] min-h-[200px] max-w-[100vw] max-h-[100vh]'
        : 'server-logs-window fixed inset-0 flex flex-col bg-slate-950 text-slate-100 safe-area-top'}
      style={isDesktop
        ? { zIndex: Z_LAYERS.floatingWindow, left: position.x, top: position.y, width: opening.width, height: opening.height }
        : { zIndex: Z_LAYERS.fullscreenPanel }}
    >
      <div
        onPointerDown={handleDragStart}
        className={isDesktop ? 'cursor-move select-none' : undefined}
      >
        <FullscreenModalHeader
          title={t('Server logs')}
          onClose={onClose}
          headerActions={(
            <button
              type="button"
              aria-label={t('Copy to clipboard')}
              onClick={handleCopy}
              disabled={!logs}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 disabled:opacity-40"
            >
              {copied ? <CheckIcon className="w-5 h-5 text-emerald-400" /> : <CopyIcon className="w-5 h-5" />}
            </button>
          )}
        />
      </div>

      {failed ? (
        <p className="py-12 text-center text-sm text-slate-400">
          {t('Could not load the server logs.')}
        </p>
      ) : logs === null ? (
        <p className="py-12 text-center text-sm text-slate-400">{t('Loading...')}</p>
      ) : (
        <pre
          ref={logRef}
          onScroll={handleScroll}
          className="server-logs flex-1 min-h-0 overflow-auto overscroll-contain p-3 font-mono text-[11px] leading-snug text-slate-200 whitespace-pre-wrap break-words"
        >
          {logs || t('No log output yet.')}
        </pre>
      )}
    </div>,
    document.body,
  );
}
