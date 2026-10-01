import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetrySetting } from '@/components/AppMenu/TelemetrySetting';

describe('TelemetrySetting', () => {
  let container: HTMLDivElement;
  let root: Root;
  let server: { enabled: boolean; forcedByEnvironment: boolean; adminOnly?: boolean } | null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    server = { enabled: false, forcedByEnvironment: false };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/mobile/api/telemetry') {
        if (!server) return new Response('not found', { status: 404 });
        return Response.json(server);
      }
      if (url === '/mobile/api/preferences' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (server && !server.forcedByEnvironment) server.enabled = body.telemetryEnabled;
        return Response.json({ telemetryEnabled: server?.enabled });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
  };
  const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"]');

  it('starts off, and switching it on saves the server-wide preference', async () => {
    act(() => root.render(<TelemetrySetting />));
    await settle();
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');

    await act(async () => { toggle()?.click(); });
    await settle();

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ telemetryEnabled: true });
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
  });

  it('is locked, and says why, when the environment decides', async () => {
    server = { enabled: true, forcedByEnvironment: true };
    act(() => root.render(<TelemetrySetting />));
    await settle();

    expect(toggle()?.disabled).toBe(true);
    expect(container.textContent).toContain('COMFYUI_MOBILE_TELEMETRY');
    await act(async () => { toggle()?.click(); });
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'POST')).toBe(false);
  });

  it('is locked for a multiuser account that is not an admin', async () => {
    server = { enabled: true, forcedByEnvironment: false, adminOnly: true };
    act(() => root.render(<TelemetrySetting />));
    await settle();

    expect(toggle()?.disabled).toBe(true);
    expect(container.textContent).toContain('Only an admin can change this');
    expect(container.textContent).not.toContain('COMFYUI_MOBILE_TELEMETRY');
    await act(async () => { toggle()?.click(); });
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'POST')).toBe(false);
  });

  it('renders nothing against a node that predates the endpoint', async () => {
    server = null;
    act(() => root.render(<TelemetrySetting />));
    await settle();
    expect(container.innerHTML).toBe('');
  });
});
