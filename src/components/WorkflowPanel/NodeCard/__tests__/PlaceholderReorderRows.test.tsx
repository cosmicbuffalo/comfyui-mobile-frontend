import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useSeedStore } from '@/hooks/useSeed';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getPlaceholderValueIndexForBoundarySlot } from '@/utils/widgetDefinitions';
import { makeLocationPointer } from '@/utils/mobileLayout';
import type { WorkflowSubgraphDefinition } from '@/api/types';
import { NodeCardParameters } from '../Parameters';

/**
 * Reordering a promoted widget moves the row the user is looking at.
 *
 * The boundary's order and the card's order are not the same list. A promoted
 * seed and its control_after_generate are drawn as ONE specialized seed block
 * rather than two rows, so a card showing three rows can be standing on four
 * boundary slots. Move up computed its neighbour in slot space, which meant a
 * widget below the seed block moved above the control slot — a slot with no row
 * of its own. The row did not appear to move, and the values shuffled under it.
 */
describe('reordering promoted widgets on a placeholder card', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // The real ComboControl asks for a pointer media query; jsdom has none.
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
    useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  // Boundary: 0 seed, 1 control_after_generate, 2 unet_name.
  // Card:     [seed block (0 + 1)], [unet_name (2)].
  const renderCard = async (
    onMoveBoundarySlot: (from: number, to: number) => void,
    slots: { unetSlot: number; seedSlot: number; controlSlot: number } = {
      seedSlot: 0,
      controlSlot: 1,
      unetSlot: 2,
    },
  ) => {
    const node: WorkflowNode = {
      id: 911,
      itemKey: 'node:911',
      type: 'backend-subgraph',
      pos: [0, 0],
      size: [580, 1320],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [],
      properties: {},
      widgets_values: [],
    };
    const workflow: Workflow = {
      last_node_id: node.id,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    useWorkflowStore.setState({ workflow, nodeTypes: {}, scopeStack: [{ type: 'root' }] });

    const values = new Map<number, unknown>([
      [10_000, 123],
      [10_001, 'randomize'],
      [10_002, 'model.safetensors'],
    ]);

    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[
            {
              widgetIndex: 10_001,
              inputIndex: slots.controlSlot,
              name: 'KSampler: control_after_generate',
              type: 'COMBO',
              value: 'randomize',
            },
          ]}
          visibleWidgets={[
            {
              widgetIndex: 10_000,
              inputIndex: slots.seedSlot,
              name: 'KSampler: seed',
              type: 'INT',
              value: 123,
            },
            {
              widgetIndex: 10_002,
              inputIndex: slots.unetSlot,
              name: 'Loader: unet_name',
              type: 'COMBO',
              value: 'model.safetensors',
            },
          ]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 10_000}
          findSeedControlWidgetIndex={() => 10_001}
          isPlaceholder
          onMoveBoundarySlot={onMoveBoundarySlot}
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          resolveWidgetValue={(index) => values.get(index)}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
        />,
      );
    });
  };

  const clickRowAction = async (rowName: string, action: string) => {
    const triggers = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.row-actions-button'),
    );
    const trigger = triggers.find((button) =>
      (button.getAttribute('aria-label') ?? '').includes(rowName),
    );
    expect(trigger, `no row menu for ${rowName}`).toBeTruthy();
    await act(async () => trigger!.click());
    const entry = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.row-actions-menu button'),
    ).find((button) => button.textContent?.trim() === action);
    expect(entry, `no "${action}" in the menu for ${rowName}`).toBeTruthy();
    await act(async () => entry!.click());
  };

  it('moves a widget above the whole seed block, not into the middle of it', async () => {
    const onMoveBoundarySlot = vi.fn();
    await renderCard(onMoveBoundarySlot);
    await clickRowAction('unet_name', 'Move up');

    // Slot 0 puts it above the seed block. Slot 1 would land it between the
    // seed and the control it steps — one visual row, split in two.
    expect(onMoveBoundarySlot).toHaveBeenCalledWith(2, 0);
  });

  it('moves a widget below the whole seed block, not into the middle of it', async () => {
    const onMoveBoundarySlot = vi.fn();
    await renderCard(onMoveBoundarySlot, { unetSlot: 0, seedSlot: 1, controlSlot: 2 });
    await clickRowAction('unet_name', 'Move down');

    // Slot 2 is the block's last slot: removing slot 0 shifts the pair down to
    // 0 and 1, so inserting at 2 lands after both. Slot 1 would split them.
    expect(onMoveBoundarySlot).toHaveBeenCalledWith(0, 2);
  });

  it('offers no move above the first row', async () => {
    const onMoveBoundarySlot = vi.fn();
    await renderCard(onMoveBoundarySlot, { unetSlot: 0, seedSlot: 1, controlSlot: 2 });
    const triggers = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.row-actions-button'),
    );
    const trigger = triggers.find((button) =>
      (button.getAttribute('aria-label') ?? '').includes('unet_name'),
    );
    await act(async () => trigger!.click());
    const labels = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.row-actions-menu button'),
    ).map((button) => button.textContent?.trim());
    expect(labels).not.toContain('Move up');
    expect(labels).toContain('Move down');
  });

  /**
   * The whole path, end to end: the card decides which slots to ask for, the
   * real store action carries it out, and the values are read back the way the
   * card reads them.
   *
   * Both halves of this shipped broken tonight and each hid the other. The card
   * stepped in slot space and moved a widget INTO the seed pair; the store then
   * moved the instance's values twice. A test of either half alone passes while
   * a user watches a widget go blank.
   */
  const SG = 'sg-card';
  const VALUES: Record<string, string> = {
    seed: 'the-seed',
    control_after_generate: 'the-control',
    unet_name: 'the-model',
    cfg: 'the-cfg',
  };
  const BOUNDARY = ['seed', 'control_after_generate', 'unet_name', 'cfg'] as const;

  const shownBySlotName = () => {
    const workflow = useWorkflowStore.getState().workflow!;
    const definition = workflow.definitions!.subgraphs![0];
    const placeholder = workflow.nodes.find((candidate) => candidate.id === 911)!;
    const values = (placeholder.widgets_values ?? []) as unknown[];
    const shown: Record<string, unknown> = {};
    (definition.inputs ?? []).forEach((slot, index) => {
      const valueIndex = getPlaceholderValueIndexForBoundarySlot(placeholder, definition, index);
      if (slot.name) shown[slot.name] = valueIndex == null ? undefined : values[valueIndex];
    });
    return shown;
  };

  const renderAgainstRealStore = async () => {
    const definition = {
      id: SG,
      name: 'Sub',
      outputs: [],
      groups: [],
      inputs: BOUNDARY.map((name, index) => ({
        id: `i${index}`,
        name,
        type: 'STRING',
        linkIds: [300 + index],
      })),
      nodes: BOUNDARY.map((name, index) => ({
        id: 20 + index,
        itemKey: makeLocationPointer({ type: 'node', nodeId: 20 + index, subgraphId: SG }),
        type: 'Sampler',
        pos: [0, 0],
        size: [10, 10],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [{ name, type: 'STRING', link: 300 + index, widget: { name } }],
        outputs: [],
        properties: {},
        widgets_values: [],
      })),
      links: BOUNDARY.map((_, index) => ({
        id: 300 + index,
        origin_id: -10,
        origin_slot: index,
        target_id: 20 + index,
        target_slot: 0,
        type: 'STRING',
      })),
    } as unknown as WorkflowSubgraphDefinition;

    const node: WorkflowNode = {
      id: 911,
      itemKey: makeLocationPointer({ type: 'node', nodeId: 911, subgraphId: null }),
      type: SG,
      pos: [0, 0],
      size: [580, 1320],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [],
      properties: {},
      widgets_values: BOUNDARY.map((name) => VALUES[name]),
    } as unknown as WorkflowNode;

    useWorkflowStore.setState({
      workflow: {
        last_node_id: 911,
        last_link_id: 400,
        nodes: [node],
        links: [],
        groups: [],
        config: {},
        version: 1,
        definitions: { subgraphs: [definition] },
      } as Workflow,
      nodeTypes: null,
      scopeStack: [{ type: 'root' }],
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });

    const descriptor = (name: string, inputIndex: number, widgetIndex: number) => ({
      widgetIndex,
      inputIndex,
      name,
      type: 'STRING',
      value: VALUES[name],
    });

    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[descriptor('control_after_generate', 1, 10_001)]}
          visibleWidgets={[
            descriptor('seed', 0, 10_000),
            descriptor('unet_name', 2, 10_002),
            descriptor('cfg', 3, 10_003),
          ]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 10_000}
          findSeedControlWidgetIndex={() => 10_001}
          isPlaceholder
          // Wired exactly as NodeCard.tsx wires it: the card sits in the
          // parent scope, so the edit names the subgraph it is editing.
          onMoveBoundarySlot={(from, to) =>
            useWorkflowStore
              .getState()
              .moveBoundarySlot('input', from, to, { subgraphId: SG })
          }
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          // The specialized seed block only draws when it can resolve the seed
          // and its control; without this the card shows four separate rows and
          // the pair this test is about does not exist.
          resolveWidgetValue={(index) =>
            ({ 10_000: 12345, 10_001: 'randomize' } as Record<number, unknown>)[index]
          }
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
        />,
      );
    });
  };

  const everyValueIntact = () => ({
    seed: 'the-seed',
    control_after_generate: 'the-control',
    unet_name: 'the-model',
    cfg: 'the-cfg',
  });

  it('moves the model above the seed block with every value intact', async () => {
    await renderAgainstRealStore();
    await clickRowAction('unet_name', 'Move up');

    const names = (useWorkflowStore.getState().workflow!.definitions!.subgraphs![0].inputs ?? [])
      .map((slot) => slot.name);
    expect(names).toEqual(['unet_name', 'seed', 'control_after_generate', 'cfg']);
    // The seed and its control stay adjacent, and nothing is showing a
    // neighbour's value — the blank-widget symptom is a value short here.
    expect(shownBySlotName()).toEqual(everyValueIntact());
  });

  it('moves the model below the seed block with every value intact', async () => {
    await renderAgainstRealStore();
    await clickRowAction('cfg', 'Move up');

    expect(shownBySlotName()).toEqual(everyValueIntact());
  });

  /**
   * The reported case, from a real workflow: an Output Video placeholder whose
   * boundary reads interpolation_factor, filename_prefix, interpolation_seed.
   *
   * The seed block used to be drawn above every other row whatever slot it held,
   * while Move up / Move down stepped through boundary order — two different
   * lists. The first row on screen reported itself as already at the top, the
   * last one still offered a move down, and no boundary order could put anything
   * above the seed, because the seed was not in that order at all.
   */
  describe('a seed promoted into a later boundary slot', () => {
    const renderOutputVideoCard = async (
      onMoveBoundarySlot: (from: number, to: number) => void,
      slots = { factorSlot: 1, prefixSlot: 2, seedSlot: 3 },
    ) => {
      const node: WorkflowNode = {
        id: 1774,
        itemKey: 'node:1774',
        type: 'video-subgraph',
        pos: [0, 0],
        size: [420, 400],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [],
        properties: {},
        widgets_values: [],
      };
      const workflow: Workflow = {
        last_node_id: node.id,
        last_link_id: 0,
        nodes: [node],
        links: [],
        groups: [],
        config: {},
        version: 1,
      };
      useWorkflowStore.setState({ workflow, nodeTypes: {}, scopeStack: [{ type: 'root' }] });

      const values = new Map<number, unknown>([
        [20_000, 4],
        [20_001, 'Wan/12_part'],
        [20_002, 2795446733],
      ]);

      await act(async () => {
        root.render(
          <NodeCardParameters
            node={node}
            isBypassed={false}
            isKSampler={false}
            workflowExists
            nodeTypesExists
            visibleInputWidgets={[]}
            visibleWidgets={[
              {
                widgetIndex: 20_000,
                inputIndex: slots.factorSlot,
                name: 'interpolation_factor',
                type: 'INT',
                value: 4,
              },
              {
                widgetIndex: 20_001,
                inputIndex: slots.prefixSlot,
                name: 'filename_prefix',
                type: 'STRING',
                value: 'Wan/12_part',
              },
              {
                widgetIndex: 20_002,
                inputIndex: slots.seedSlot,
                name: 'interpolation_seed',
                type: 'INT',
                value: 2795446733,
              },
            ]}
            errorInputNames={new Set()}
            onUpdateNodeWidget={vi.fn()}
            onUpdateNodeWidgets={vi.fn()}
            getWidgetIndexForInput={() => null}
            findSeedWidgetIndex={() => 20_002}
            findSeedControlWidgetIndex={() => null}
            isPlaceholder
            onMoveBoundarySlot={onMoveBoundarySlot}
            setSeedMode={vi.fn()}
            isWidgetPinned={() => false}
            toggleWidgetPin={vi.fn()}
            resolveWidgetValue={(index) => values.get(index)}
            showFastGroupConfig={false}
            setShowFastGroupConfig={vi.fn()}
          />,
        );
      });
    };

    const rowOrder = (): string[] =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button.row-actions-button'))
        .map((button) => button.getAttribute('aria-label') ?? '');

    const menuLabelsFor = async (rowName: string): Promise<(string | undefined)[]> => {
      const trigger = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button.row-actions-button'),
      ).find((button) => (button.getAttribute('aria-label') ?? '').includes(rowName));
      expect(trigger, `no row menu for ${rowName}`).toBeTruthy();
      await act(async () => trigger!.click());
      return Array.from(
        document.querySelectorAll<HTMLButtonElement>('.row-actions-menu button'),
      ).map((button) => button.textContent?.trim());
    };

    it('draws the seed in its own boundary position, not above everything', async () => {
      await renderOutputVideoCard(vi.fn());
      const order = rowOrder();
      const factor = order.findIndex((label) => label.includes('interpolation_factor'));
      const prefix = order.findIndex((label) => label.includes('filename_prefix'));
      const seed = order.findIndex((label) => label.includes('interpolation_seed'));
      expect(factor, 'interpolation_factor is drawn').toBeGreaterThanOrEqual(0);
      expect(prefix).toBeGreaterThanOrEqual(0);
      expect(seed).toBeGreaterThanOrEqual(0);
      // Boundary order is 1, 2, 3 — so is the card.
      expect(factor).toBeLessThan(prefix);
      expect(prefix).toBeLessThan(seed);
    });

    it('offers no move up on the row that really is first', async () => {
      await renderOutputVideoCard(vi.fn());
      const labels = await menuLabelsFor('interpolation_factor');
      expect(labels).not.toContain('Move up');
      expect(labels).toContain('Move down');
    });

    it('offers no move down on the row that really is last', async () => {
      await renderOutputVideoCard(vi.fn());
      // The seed sits at the end of the boundary, so it ends the card too.
      const labels = await menuLabelsFor('interpolation_seed');
      expect(labels).not.toContain('Move down');
      expect(labels).toContain('Move up');
    });

    it('moves a row past the seed rather than stopping short of it', async () => {
      const onMoveBoundarySlot = vi.fn();
      await renderOutputVideoCard(onMoveBoundarySlot);
      await clickRowAction('filename_prefix', 'Move down');
      // Slot 3 is the seed's: the row lands after it.
      expect(onMoveBoundarySlot).toHaveBeenCalledWith(2, 3);
    });

    it('offers a move up above the seed once a row is below it', async () => {
      const onMoveBoundarySlot = vi.fn();
      await renderOutputVideoCard(onMoveBoundarySlot, {
        seedSlot: 1,
        factorSlot: 2,
        prefixSlot: 3,
      });
      await clickRowAction('interpolation_factor', 'Move up');
      expect(onMoveBoundarySlot).toHaveBeenCalledWith(2, 1);
    });
  });

});