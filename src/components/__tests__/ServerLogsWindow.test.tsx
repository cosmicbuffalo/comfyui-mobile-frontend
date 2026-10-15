import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_LOG_MAX_LINES, SERVER_LOGS_EVENT, type ServerLogEntry } from '@/api/client';
import { useConnectionStatusStore } from '@/hooks/useConnectionStatus';
import { useServerLogsWindowStore } from '@/hooks/useServerLogsWindow';
import { ServerLogsWindow } from '../ServerLogsWindow';

function mockServer(backlog: string[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/internal/logs/raw') {
      return { ok: true, json: async () => ({ entries: backlog.map((m) => ({ t: '', m })) }) };
    }
    if (url === '/internal/logs/subscribe' && init?.method === 'PATCH') return { ok: true };
    return { ok: false };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const subscriptionCalls = (fetchMock: ReturnType<typeof mockServer>) =>
  fetchMock.mock.calls
    .filter(([url]) => url === '/internal/logs/subscribe')
    .map(([, init]) => JSON.parse(String(init?.body)).enabled);

const emitLogs = (entries: ServerLogEntry[]) => {
  window.dispatchEvent(new CustomEvent(SERVER_LOGS_EVENT, { detail: { entries } }));
};

describe('ServerLogsWindow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useConnectionStatusStore.setState({ isConnected: true });
    useServerLogsWindowStore.setState({ geometry: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.style.removeProperty('--top-bar-offset');
    document.documentElement.style.removeProperty('--bottom-bar-offset');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const logText = () => document.body.querySelector('.server-logs')?.textContent;

  it('shows the backlog without colour codes, then streams new output', async () => {
    const fetchMock = mockServer(['[\x1b[34mMobile\x1b[0m] ready\n']);

    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    expect(logText()).toBe('[Mobile] ready\n');
    expect(subscriptionCalls(fetchMock)).toEqual([true]);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(SERVER_LOGS_EVENT, {
        detail: { entries: [{ t: '', m: 'Prompt executed in 3.2 seconds\n' }] },
      }));
    });
    expect(logText()).toBe('[Mobile] ready\nPrompt executed in 3.2 seconds\n');

    await act(async () => root.unmount());
    root = createRoot(container);
    expect(subscriptionCalls(fetchMock)).toEqual([true, false]);
  });

  it('reloads and subscribes again after the connection comes back', async () => {
    const backlog = ['before restart\n'];
    const fetchMock = mockServer(backlog);
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));

    backlog.splice(0, 1, 'after restart\n');
    await act(async () => useConnectionStatusStore.setState({ isConnected: false }));
    await act(async () => useConnectionStatusStore.setState({ isConnected: true }));

    expect(logText()).toBe('after restart\n');
    expect(subscriptionCalls(fetchMock)).toEqual([true, false, true]);
  });

  it('subscribes before the snapshot and merges buffered and delayed output without duplicates', async () => {
    const ready = { t: '2026-10-14T12:00:00.000001', m: 'ready\n' };
    const overlap = { t: '2026-10-14T12:00:00.000002', m: 'repeated message\n' };
    const repeated = { t: '2026-10-14T12:00:00.000003', m: 'repeated message\n' };
    const later = { t: '2026-10-14T12:00:00.000004', m: 'during snapshot request\n' };
    let resolveSnapshot!: (entries: ServerLogEntry[]) => void;
    const snapshot = new Promise<ServerLogEntry[]>((resolve) => { resolveSnapshot = resolve; });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/internal/logs/raw') {
        return { ok: true, json: async () => ({ entries: await snapshot }) };
      }
      return { ok: true };
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/internal/logs/subscribe', '/internal/logs/raw',
    ]);
    await act(async () => {
      emitLogs([overlap, repeated, later]);
      resolveSnapshot([ready, overlap]);
    });
    expect(logText()).toBe('ready\nrepeated message\nrepeated message\nduring snapshot request\n');

    // A snapshot entry may not have been flushed until after the load finished.
    await act(async () => emitLogs([ready, { ...ready, t: '2026-10-14T12:00:00.000005' }]));
    expect(logText()).toBe('ready\nrepeated message\nrepeated message\nduring snapshot request\nready\n');
  });

  it('keeps buffered progress updates in time order with the snapshot', async () => {
    let resolveSnapshot!: (entries: ServerLogEntry[]) => void;
    const snapshot = new Promise<ServerLogEntry[]>((resolve) => { resolveSnapshot = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/raw')
      ? { ok: true, json: async () => ({ entries: await snapshot }) }
      : { ok: true }));
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    const progress = { t: '2026-10-14T12:00:00.000002', m: '\rSampling 20%' };
    await act(async () => {
      emitLogs([{ t: '2026-10-14T12:00:00.000001', m: '\rSampling 10%' }]);
      resolveSnapshot([progress]);
    });
    expect(logText()).toBe('Sampling 20%');
    await act(async () => emitLogs([
      { t: '2026-10-14T12:00:00.000001', m: '\rSampling 10%' }, progress,
    ]));
    expect(logText()).toBe('Sampling 20%');
  });

  it('ignores an old snapshot that finishes after reconnecting', async () => {
    let resolveOldSnapshot!: (entries: ServerLogEntry[]) => void;
    const oldSnapshot = new Promise<ServerLogEntry[]>((resolve) => { resolveOldSnapshot = resolve; });
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.endsWith('/raw')) return { ok: true };
      reads += 1;
      return {
        ok: true,
        json: async () => ({ entries: reads === 1 ? await oldSnapshot : [{ t: '', m: 'after restart\n' }] }),
      };
    }));
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    await act(async () => useConnectionStatusStore.setState({ isConnected: false }));
    await act(async () => useConnectionStatusStore.setState({ isConnected: true }));
    expect(logText()).toBe('after restart\n');
    await act(async () => resolveOldSnapshot([{ t: '', m: 'stale output\n' }]));
    expect(logText()).toBe('after restart\n');
  });

  it('orders subscription requests when closed and reopened during a pending subscription', async () => {
    let resolveSubscribe!: (response: { ok: boolean }) => void;
    const subscribe = new Promise<{ ok: boolean }>((resolve) => { resolveSubscribe = resolve; });
    const enabledRequests: boolean[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/raw')) return { ok: true, json: async () => ({ entries: [] }) };
      enabledRequests.push(JSON.parse(String(init?.body)).enabled);
      return enabledRequests.length === 1 ? subscribe : { ok: true };
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    expect(enabledRequests).toEqual([true]);
    await act(async () => resolveSubscribe({ ok: true }));
    expect(enabledRequests).toEqual([true, false, true]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/raw'))).toHaveLength(1);
  });

  it('replaces sampling progress across batches and preserves split CRLF newlines', async () => {
    mockServer(['Ready\n']);
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    for (const m of ['\rSampling 10%', '\r', '\x1b[2KSampling 100%\r', '\nDone\r\n']) {
      await act(async () => emitLogs([{ t: '', m }]));
    }
    expect(logText()).toBe('Ready\nSampling 100%\nDone\n');
  });

  it('bounds both the snapshot and appended live output', async () => {
    mockServer(Array.from({ length: SERVER_LOG_MAX_LINES + 2 }, (_, i) => `line ${i}\n`));
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    expect(logText()?.startsWith('line 2\n')).toBe(true);
    await act(async () => emitLogs([{ t: '', m: 'newest\n' }]));
    expect(logText()?.startsWith('line 3\n')).toBe(true);
    expect(logText()?.endsWith('newest\n')).toBe(true);
    expect(logText()?.split('\n')).toHaveLength(SERVER_LOG_MAX_LINES + 1);
  });

  it('compensates for removed wrapped lines while reading older output', async () => {
    mockServer(Array.from({ length: SERVER_LOG_MAX_LINES }, (_, i) => `line ${i}\n`));
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    const pre = document.body.querySelector<HTMLPreElement>('.server-logs')!;
    Object.defineProperty(pre, 'scrollHeight', { value: 10000 });
    pre.scrollTop = 200;
    await act(async () => pre.dispatchEvent(new Event('scroll', { bubbles: true })));
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = createRange();
      // The first removed line wraps to three rows; the next occupies one.
      range.getBoundingClientRect = () => {
        const lines = range.startContainer.textContent!.slice(0, range.startOffset).split('\n').length - 1;
        return { top: lines ? 60 + (lines - 1) * 20 : 0 } as DOMRect;
      };
      return range;
    });
    await act(async () => {
      emitLogs([{ t: '', m: 'next\n' }]);
      emitLogs([{ t: '', m: 'latest\n' }]);
    });
    expect(pre.scrollTop).toBe(120);
    expect(logText()?.startsWith('line 2\n')).toBe(true);
  });

  it('warns when subscription fails, keeps the snapshot, and recovers on reconnect', async () => {
    let rejectSubscription = true;
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/raw')
      ? { ok: true, json: async () => ({ entries: [{ t: '', m: 'snapshot\n' }] }) }
      : { ok: !rejectSubscription });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    expect(logText()).toBe('snapshot\n');
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain('Live updates unavailable.');
    rejectSubscription = false;
    await act(async () => useConnectionStatusStore.setState({ isConnected: false }));
    await act(async () => useConnectionStatusStore.setState({ isConnected: true }));
    expect(document.body.querySelector('[role="status"]')).toBeNull();
    await act(async () => emitLogs([{ t: '', m: 'live again\n' }]));
    expect(logText()).toBe('snapshot\nlive again\n');
  });

  it('is a fullscreen modal on a phone that Escape closes', async () => {
    mockServer([]);
    const onClose = vi.fn();
    await act(async () => root.render(<ServerLogsWindow onClose={onClose} />));

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.classList.contains('inset-0')).toBe(true);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const useDesktop = () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
  };

  it('floats on desktop without blocking the app, and moves by its header', async () => {
    useDesktop();
    mockServer([]);
    const onClose = vi.fn();
    await act(async () => root.render(<ServerLogsWindow onClose={onClose} />));

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('false');
    expect(dialog?.classList.contains('resize')).toBe(true);
    const startLeft = parseFloat(dialog!.style.left);
    const startTop = parseFloat(dialog!.style.top);

    const header = dialog!.querySelector<HTMLElement>('.cursor-move')!;
    await act(async () => {
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 300 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 340, clientY: 320 }));
      window.dispatchEvent(new PointerEvent('pointerup', {}));
    });
    expect(parseFloat(dialog!.style.left)).toBe(startLeft + 40);
    expect(parseFloat(dialog!.style.top)).toBe(startTop + 20);
    expect(useServerLogsWindowStore.getState().geometry).toMatchObject({
      x: startLeft + 40,
      y: startTop + 20,
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reopens on desktop where and at the size it was left', async () => {
    useDesktop();
    mockServer([]);
    useServerLogsWindowStore.setState({ geometry: { x: 100, y: 50, width: 600, height: 400 } });
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.style.left).toBe('100px');
    expect(dialog.style.top).toBe('50px');
    expect(dialog.style.width).toBe('600px');
    expect(dialog.style.height).toBe('400px');
  });

  it('pulls a remembered position back on screen', async () => {
    useDesktop();
    mockServer([]);
    useServerLogsWindowStore.setState({
      geometry: { x: window.innerWidth + 500, y: window.innerHeight + 500, width: 600, height: 400 },
    });
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(parseFloat(dialog.style.left)).toBe(window.innerWidth - 80);
    expect(parseFloat(dialog.style.top)).toBe(window.innerHeight - 54 - 8);
  });

  it('clamps a saved size before restoring its position on a smaller screen', async () => {
    useDesktop();
    mockServer([]);
    useServerLogsWindowStore.setState({
      geometry: { x: -2100, y: 100, width: 2200, height: 2000 },
    });
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(parseFloat(dialog.style.width)).toBe(window.innerWidth);
    expect(parseFloat(dialog.style.height)).toBe(window.innerHeight);
    expect(parseFloat(dialog.style.left) + parseFloat(dialog.style.width)).toBe(80);
  });

  it('keeps the header reachable when the viewport shrinks while open', async () => {
    useDesktop();
    mockServer([]);
    useServerLogsWindowStore.setState({
      geometry: { x: window.innerWidth - 100, y: window.innerHeight - 100, width: 600, height: 400 },
    });
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    Object.defineProperty(dialog, 'offsetWidth', { value: 600 });
    Object.defineProperty(dialog, 'offsetHeight', { value: 400 });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(500);
    try {
      await act(async () => window.dispatchEvent(new Event('resize')));
      expect(parseFloat(dialog.style.left)).toBe(720);
      expect(parseFloat(dialog.style.top)).toBe(438);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps the header between the fixed app bars when restoring and dragging', async () => {
    useDesktop();
    mockServer([]);
    document.documentElement.style.setProperty('--top-bar-offset', '96px');
    document.documentElement.style.setProperty('--bottom-bar-offset', '80px');
    useServerLogsWindowStore.setState({ geometry: { x: 100, y: 0, width: 600, height: 400 } });
    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    const header = dialog.querySelector<HTMLElement>('.cursor-move')!;
    expect(parseFloat(dialog.style.top)).toBe(104);
    await act(async () => {
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 120 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: window.innerHeight + 100 }));
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
    expect(parseFloat(dialog.style.top)).toBe(window.innerHeight - 80 - 54 - 8);
    document.documentElement.style.setProperty('--bottom-bar-offset', '140px');
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(parseFloat(dialog.style.top)).toBe(window.innerHeight - 140 - 54 - 8);
  });

  it('says so when the logs cannot be loaded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => root.render(<ServerLogsWindow onClose={() => {}} />));

    expect(document.body.querySelector('.server-logs')).toBeNull();
    expect(document.body.textContent).toContain('Could not load the server logs.');
    expect(subscriptionCalls(fetchMock)).toEqual([true, false]);
  });
});
