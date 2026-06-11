import { create } from 'zustand';

interface ConnectionStatusState {
  // Mirrors the live websocket connection so any component can gate on it
  // without threading the useWebSocket return value through the tree.
  isConnected: boolean;
  // True once we've successfully connected at least once this session. The
  // connection-lost overlay gates on this so a slow first handshake reads as
  // "still connecting", not "lost contact" with a backend we never reached.
  hasEverConnected: boolean;
  // True while a deliberate server restart is in flight. The restart flow has
  // its own dedicated overlay, so the generic connection-lost overlay defers to
  // it instead of stacking a second, conflicting message.
  serverRestarting: boolean;
  setConnected: (connected: boolean) => void;
  setServerRestarting: (restarting: boolean) => void;
}

export const useConnectionStatusStore = create<ConnectionStatusState>((set) => ({
  isConnected: false,
  hasEverConnected: false,
  serverRestarting: false,
  setConnected: (connected) =>
    set(connected ? { isConnected: true, hasEverConnected: true } : { isConnected: false }),
  setServerRestarting: (restarting) => set({ serverRestarting: restarting }),
}));
