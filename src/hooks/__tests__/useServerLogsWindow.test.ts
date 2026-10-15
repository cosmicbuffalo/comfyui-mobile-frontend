import { describe, expect, it } from 'vitest';
import { useServerLogsWindowStore } from '../useServerLogsWindow';

describe('useServerLogsWindowStore', () => {
  it('keeps the window open, and where it was, across a reload', () => {
    useServerLogsWindowStore.getState().setOpen(true);
    useServerLogsWindowStore.getState().setGeometry({ x: 10, y: 20, width: 600, height: 400 });

    expect(JSON.parse(localStorage.getItem('server-logs-window')!).state).toEqual({
      open: true,
      geometry: { x: 10, y: 20, width: 600, height: 400 },
    });
  });
});
