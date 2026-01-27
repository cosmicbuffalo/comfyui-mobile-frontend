import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { NodeTypes, Workflow } from '@/api/types';
import type { SeedMode } from '@/hooks/useWorkflow';
import {
  findSeedWidgetIndex,
  getSpecialSeedValueForMode,
  isSpecialSeedValue,
  generateSeedFromNode,
} from '@/utils/seedUtils';

export type SeedLastValues = Record<number, number | null>;

interface SeedModeContext {
  workflow: Workflow | null;
  nodeTypes: NodeTypes | null;
  updateNodeWidgets: (nodeId: number, updates: Record<number, unknown>) => void;
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
          const node = workflow.nodes.find((n) => n.id === nodeId);
          if (node) {
            const seedWidgetIndex = findSeedWidgetIndex(workflow, nodeTypes, node);
            if (seedWidgetIndex !== null && Array.isArray(node.widgets_values)) {
              const controlWidgetIndex = seedWidgetIndex + 1;
              const hasControlWidget = typeof node.widgets_values[controlWidgetIndex] === 'string';
              const updates: Record<number, unknown> = {};

              if (hasControlWidget) {
                updates[controlWidgetIndex] = mode;
              } else {
                const specialValue = getSpecialSeedValueForMode(mode);
                if (specialValue !== null && mode !== 'fixed') {
                  updates[seedWidgetIndex] = specialValue;
                } else if (mode === 'fixed') {
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
