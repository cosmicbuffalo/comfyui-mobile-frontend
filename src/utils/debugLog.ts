// Debug logging utility - writes logs to server via userdata API

import { API_BASE } from '@/api/client';

type LogEntry = {
  timestamp: number;
  message: string;
  data?: unknown;
};

const logs: LogEntry[] = [];
let writeTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingWrites: LogEntry[] = [];

function encodeUserDataPath(path: string): string {
  return encodeURIComponent(path);
}

async function flushLogsToServer() {
  if (pendingWrites.length === 0) return;

  const toWrite = [...pendingWrites];
  pendingWrites = [];

  const logText = toWrite.map(entry => {
    const time = new Date(entry.timestamp).toISOString();
    const dataStr = entry.data !== undefined ? ` | ${JSON.stringify(entry.data)}` : '';
    return `${time} ${entry.message}${dataStr}`;
  }).join('\n') + '\n';

  try {
    // Append to existing log file by reading first, then writing
    let existingContent = '';
    try {
      const readResponse = await fetch(`${API_BASE}/api/userdata/${encodeUserDataPath('mobile-debug.log')}`);
      if (readResponse.ok) {
        existingContent = await readResponse.text();
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    const newContent = existingContent + logText;

    await fetch(`${API_BASE}/api/userdata/${encodeUserDataPath('mobile-debug.log')}?overwrite=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: newContent
    });
  } catch (err) {
    console.error('[debugLog] Failed to write to server:', err);
  }
}

function scheduleFlush() {
  if (writeTimeout) return;
  writeTimeout = setTimeout(() => {
    writeTimeout = null;
    flushLogsToServer();
  }, 500); // Batch writes every 500ms
}

export function debugLog(message: string, data?: unknown) {
  const entry: LogEntry = {
    timestamp: Date.now(),
    message,
    data,
  };
  logs.push(entry);
  pendingWrites.push(entry);

  // Also log to console
  if (data !== undefined) {
    console.log(`[DEBUG] ${message}`, data);
  } else {
    console.log(`[DEBUG] ${message}`);
  }

  // Schedule write to server
  scheduleFlush();
}

// Force flush immediately (call before critical operations)
export async function flushDebugLogs() {
  if (writeTimeout) {
    clearTimeout(writeTimeout);
    writeTimeout = null;
  }
  await flushLogsToServer();
}

// Clear the server log file
export async function clearServerLogs() {
  try {
    await fetch(`${API_BASE}/api/userdata/${encodeUserDataPath('mobile-debug.log')}?overwrite=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: ''
    });
  } catch (err) {
    console.error('[debugLog] Failed to clear server logs:', err);
  }
}
