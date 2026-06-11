import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_LOST_OVERLAY_DELAY_MS,
  ConnectionLostOverlay,
} from '../BackendStatusOverlay';
import { useConnectionStatusStore } from '@/hooks/useConnectionStatus';

function overlayText(): string | null {
  return document.body.textContent;
}

function isOverlayShown(): boolean {
  return Boolean(overlayText()?.includes('Connection Lost'));
}

describe('ConnectionLostOverlay', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    // These cases model losing a connection we'd already established, so the
    // "ever connected" gate is open; the cold-start case sets it false itself.
    useConnectionStatusStore.setState({
      isConnected: false,
      hasEverConnected: true,
      serverRestarting: false,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('stays hidden during the grace window and appears only after a sustained outage', () => {
    act(() => {
      root.render(createElement(ConnectionLostOverlay));
    });

    // Disconnected, but still within the grace window — no overlay yet.
    expect(isOverlayShown()).toBe(false);

    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_OVERLAY_DELAY_MS - 100);
    });
    expect(isOverlayShown()).toBe(false);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(isOverlayShown()).toBe(true);
  });

  it('never shows before the first successful connect, even past the grace window', () => {
    // Cold start: a slow first handshake should read as "still connecting", not
    // "lost contact" with a backend we never reached.
    useConnectionStatusStore.setState({ isConnected: false, hasEverConnected: false });
    act(() => {
      root.render(createElement(ConnectionLostOverlay));
    });

    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_OVERLAY_DELAY_MS + 1000);
    });
    expect(isOverlayShown()).toBe(false);

    // Once we connect and then drop, the overlay behaves normally again.
    act(() => {
      useConnectionStatusStore.getState().setConnected(true);
    });
    act(() => {
      useConnectionStatusStore.getState().setConnected(false);
    });
    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_OVERLAY_DELAY_MS + 100);
    });
    expect(isOverlayShown()).toBe(true);
  });

  it('does not flash for a blip that reconnects before the grace window elapses', () => {
    act(() => {
      root.render(createElement(ConnectionLostOverlay));
    });

    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_OVERLAY_DELAY_MS - 500);
      useConnectionStatusStore.getState().setConnected(true);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(isOverlayShown()).toBe(false);
  });

  it('clears the overlay as soon as the backend reconnects', () => {
    act(() => {
      root.render(createElement(ConnectionLostOverlay));
    });
    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_OVERLAY_DELAY_MS + 100);
    });
    expect(isOverlayShown()).toBe(true);

    act(() => {
      useConnectionStatusStore.getState().setConnected(true);
    });
    expect(isOverlayShown()).toBe(false);
  });

  it('defers to the restart overlay while a deliberate restart is in flight', () => {
    useConnectionStatusStore.setState({ serverRestarting: true });
    act(() => {
      root.render(createElement(ConnectionLostOverlay));
    });
    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_OVERLAY_DELAY_MS + 100);
    });

    expect(isOverlayShown()).toBe(false);
  });
});
