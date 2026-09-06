import { create } from 'zustand';

export interface LiveProgressSnapshot {
  promptId: string;
  nodesDone: number;
  nodesTotal: number;
  nodeName: string | null;
  nodeIndex: number | null;
  nodeProgressPercent: number | null;
  overallProgressPercent: number | null;
  finished: boolean;
}

interface LiveProgressState {
  snapshot: LiveProgressSnapshot | null;
  isConnected: boolean;
  hasEverConnected: boolean;
  setConnected: (connected: boolean) => void;
  applyMessage: (message: unknown) => void;
  reset: () => void;
}

const MAXIMUM_WHILE_RUNNING = 0.99;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  const number = finiteNumber(value);
  return number === null ? 0 : Math.max(0, Math.floor(number));
}

/** Per-node value/max, bounded so only an explicit finish can claim 100%. */
export function inFlightNodeFraction(value: unknown, maximum: unknown): number | null {
  const numerator = finiteNumber(value);
  const denominator = finiteNumber(maximum);
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Math.min(MAXIMUM_WHILE_RUNNING, Math.max(0, numerator / denominator));
}

/**
 * Normalize one `/mobile/ws/progress` registry snapshot atomically.
 *
 * `nodesDone` is the backend's finished-or-cached count. The running node's
 * fraction interpolates within the next node only while `node_name` says a
 * node is actually running; between nodes it must be cleared so stale sampler
 * progress cannot pull the overall bar backwards on the next node.
 */
export function parseLiveProgressSnapshot(message: unknown): LiveProgressSnapshot | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const data = message as Record<string, unknown>;
  if (data.type === 'finished') return null;

  const promptId = typeof data.prompt_id === 'string' && data.prompt_id
    ? data.prompt_id
    : null;
  if (!promptId) return null;

  const nodesTotal = nonNegativeInteger(data.nodes_total);
  const nodesDone = nodesTotal > 0
    ? Math.min(nonNegativeInteger(data.nodes_done), nodesTotal)
    : 0;
  const nodeName = typeof data.node_name === 'string' && data.node_name.trim()
    ? data.node_name.trim()
    : null;
  const nodeFraction = nodeName
    ? inFlightNodeFraction(data.value, data.max)
    : null;
  const overallFraction = nodesTotal > 0
    ? Math.min(
        MAXIMUM_WHILE_RUNNING,
        Math.max(0, (nodesDone + (nodeFraction ?? 0)) / nodesTotal),
      )
    : null;

  return {
    promptId,
    nodesDone,
    nodesTotal,
    nodeName,
    nodeIndex: nodeName && nodesTotal > 0
      ? Math.min(nodesDone + 1, nodesTotal)
      : null,
    nodeProgressPercent: nodeFraction === null ? null : Math.round(nodeFraction * 100),
    overallProgressPercent: overallFraction === null
      ? null
      : Math.round(overallFraction * 100),
    finished: false,
  };
}

export const useLiveProgressStore = create<LiveProgressState>((set) => ({
  snapshot: null,
  isConnected: false,
  hasEverConnected: false,
  setConnected: (connected) => set(
    connected
      ? { isConnected: true, hasEverConnected: true }
      : { isConnected: false },
  ),
  applyMessage: (message) => set((state) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return state;
    const record = message as Record<string, unknown>;
    if (record.type === 'finished') {
      const promptId = record.prompt_id;
      if (typeof promptId !== 'string' || state.snapshot?.promptId !== promptId) return state;
      return {
        isConnected: true,
        hasEverConnected: true,
        snapshot: {
          ...state.snapshot,
          nodeName: null,
          nodeIndex: null,
          nodeProgressPercent: null,
          overallProgressPercent: 100,
          finished: true,
        },
      };
    }

    // hello_ack / pong / rate_advice share this socket but are not registry
    // snapshots. In particular, a hello acknowledgement must not erase the
    // initial snapshot the server sends immediately before it.
    if (typeof record.type === 'string' || !('prompt_id' in record)) return state;
    return {
      snapshot: parseLiveProgressSnapshot(record),
      isConnected: true,
      hasEverConnected: true,
    };
  }),
  reset: () => set({
    snapshot: null,
    isConnected: false,
    hasEverConnected: false,
  }),
}));
