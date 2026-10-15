import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatServerLogEntries,
  SERVER_LOG_MAX_CHARS,
  SERVER_LOG_MAX_LINES,
  setServerLogsSubscription,
  trimServerLogs,
} from '../system';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('server log retention', () => {
  it('keeps the newest complete lines with or without a trailing newline', () => {
    const lines = Array.from({ length: SERVER_LOG_MAX_LINES + 3 }, (_, i) => `line ${i}`);
    for (const ending of ['', '\n']) {
      expect(trimServerLogs(lines.join('\n') + ending)).toBe(lines.slice(3).join('\n') + ending);
    }
    expect(trimServerLogs('\n')).toBe('\n');
    expect(trimServerLogs('\nhello\n')).toBe('\nhello\n');
  });

  it('limits long lines and prefers a complete line at the character boundary', () => {
    expect(trimServerLogs('x'.repeat(SERVER_LOG_MAX_CHARS + 10))).toHaveLength(SERVER_LOG_MAX_CHARS);
    expect(trimServerLogs('x'.repeat(SERVER_LOG_MAX_CHARS) + '\nlast line\n')).toBe('last line\n');
  });

  it('preserves a progress overwrite and split CRLF after trimming', () => {
    const previous = trimServerLogs('old\n'.repeat(SERVER_LOG_MAX_LINES) + 'Sampling 10%\r');
    const progress = trimServerLogs(formatServerLogEntries([{ t: '', m: 'Sampling 100%\r' }], previous));
    const finished = trimServerLogs(formatServerLogEntries([{ t: '', m: '\nDone\n' }], progress));
    expect(finished.endsWith('Sampling 100%\nDone\n')).toBe(true);
    expect(finished).not.toContain('Sampling 10%');
    expect(finished.split('\n').length - 1).toBeLessThanOrEqual(SERVER_LOG_MAX_LINES);
  });
});

describe('server log subscription requests', () => {
  it('aborts a stalled request and continues queued close/reconnect requests in order', async () => {
    vi.useFakeTimers();
    const enabled: boolean[] = [];
    let oldSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      enabled.push(JSON.parse(String(init.body)).enabled);
      if (enabled.length !== 1) return Promise.resolve({ ok: true });
      oldSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        oldSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = setServerLogsSubscription(true).catch((error: Error) => error.name);
    const close = setServerLogsSubscription(false);
    const reconnect = setServerLogsSubscription(true);
    await vi.advanceTimersByTimeAsync(9999);
    expect(enabled).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toBe('AbortError');
    await Promise.all([close, reconnect]);
    expect(oldSignal?.aborted).toBe(true);
    expect(enabled).toEqual([true, false, true]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timeout after an HTTP failure and allows a later request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true }));
    await expect(setServerLogsSubscription(true)).rejects.toThrow('Failed to change');
    await setServerLogsSubscription(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
