import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppMenu } from '@/components/AppMenu';
import * as api from '@/api/client';

describe('AppMenu workflow file picker', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps one stable picker mounted while the slide panel closes and reopens', async () => {
    const onClose = vi.fn();

    await act(async () => {
      root.render(<AppMenu open onClose={onClose} />);
    });

    const picker = container.querySelector<HTMLInputElement>('[data-workflow-file-input]');
    expect(picker).not.toBeNull();
    expect(picker?.accept).toContain('.json');

    await act(async () => {
      root.render(<AppMenu open={false} onClose={onClose} />);
    });

    expect(picker?.isConnected).toBe(true);
    expect(container.querySelector('[data-workflow-file-input]')).toBe(picker);

    await act(async () => {
      root.render(<AppMenu open onClose={onClose} />);
    });

    expect(container.querySelector('[data-workflow-file-input]')).toBe(picker);
    expect(document.querySelectorAll('[data-workflow-file-input]')).toHaveLength(1);
  });

  it('pauses statistics requests behind submenus and resumes when the main menu returns', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
    const stats = vi.spyOn(api, 'fetchSystemStats').mockResolvedValue({
      system: { os: 'linux', ram_total: 8e9, ram_free: 4e9, comfyui_version: '0.42.1',
        python_version: '3.13', pytorch_version: '2', embedded_python: false, argv: [] },
      devices: [],
    });
    const cpu = vi.spyOn(api, 'fetchCpuPercent').mockResolvedValue(0);
    const onClose = vi.fn();
    await act(async () => root.render(<AppMenu open onClose={onClose} />));
    expect(stats).toHaveBeenCalledTimes(1);
    expect(cpu).toHaveBeenCalledTimes(1);

    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('My Workflows'));
    expect(button).toBeDefined();
    await act(async () => button!.click());
    stats.mockClear(); cpu.mockClear();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(stats).not.toHaveBeenCalled();
    expect(cpu).not.toHaveBeenCalled();

    await act(async () => root.render(<AppMenu open={false} onClose={onClose} />));
    await act(async () => root.render(<AppMenu open onClose={onClose} />));
    expect(stats).toHaveBeenCalledTimes(1);
    expect(cpu).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(stats).toHaveBeenCalledTimes(2);
    expect(cpu).toHaveBeenCalledTimes(2);
  });
});
