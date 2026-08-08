// Undo-transaction flag shared between the workflow store's composite actions
// and the undo capture subscription (kept out of both modules to avoid an
// import cycle). A composite action that commits several set() calls wraps
// them in runUndoTransaction so the whole burst records as ONE undo step:
// the capture subscription pushes a snapshot for the first meaningful change
// (bracketing the pre-transaction state) and only extends it for the rest.

let depth = 0;
let recorded = false;

export function inUndoTransaction(): boolean {
  return depth > 0;
}

/** Whether the open transaction already pushed its bracketing snapshot. */
export function isUndoTransactionRecorded(): boolean {
  return recorded;
}

export function markUndoTransactionRecorded(): void {
  recorded = true;
}

export function runUndoTransaction<T>(fn: () => T): T {
  depth++;
  if (depth === 1) recorded = false;
  try {
    return fn();
  } finally {
    depth--;
    if (depth === 0) recorded = false;
  }
}
