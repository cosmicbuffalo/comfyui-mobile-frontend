import { clientId } from './base';

export async function restartServer(): Promise<void> {
  // Abort rather than hang: on a flaky link a lost response would otherwise
  // leave the caller's "restarting" state stuck until a full app reload.
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(`/mobile/api/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Restart request timed out. The server may still restart; wait a moment before retrying.');
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to restart server');
  }
}

export interface SystemDevice {
  name: string;
  type: string;
  index: number;
  vram_total: number;
  vram_free: number;
  torch_vram_total: number;
  torch_vram_free: number;
}

export interface SystemStats {
  system: {
    os: string;
    ram_total: number;
    ram_free: number;
    comfyui_version: string;
    python_version: string;
    pytorch_version: string;
    embedded_python: boolean;
    argv: string[];
  };
  devices: SystemDevice[];
}

export async function fetchSystemStats(): Promise<SystemStats> {
  const response = await fetch(`/system_stats`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch system stats');
  }
  return response.json();
}


export async function fetchCpuPercent(): Promise<number | null> {
  try {
    const response = await fetch(`/mobile/api/cpu-stats`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data.cpu_percent ?? null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export interface ServerLogEntry {
  t: string;
  m: string;
}

// Log entries as plain text with colour codes stripped. The same shape arrives
// from /internal/logs/raw and from the websocket `logs` message.
export function formatServerLogEntries(entries: ServerLogEntry[], previous = ''): string {
  let text = previous;
  const output = entries.map((entry) => entry.m).join('').replace(ANSI_ESCAPE, '');
  for (const part of output.split(/(\r)/)) {
    if (part === '\r') {
      // Defer until the next character: CRLF keeps the line, while a bare CR
      // replaces it. The next character may arrive in another websocket frame.
      if (!text.endsWith('\r')) text += '\r';
    } else if (part) {
      if (text.endsWith('\r')) {
        text = part.startsWith('\n')
          ? text.slice(0, -1)
          : text.slice(0, text.lastIndexOf('\n') + 1);
      }
      text += part;
    }
  }
  return text;
}

// ComfyUI's in-memory console buffer, the same one the desktop frontend's
// terminal panel reads.
export async function fetchServerLogs(): Promise<ServerLogEntry[]> {
  const response = await fetch(`/internal/logs/raw`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch server logs');
  }
  const data = (await response.json()) as { entries: ServerLogEntry[] };
  return data.entries;
}

// useWebSocket re-dispatches each websocket `logs` message under this name,
// with the message data ({ entries }) as the event detail.
export const SERVER_LOGS_EVENT = 'comfy-mobile-server-logs';

// While subscribed, ComfyUI pushes new console output to this client's
// websocket as `logs` messages. The server forgets the subscription when the
// socket drops, so callers subscribe again after a reconnect.
let subscriptionRequest: Promise<void> = Promise.resolve();

export function setServerLogsSubscription(enabled: boolean): Promise<void> {
  // Keep close/reopen and reconnect requests in order, even over a slow link.
  subscriptionRequest = subscriptionRequest.catch(() => {}).then(async () => {
    const response = await fetch(`/internal/logs/subscribe`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, enabled }),
    });
    if (!response.ok) {
      throw new Error('Failed to change the server logs subscription');
    }
  });
  return subscriptionRequest;
}
