import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CivitaiMetadataSetting } from '@/components/AppMenu/CivitaiMetadataSetting';
import { useLoraManagerMetadataStore } from '@/hooks/useLoraManagerMetadata';

describe('CivitaiMetadataSetting', () => {
  let container: HTMLDivElement;
  let root: Root;
  let server: { enabled: boolean; forcedByEnvironment: boolean };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useLoraManagerMetadataStore.setState({ civitaiEnabled: null });
    // On unless the operator has turned it off.
    server = { enabled: true, forcedByEnvironment: false };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/mobile/api/models/civitai') return Response.json(server);
      if (url === '/mobile/api/preferences' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (!server.forcedByEnvironment) server.enabled = body.civitaiMetadataEnabled;
        return Response.json({ civitaiMetadataEnabled: server.enabled });
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

  it('starts on, and switching it off saves the preference and stops lookups', async () => {
    act(() => root.render(<CivitaiMetadataSetting />));
    await settle();
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    expect(useLoraManagerMetadataStore.getState().civitaiEnabled).toBe(true);

    await act(async () => { toggle()?.click(); });
    await settle();

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ civitaiMetadataEnabled: false });
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(useLoraManagerMetadataStore.getState().civitaiEnabled).toBe(false);
  });

  it('is locked, and says why, when the environment decides', async () => {
    server = { enabled: false, forcedByEnvironment: true };
    act(() => root.render(<CivitaiMetadataSetting />));
    await settle();

    expect(toggle()?.disabled).toBe(true);
    expect(container.textContent).toContain('COMFYUI_MOBILE_CIVITAI_METADATA');
  });
});
