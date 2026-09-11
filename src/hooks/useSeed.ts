import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { NodeTypes, Workflow } from '@/api/types';
import type { SeedMode } from '@/hooks/useWorkflow';
import { isSubgraphPlaceholder } from '@/utils/canonicalWorkflowOps';
import {
  findSeedWidgetIndex,
  getSpecialSeedValueForMode,
  hasSeedControlWidget,
  isSpecialSeedValue,
  generateSeedFromNode,
  nodeTypeStripsSeedControl,
} from '@/utils/seedUtils';

export type SeedLastValues = Record<number, number | null>;

interface SeedModeContext {
  workflow: Workflow | null;
  nodeTypes: NodeTypes | null;
  updateNodeWidgets: (nodeId: number, updates: Record<number, unknown>) => void;
  /** Explicit target for a promoted seed whose owning placeholder is nested. */
  node?: Workflow['nodes'][number];
  seedWidgetIndex?: number | null;
  /** Null explicitly means this seed has no persisted companion control. */
  controlWidgetIndex?: number | null;
}

interface SeedState {
  seedModes: Record<number, SeedMode>;
  seedLastValues: SeedLastValues;
  setSeedMode: (nodeId: number, mode: SeedMode, context?: SeedModeContext) => void;
  setSeedModes: (modes: Record<number, SeedMode>) => void;
  setSeedLastValues: (values: SeedLastValues) => void;
  clearSeedState: () => void;
}

export const useSeedStore = create<SeedState>()(
  persist(
    (set, get) => ({
      seedModes: {},
      seedLastValues: {},

      setSeedMode: (nodeId, mode, context) => {
        const { seedModes, seedLastValues } = get();
        if (context?.workflow && context.nodeTypes) {
          const { workflow, nodeTypes, updateNodeWidgets } = context;
          const node = context.node ?? workflow.nodes.find((n) => n.id === nodeId);
          if (node) {
            const seedWidgetIndex =
              typeof context.seedWidgetIndex === 'number'
                ? context.seedWidgetIndex
                : findSeedWidgetIndex(workflow, nodeTypes, node);
            if (seedWidgetIndex !== null && Array.isArray(node.widgets_values)) {
              // The slot after a seed is its control_after_generate only on a
              // real ComfyUI node, which adds that pairing implicitly. A
              // subgraph never promotes it that way — only an explicit
              // proxyWidgets entry can surface one, and the caller passes its
              // index when it does. Guessing here writes the mode string over
              // whatever the next promoted widget happens to be (a model combo
              // reads as a control widget, since any non-empty string does).
              const guessedControlIndex = isSubgraphPlaceholder(node, workflow)
                ? null
                : seedWidgetIndex + 1;
              const controlWidgetIndex = context.controlWidgetIndex === undefined
                ? guessedControlIndex
                : context.controlWidgetIndex;
              const hasControlWidget = controlWidgetIndex !== null && hasSeedControlWidget(
                node,
                node.widgets_values[controlWidgetIndex],
              );
              const updates: Record<number, unknown> = {};

              if (hasControlWidget) {
                updates[controlWidgetIndex!] = mode;
              } else {
                const specialValue = getSpecialSeedValueForMode(mode);
                // Only a node that encodes its mode in the seed value itself
                // (rgthree's Seed strips the control widget) gets the -1/-2/-3
                // sentinel written into widgets_values -- for it, the value IS
                // the mode. Everywhere else -- a promoted placeholder seed, or
                // any seed without a companion control -- the mode lives in the
                // seedModes store and queue time generates from it. Persisting
                // the sentinel there would save a seed stock rejects (min 0)
                // into the workflow file.
                const writesSentinel =
                  specialValue !== null &&
                  mode !== 'fixed' &&
                  nodeTypeStripsSeedControl(node.type);
                if (writesSentinel) {
                  updates[seedWidgetIndex] = specialValue;
                } else {
                  // Keep the slot concrete: on plain mode changes this restores
                  // a stock-valid seed over any sentinel left behind, which
                  // also stops a stale sentinel from overriding the store's
                  // mode at queue time (sentinels win there).
                  const currentSeed = Number(node.widgets_values[seedWidgetIndex]);
                  if (isSpecialSeedValue(currentSeed)) {
                    const lastSeed = seedLastValues[nodeId];
                    const fallbackSeed = typeof lastSeed === 'number'
                      ? lastSeed
                      : generateSeedFromNode(nodeTypes, node);
                    updates[seedWidgetIndex] = fallbackSeed;
                  }
                }
              }

              if (Object.keys(updates).length > 0) {
                updateNodeWidgets(nodeId, updates);
              }
            }
          }
        }

        set({ seedModes: { ...seedModes, [nodeId]: mode } });
      },

      setSeedModes: (modes) => {
        set({ seedModes: modes });
      },

      setSeedLastValues: (values) => {
        set({ seedLastValues: values });
      },

      clearSeedState: () => {
        set({ seedModes: {}, seedLastValues: {} });
      }
    }),
    {
      name: 'seed-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        seedModes: state.seedModes,
        seedLastValues: state.seedLastValues
      })
    }
  )
);
