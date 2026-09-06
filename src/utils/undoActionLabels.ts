import { runUndoTransaction } from '@/utils/undoTransaction';

/**
 * What each undoable store action is called in the Undo/Redo toast.
 *
 * Every action that changes the canonical workflow is named here. The
 * alternative — deriving a name from the diff — can only see what the workflow
 * gained or lost, so a dozen different edits all came back as "Edit workflow"
 * and the toast could not tell the user which one it just took back.
 *
 * Naming them in one table rather than at each definition also makes the set
 * checkable: `undoActionLabels.test.ts` walks the store and fails when an
 * action that writes `workflow` is missing from here, so a new edit action
 * cannot quietly ship with a generic toast.
 *
 * Wrapping is what applies them (see `withUndoActionLabels`): the action runs
 * inside an undo transaction carrying its label, which also collapses an action
 * that commits several `set()` calls into the single undo step it should be.
 * Nested calls (deleteSelectedItems -> deleteNode) keep the outermost label,
 * which is the one the user pressed.
 */
export const UNDO_ACTION_LABELS: Record<string, string> = {
  // Nodes
  addNode: 'Add node',
  addNodeAndConnect: 'Add node',
  deleteNode: 'Delete node',
  duplicateNode: 'Duplicate node',
  updateNodeTitle: 'Rename node',
  updateNodeProperties: 'Edit node settings',
  convertImageOutputNode: 'Convert node',
  toggleBypass: 'Toggle bypass',
  bypassAllInContainer: 'Toggle bypass',
  renameSetGetNode: 'Rename relay',
  collapseSetGetNodes: 'Collapse Set/Get nodes',

  // Widget values
  updateNodeWidget: 'Edit value',
  updateNodeWidgets: 'Edit value',
  updateSubgraphInnerNodeWidget: 'Edit value',
  setPowerPuterOutputs: 'Edit outputs',
  setWidgetLabel: 'Rename widget',
  popWidgetToPrimitive: 'Pop out widget',
  ensureWidgetInputSlot: 'Convert widget to input',

  // Wiring
  connectNodes: 'Connect',
  disconnectInput: 'Disconnect',

  // Clipboard and selection
  pasteClipboard: 'Paste',
  pasteIntoContainer: 'Paste',
  deleteSelectedItems: 'Delete selection',

  // Groups and containers
  addGroupNearNode: 'Create group',
  createGroupFromItems: 'Create group',
  duplicateContainer: 'Duplicate group',
  deleteContainer: 'Delete container',
  updateContainerTitle: 'Rename container',
  updateWorkflowItemColor: 'Change color',

  // Layout
  commitRepositionLayout: 'Reorder nodes',

  // Subgraphs
  createSubgraphFromItems: 'Create subgraph',
  moveItemsIntoSubgraph: 'Move into subgraph',
  removeHarvestedNodes: 'Remove collapsed nodes',
  popNodeOutToRoot: 'Pop node out',
  forkSubgraphType: 'Fork subgraph',
  replaceSubgraphInstance: 'Replace subgraph',
  renameSubgraphType: 'Rename subgraph',
  deleteSubgraphType: 'Delete subgraph',

  // Subgraph boundary
  addBoundaryInput: 'Add subgraph input',
  addBoundaryOutput: 'Add subgraph output',
  connectBoundaryInput: 'Connect subgraph input',
  connectBoundaryOutput: 'Connect subgraph output',
  disconnectBoundaryLink: 'Disconnect subgraph slot',
  moveBoundarySlot: 'Reorder subgraph slot',
  removeBoundarySlot: 'Remove subgraph slot',
  setBoundarySlotLabel: 'Rename subgraph slot',
  promoteWidget: 'Promote widget',
  demoteWidget: 'Demote widget',
  setPromotedWidgetForm: 'Change promoted widget',
  setPromotedWidgetLabel: 'Rename promoted widget',
  setInstanceWidgetLabel: 'Rename promoted widget',
};

/**
 * Labels applied to the store's actions, in place. Anything in the store that
 * is not a named undoable action is passed through untouched.
 */
export function withUndoActionLabels<T extends object>(actions: T): T {
  const labelled = { ...actions } as Record<string, unknown>;
  for (const [name, label] of Object.entries(UNDO_ACTION_LABELS)) {
    const action = labelled[name];
    if (typeof action !== 'function') continue;
    const original = action as (...args: unknown[]) => unknown;
    labelled[name] = (...args: unknown[]) =>
      runUndoTransaction(() => original(...args), label);
  }
  return labelled as T;
}
