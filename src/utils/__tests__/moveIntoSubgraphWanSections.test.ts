import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NodeTypes, Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { expandWorkflowSubgraphs } from '@/utils/expandWorkflowSubgraphs';
import { moveNodesIntoSubgraph } from '@/utils/moveIntoSubgraph';
import { normalizeSubgraphPlaceholders } from '@/utils/normalizeSubgraphPlaceholders';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getSubgraphBoundaryWidgetSlots } from '@/utils/widgetDefinitions';
import { connectionSnapshot, findIntegrityProblems, summarizeProblems } from './helpers/linkIntegrity';

/**
 * Moving nodes into a subgraph, exercised against a captured twelve-section
 * video workflow rather than a hand-built two-node graph.
 *
 * The bug these cover is a slot-index shift. Moving a node that FEEDS the
 * placeholder makes its boundary input redundant, so every slot after it moves
 * down one — and when the parent links and the definition disagree about how
 * far they moved, each link stays structurally valid while naming a different
 * input. Nothing throws, the workflow saves and reloads, and it surfaces only
 * when ComfyUI validates the submitted prompt:
 *
 *     prev_latent, received_type(INT) mismatch input_type(LATENT)
 *     clip_vision_start_image, received_type(FLOAT) mismatch
 *
 * Two things this fixture has to be, or the bug hides:
 *
 * - A WIDE boundary. `2nd_Section` has 18 inputs. A shift is only visible
 *   several slots past the one that went, so a narrow boundary passes.
 * - DIRECT wiring. The nodes reach the placeholder without SetNode/GetNode
 *   relays in between. Through a relay, moving a node only ADDS boundary slots,
 *   which was always the safe path; the drop is what was broken. The same edit
 *   is harmless in a relay-wired copy of this workflow and destructive here.
 *
 * The subject is the SECOND section, not the first: in this capture the first
 * section's prompt encoder has already been moved inside it, so it no longer
 * has one at root to move. The second is the same shape untouched.
 *
 * Assertions name slots, never number them: an index-keyed assertion moves with
 * the damage and passes.
 */

/** The section the first one was already edited into — the shape to match. */
const SECTION_1 = '40d4748d-3539-4009-969f-2dfc1edc5e03';
const SECTION_2 = '640b0060-0f56-4d12-a8b3-34d913c73a37';
/** The 2nd_Section placeholder in the root graph. */
const PLACEHOLDER = 815;
/** The inner sampler whose inputs the reported errors named. */
const SAMPLER_TYPE = 'WanAdvancedI2V';

/** Nodes from the reported flow. The first three feed the placeholder directly. */
const POSITIVE_PROMPT = 1024;
const MATH_EXPRESSION = 1341;
const SEED = 1416;
/** One encoder wired into every section — the case that must not be absorbed. */
const NEGATIVE_PROMPT = 973;
/** Feeds only the math expression, so moving it in adds nothing to the boundary. */
const SECONDS = 1330;

function loadFixture(): Workflow {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/utils/__tests__/fixtures/wan-sections.json'), 'utf-8'),
  ) as Workflow;
}

/** The fixture as the app holds it, i.e. after the load-time normalization. */
function loadNormalized(): Workflow {
  return normalizeSubgraphPlaceholders(loadFixture());
}

function section(workflow: Workflow): WorkflowSubgraphDefinition {
  return workflow.definitions!.subgraphs!.find((sg) => sg.id === SECTION_2)!;
}

function boundaryInputNames(workflow: Workflow): string[] {
  return (section(workflow).inputs ?? []).map((slot) => slot.name ?? '');
}

/**
 * What feeds each of the inner sampler's inputs, named rather than numbered.
 *
 * A boundary-fed input reports the boundary slot's NAME; an input fed by a node
 * that has moved in reports that node's type.
 */
function samplerFeeds(workflow: Workflow): Record<string, string> {
  const definition = section(workflow);
  const sampler = definition.nodes!.find((node) => node.type === SAMPLER_TYPE)!;
  const feeds: Record<string, string> = {};
  sampler.inputs.forEach((slot, index) => {
    const link = definition.links!.find(
      (candidate) => candidate.target_id === sampler.id && candidate.target_slot === index,
    );
    if (!link) return;
    feeds[slot.name] = link.origin_id === -10
      ? `boundary:${definition.inputs?.[link.origin_slot]?.name}`
      : `inner:${definition.nodes!.find((node) => node.id === link.origin_id)?.type}`;
  });
  return feeds;
}

/**
 * The same question asked of the graph that is actually submitted: for the
 * sampler inside THIS section, which node feeds each of its inputs once every
 * subgraph has been flattened away.
 *
 * This is the view ComfyUI validates. It crosses the boundary, so it catches a
 * parent link and an inner link that have each shifted by a different amount —
 * which neither an inner-only nor a parent-only assertion can see. At the time
 * of the report the definition's own wiring was correct and only the parent
 * links overshot, so a check that stayed inside the subgraph saw nothing wrong.
 */
function expandedSamplerFeeds(workflow: Workflow): Record<string, string> {
  const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(workflow);
  const sampler = expanded.nodes.find(
    (node) => node.type === SAMPLER_TYPE && promptKeyMap.get(node.id)?.startsWith(`${PLACEHOLDER}:`),
  );
  expect(sampler, 'the 2nd_Section sampler survives expansion').toBeDefined();

  const feeds: Record<string, string> = {};
  sampler!.inputs.forEach((slot, index) => {
    const link = (expanded.links ?? []).find(
      (candidate) => candidate[3] === sampler!.id && candidate[4] === index,
    );
    if (!link) return;
    const origin = expanded.nodes.find((node) => node.id === link[1]);
    // Named by what the origin IS, never by its id: expansion re-mints ids.
    feeds[slot.name] = `${origin?.title ?? origin?.type}[${link[2]}]`;
  });
  return feeds;
}

/**
 * Root nodes wired directly into the placeholder, by the slot name they feed.
 *
 * Subgraph placeholders are excluded: the section upstream feeds this one, and
 * moving a placeholder into another placeholder is nesting rather than the edit
 * under test — the destination picker refuses it for the same reason.
 */
function placeholderFeeders(workflow: Workflow): Array<{ slotName: string; nodeId: number }> {
  const placeholder = workflow.nodes.find((node) => node.id === PLACEHOLDER)!;
  const definitionIds = new Set((workflow.definitions?.subgraphs ?? []).map((sg) => sg.id));
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  return placeholder.inputs.flatMap((slot) => {
    const link = (workflow.links ?? []).find((candidate) => candidate[0] === slot.link);
    if (!link) return [];
    const source = byId.get(link[1]);
    if (!source || definitionIds.has(source.type)) return [];
    return [{ slotName: slot.name, nodeId: link[1] }];
  });
}

function expectClean(workflow: Workflow, label: string): void {
  const problems = findIntegrityProblems(workflow);
  expect(problems, `${label}\n  ${summarizeProblems(problems)}`).toEqual([]);
  // The editing model can be self-consistent and still expand into a prompt
  // that is not, so the submitted graph is checked on its own terms.
  const expanded = expandWorkflowSubgraphs(workflow).workflow;
  const expandedProblems = findIntegrityProblems(expanded);
  expect(
    expandedProblems,
    `${label} (expanded prompt)\n  ${summarizeProblems(expandedProblems)}`,
  ).toEqual([]);
}

function moveIn(workflow: Workflow, nodeIds: number[]): Workflow {
  const result = moveNodesIntoSubgraph(workflow, null, PLACEHOLDER, nodeIds);
  expect(result, `move ${nodeIds} into the placeholder`).not.toBeNull();
  return normalizeSubgraphPlaceholders(result!.workflow);
}

describe('the captured workflow itself', () => {
  it('starts clean, so a failure below is the move and not the fixture', () => {
    const workflow = loadNormalized();
    expectClean(workflow, 'fixture baseline');
    expect(boundaryInputNames(workflow)).toHaveLength(18);
    expect(section(workflow).nodes!.some((node) => node.type === SAMPLER_TYPE)).toBe(true);
  });

  it('is wired directly, with no relays left to soften the edit', () => {
    // Stated as a test because it is the precondition for everything else: if a
    // future re-capture of this workflow reintroduces SetNode/GetNode relays,
    // these moves stop dropping boundary slots and the suite goes quietly green
    // without covering anything.
    const workflow = loadNormalized();
    const relays = workflow.nodes.filter(
      (node) => node.type === 'SetNode' || node.type === 'GetNode',
    );
    expect(relays, 'the fixture must stay relay-free').toEqual([]);

    const feeders = placeholderFeeders(workflow).map((feeder) => feeder.nodeId);
    for (const [label, nodeId] of [
      ['the positive prompt', POSITIVE_PROMPT],
      ['the math expression', MATH_EXPRESSION],
      ['the seed', SEED],
    ] as const) {
      expect(feeders, `${label} feeds the section directly`).toContain(nodeId);
    }
    expect(feeders, 'the seconds primitive reaches the section only through the math node')
      .not.toContain(SECONDS);
  });
});

describe('moving a node that feeds the placeholder', () => {
  /**
   * Moving a feeder drops its boundary slot and every slot after it shifts down
   * one. The parent links have to shift by exactly that much; they used to be
   * reslotted and then normalized, applying the shift twice, so a link two slots
   * along landed two inputs early. Running it for every feeder is what makes the
   * off-by-N visible — the bug only bites for slots far enough past the one that
   * went, so a single spot check can miss it.
   */
  const feeders = placeholderFeeders(loadNormalized());

  it('covers every feeder the fixture has', () => {
    expect(feeders.length).toBeGreaterThan(10);
  });

  for (const { slotName, nodeId } of feeders) {
    it(`dropping "${slotName}" leaves every other input on its own slot`, () => {
      const before = loadNormalized();
      const feedsBefore = samplerFeeds(before);
      const after = moveIn(before, [nodeId]);

      expectClean(after, `after moving the "${slotName}" feeder in`);

      // Every other slot is still on the boundary. The moved node's own slot is
      // not asserted gone: a node whose own input carries the same name — a lora
      // loader moved in off the "model" slot still needs a "model" of its own —
      // legitimately re-adds one, and the name is then reused rather than freed.
      expect(boundaryInputNames(after)).toEqual(
        expect.arrayContaining(
          boundaryInputNames(before).filter((name) => name !== slotName),
        ),
      );

      // Every sampler input except the one now fed from inside must still be
      // fed by the boundary slot of its own name.
      const feedsAfter = samplerFeeds(after);
      for (const [inputName, source] of Object.entries(feedsBefore)) {
        if (source === `boundary:${slotName}`) {
          expect(feedsAfter[inputName], `${inputName} should now be fed from inside`)
            .not.toBe(source);
          continue;
        }
        expect(feedsAfter[inputName], `${inputName} drifted off its slot`).toBe(source);
      }

      // The property that actually matters: which side of the boundary a node
      // sits on is a presentation choice, so once the subgraphs are flattened
      // the submitted graph must be the one it was before the move.
      expect(expandedSamplerFeeds(after), 'the submitted graph changed')
        .toEqual(expandedSamplerFeeds(before));
    });
  }

  it('drops two slots without shifting the rest twice', () => {
    const before = loadNormalized();
    const after = moveIn(before, [POSITIVE_PROMPT, SEED]);

    expectClean(after, 'after moving the prompt encoder and the seed in');
    expect(boundaryInputNames(after)).not.toContain('positive');
    expect(boundaryInputNames(after)).not.toContain('noise_seed');
    expect(expandedSamplerFeeds(after)).toEqual(expandedSamplerFeeds(before));
  });

  it('keeps the two inputs named in the report on their own feeds', () => {
    // Named individually so a regression report says which input broke. These
    // sit past the "positive" slot that goes away, which is why they were the
    // two that surfaced.
    const before = loadNormalized();
    const feedsBefore = expandedSamplerFeeds(before);
    const feedsAfter = expandedSamplerFeeds(moveIn(before, [POSITIVE_PROMPT]));

    expect(feedsAfter.prev_latent).toBe(feedsBefore.prev_latent);
    expect(feedsAfter.clip_vision_start_image).toBe(feedsBefore.clip_vision_start_image);
    expect(feedsAfter.width).toBe(feedsBefore.width);
    expect(feedsAfter.height).toBe(feedsBefore.height);
  });
});

describe('moving a node that only reaches the placeholder through another', () => {
  it('re-collapses the slot it just added when the source follows it in', () => {
    // The math expression goes in first, so the seconds primitive that feeds it
    // becomes a new boundary input. Moving the primitive in after should remove
    // that input again rather than leave it dangling or renumber its neighbours.
    const before = loadNormalized();
    const withMath = moveIn(before, [MATH_EXPRESSION]);
    const gained = boundaryInputNames(withMath)
      .filter((name) => !boundaryInputNames(before).includes(name));
    expect(gained.length, `math node should bring its own feeds in: ${gained}`).toBeGreaterThan(0);

    const withSeconds = moveIn(withMath, [SECONDS]);
    expectClean(withSeconds, 'after the seconds primitive followed the math node in');
    expect(expandedSamplerFeeds(withSeconds)).toEqual(expandedSamplerFeeds(before));
  });

  it('keeps the frame rate feeding both the section and the moved math node', () => {
    // Frame_Rate drives the section's own frame_rate slot AND the math node's
    // second operand. When the math node moves in, one of those two links has to
    // become a new boundary input while the other stays exactly where it was —
    // the case behind "I had to fix the framerate connection".
    const before = loadNormalized();
    const after = moveIn(before, [MATH_EXPRESSION]);

    expectClean(after, 'after moving the math expression in');
    expect(boundaryInputNames(after), 'the section keeps its own frame rate input')
      .toContain('frame_rate');
    expect(expandedSamplerFeeds(after)).toEqual(expandedSamplerFeeds(before));
  });
});

describe('the reported flow, driven through the store', () => {
  beforeEach(() => {
    // Replace the active tab rather than opening another: the session keeps a
    // small number of tabs, so a suite that loads once per test runs out and a
    // later block is handed a workflow an earlier one left behind.
    useWorkflowStore.getState().loadWorkflow(loadFixture(), 'wan-sections.json', { fresh: true, replaceActive: true });
  });

  const current = (): Workflow => useWorkflowStore.getState().workflow!;

  function keyOf(nodeId: number): string {
    const node = current().nodes.find((candidate) => candidate.id === nodeId);
    if (!node?.itemKey) throw new Error(`node ${nodeId} has no item key`);
    return node.itemKey;
  }

  function innerNode(type: string): WorkflowNode {
    return section(current()).nodes!.find((node) => node.type === type)!;
  }

  it('prompt in, widget promoted, then the seconds and the math expression', () => {
    expectClean(current(), 'as loaded');
    const originalFeeds = expandedSamplerFeeds(current());

    // 1. The prompt encoder goes in. It fed "positive", so that slot goes.
    expect(
      useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER)),
    ).toMatchObject({ removedInputs: 1 });
    expectClean(current(), 'after the prompt encoder moved in');
    expect(boundaryInputNames(current())).not.toContain('positive');
    expect(expandedSamplerFeeds(current())).toEqual(originalFeeds);

    // 2. Its text widget is promoted from inside the subgraph.
    useWorkflowStore.getState().enterSubgraph(PLACEHOLDER);
    const encoder = innerNode('CLIPTextEncode');
    const promptText = (encoder.widgets_values as unknown[])[0];
    expect(
      useWorkflowStore.getState().promoteWidget({
        nodeKey: encoder.itemKey!,
        inputName: 'text',
        inputType: 'STRING',
        value: promptText,
      }),
    ).toBe(true);
    expectClean(current(), 'after promoting the prompt widget');
    expect(boundaryInputNames(current())).toContain('text');
    useWorkflowStore.getState().exitToRoot();

    // 3. The seconds primitive and the math expression follow. The math node
    //    fed a boundary slot too, so this is a second drop on a boundary the
    //    first move already renumbered.
    expect(
      useWorkflowStore.getState().moveItemsIntoSubgraph(
        [keyOf(SECONDS), keyOf(MATH_EXPRESSION)],
        keyOf(PLACEHOLDER),
      ),
    ).toMatchObject({ removedInputs: 1 });
    expectClean(current(), 'after the seconds and math nodes moved in');

    // Nothing the sampler is fed has moved, through any of it.
    expect(expandedSamplerFeeds(current())).toEqual(originalFeeds);

    // The promoted value has to survive a boundary that changed under it, and
    // reach the inner node in the graph that actually gets submitted.
    const expanded = expandWorkflowSubgraphs(current()).workflow;
    const expandedEncoder = expanded.nodes.find(
      (node) => node.type === 'CLIPTextEncode' && node.title === encoder.title,
    );
    expect((expandedEncoder?.widgets_values as unknown[])?.[0]).toBe(promptText);
  });

  it('does not change the graph that gets submitted', () => {
    // The strongest form of the property, over the whole prompt rather than one
    // sampler: moving nodes across a boundary and promoting a widget are both
    // presentation changes, so the flattened graph has to come out the same.
    //
    // Expansion inlines every subgraph into the root graph but leaves the now
    // unused definitions in place, so only the root scope is the submitted one.
    const submitted = (workflow: Workflow): string[] =>
      [...connectionSnapshot(expandWorkflowSubgraphs(workflow).workflow)]
        .filter((key) => key.startsWith('root | '))
        .sort();
    const before = submitted(current());

    useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER));
    useWorkflowStore.getState().enterSubgraph(PLACEHOLDER);
    const encoder = innerNode('CLIPTextEncode');
    useWorkflowStore.getState().promoteWidget({
      nodeKey: encoder.itemKey!,
      inputName: 'text',
      inputType: 'STRING',
      value: (encoder.widgets_values as unknown[])[0],
    });
    useWorkflowStore.getState().exitToRoot();
    useWorkflowStore.getState().moveItemsIntoSubgraph(
      [keyOf(SECONDS), keyOf(MATH_EXPRESSION)],
      keyOf(PLACEHOLDER),
    );

    const after = submitted(current());
    expect(before.filter((key) => !after.includes(key)), 'connections lost').toEqual([]);
    expect(after.filter((key) => !before.includes(key)), 'connections gained').toEqual([]);
  });

  it('survives the reported feeders moving in one at a time', () => {
    // The damage compounded in the report: each move dropped another slot and
    // the shift accumulated until inputs several places away read the wrong feed.
    const originalFeeds = expandedSamplerFeeds(current());
    for (const [label, nodeId] of [
      ['the positive prompt', POSITIVE_PROMPT],
      ['the math expression', MATH_EXPRESSION],
      ['the seed', SEED],
    ] as const) {
      expect(
        useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(nodeId)], keyOf(PLACEHOLDER)),
        `moving ${label} in`,
      ).not.toBeNull();
      expectClean(current(), `after moving ${label} in`);
      expect(expandedSamplerFeeds(current()), `the submitted graph changed after ${label}`)
        .toEqual(originalFeeds);
    }

    for (const gone of ['positive', 'noise_seed']) {
      expect(boundaryInputNames(current()), `${gone} should be gone`).not.toContain(gone);
    }
    for (const kept of ['vae', 'prev_latent', 'clip_vision_start_image', 'frame_rate']) {
      expect(boundaryInputNames(current()), `${kept} should remain`).toContain(kept);
    }
  });

  it('leaves the other sections untouched', () => {
    const before = current();
    useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER));
    const after = current();

    // Each section is its own type here, so an edit to one has no business
    // reaching another — but the boundary rewrite walks every scope, and a
    // remap applied one scope too wide would show up as a changed boundary.
    for (const definition of before.definitions!.subgraphs!) {
      if (definition.id === SECTION_2) continue;
      const now = after.definitions!.subgraphs!.find((sg) => sg.id === definition.id)!;
      expect((now.inputs ?? []).map((slot) => slot.name), `${definition.name} inputs`)
        .toEqual((definition.inputs ?? []).map((slot) => slot.name));
      expect((now.outputs ?? []).map((slot) => slot.name), `${definition.name} outputs`)
        .toEqual((definition.outputs ?? []).map((slot) => slot.name));
      expect(now.links, `${definition.name} links`).toEqual(definition.links);
    }
  });
});

describe('bringing the second section up to the first section\'s setup', () => {
  beforeEach(() => {
    // Replace the active tab rather than opening another: the session keeps a
    // small number of tabs, so a suite that loads once per test runs out and a
    // later block is handed a workflow an earlier one left behind.
    useWorkflowStore.getState().loadWorkflow(loadFixture(), 'wan-sections.json', { fresh: true, replaceActive: true });
  });

  const current = (): Workflow => useWorkflowStore.getState().workflow!;
  const keyOf = (nodeId: number): string =>
    current().nodes.find((n) => n.id === nodeId)!.itemKey!;
  const inner = (type: string): WorkflowNode =>
    section(current()).nodes!.find((node) => node.type === type)!;
  /**
   * The placeholder's promoted widgets, in the order the card draws them.
   *
   * That is the boundary's widget-backed inputs, in boundary order — the legacy
   * `proxyWidgets` list is migrated away at load, so there is only one order
   * left to read.
   */
  const proxyNames = (): string[] =>
    getSubgraphBoundaryWidgetSlots(section(current()))
      .map(({ boundarySlot }) => section(current()).inputs![boundarySlot].name!);
  /** Promoted widget values keyed by the widget they belong to, never by index. */
  const promotedByName = (): Record<string, unknown> => {
    const placeholder = current().nodes.find((n) => n.id === PLACEHOLDER)!;
    const values = (placeholder.widgets_values ?? []) as unknown[];
    return Object.fromEntries(proxyNames().map((name, index) => [name, values[index]]));
  };

  const PROMPT = 'a promoted prompt';
  const SECONDS_VALUE = 3;

  /** The whole edit: encoder in, prompt promoted, seconds and math in, seconds promoted. */
  function bringUpToDate() {
    expect(useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER)))
      .toMatchObject({ removedInputs: 1 });
    useWorkflowStore.getState().enterSubgraph(PLACEHOLDER);
    expect(useWorkflowStore.getState().promoteWidget({
      nodeKey: inner('CLIPTextEncode').itemKey!,
      inputName: 'text', inputType: 'STRING', value: PROMPT,
    }), 'promote the prompt text').toBe(true);
    useWorkflowStore.getState().exitToRoot();

    expect(useWorkflowStore.getState().moveItemsIntoSubgraph(
      [keyOf(SECONDS), keyOf(MATH_EXPRESSION)], keyOf(PLACEHOLDER),
    )).toMatchObject({ removedInputs: 1 });
    useWorkflowStore.getState().enterSubgraph(PLACEHOLDER);
    expect(useWorkflowStore.getState().promoteWidget({
      nodeKey: inner('PrimitiveFloat').itemKey!,
      inputName: 'value', inputType: 'FLOAT', value: SECONDS_VALUE,
    }), 'promote the seconds value').toBe(true);
    useWorkflowStore.getState().exitToRoot();
  }

  it('names its new slots the way the first section names them', () => {
    const firstSection = () =>
      (current().definitions!.subgraphs!.find((sg) => sg.id === SECTION_1)!.inputs ?? [])
        .map((slot) => slot.name);
    const reference = firstSection();
    bringUpToDate();
    expectClean(current(), 'after bringing the section up to date');

    // The encoder's feed and its promoted widget land on the same names the
    // first section already carries, so the two read alike on the card.
    for (const name of ['clip', 'text']) {
      expect(reference, `the first section has "${name}"`).toContain(name);
      expect(boundaryInputNames(current()), `the second section gained "${name}"`).toContain(name);
    }
    // And the slot each moved node made redundant is gone.
    expect(boundaryInputNames(current())).not.toContain('positive');
    expect(boundaryInputNames(current())).not.toContain('a_1');
  });

  it('promotes both widgets and keeps each value on its own name', () => {
    bringUpToDate();
    const promoted = promotedByName();
    expect(proxyNames(), 'both widgets are promoted').toEqual(expect.arrayContaining(['text', 'value']));
    expect(promoted.text).toBe(PROMPT);
    expect(promoted.value).toBe(SECONDS_VALUE);
    // No widget may be listed twice: values are positional, so a duplicate
    // silently shifts every value after it.
    expect(new Set(proxyNames()).size, `duplicated: ${proxyNames()}`).toBe(proxyNames().length);
  });

  it('feeds the moved math expression its own operands', () => {
    bringUpToDate();
    expectClean(current(), 'after the math expression moved in');

    const definition = section(current());
    const math = definition.nodes!.find((n) => n.type === 'MathExpression|pysssss')!;
    expect((math.widgets_values as unknown[])[0], 'the expression itself').toBe('a*b+1\n');

    const operand = (slot: number) =>
      definition.links!.find((l) => l.target_id === math.id && l.target_slot === slot);
    // a comes from the seconds primitive that moved in with it...
    const a = operand(0);
    expect(a, 'operand a is connected').toBeDefined();
    expect(definition.nodes!.find((n) => n.id === a!.origin_id)?.type,
      'a is fed by the seconds primitive now inside').toBe('PrimitiveFloat');
    // ...and b still crosses the boundary from the frame rate outside.
    const b = operand(1);
    expect(b, 'operand b is connected').toBeDefined();
    expect(b!.origin_id, 'b arrives through the boundary').toBe(-10);
    const placeholder = current().nodes.find((n) => n.id === PLACEHOLDER)!;
    const slotName = definition.inputs?.[b!.origin_slot]?.name;
    const parentLink = (current().links ?? []).find(
      (l) => l[3] === PLACEHOLDER && placeholder.inputs[l[4]]?.name === slotName,
    );
    const source = current().nodes.find((n) => n.id === parentLink?.[1]);
    expect(source?.title, 'b is fed by the frame rate').toBe('Frame_Rate');
  });

  it('still submits the same graph after the whole edit', () => {
    const before = expandedSamplerFeeds(current());
    bringUpToDate();
    expect(expandedSamplerFeeds(current()), 'the submitted graph changed').toEqual(before);
    // And the promoted prompt is wired through to the encoder rather than
    // merely stored on the placeholder. The VALUE is only substituted when the
    // prompt is built (that needs node definitions, which a unit test has no
    // business loading), so what is checked here is the plumbing: the boundary
    // slot named "text" feeds the encoder's own text input.
    const definition = section(current());
    const encoder = definition.nodes!.find((n) => n.type === 'CLIPTextEncode')!;
    const textSlot = (definition.inputs ?? []).findIndex((slot) => slot.name === 'text');
    expect(textSlot, 'the boundary carries a "text" slot').toBeGreaterThanOrEqual(0);
    const wired = definition.links!.find(
      (l) => l.origin_id === -10 && l.origin_slot === textSlot && l.target_id === encoder.id,
    );
    expect(wired, 'the promoted text slot feeds the encoder').toBeDefined();
    const targetName = encoder.inputs[wired!.target_slot]?.name;
    expect(targetName, 'it lands on the encoder text input').toBe('text');
  });

  it('keeps every promoted value on its widget when the boundary is reordered', () => {
    bringUpToDate();
    const before = promotedByName();
    const names = boundaryInputNames(current());
    // Put the prompt first and the seconds second, the order they should read in.
    expect(useWorkflowStore.getState().moveBoundarySlot('input', names.indexOf('text'), 0, { subgraphId: SECTION_2 })).toBe(true);
    expect(useWorkflowStore.getState().moveBoundarySlot('input', boundaryInputNames(current()).indexOf('value'), 1, { subgraphId: SECTION_2 })).toBe(true);

    expectClean(current(), 'after reordering the boundary');
    expect(boundaryInputNames(current()).slice(0, 2)).toEqual(['text', 'value']);
    // The point of the reorder test: a slot that moves without its value takes
    // its neighbour's, which is silent when the two are the same type.
    expect(promotedByName().text).toBe(before.text);
    expect(promotedByName().value).toBe(before.value);
  });

  it('orders the placeholder card as prompt, seconds, then the sampler widgets', () => {
    // This used to be impossible. `proxyWidgets` carried a second widget order
    // beside the boundary's, and only its boundary-routed entries were ever
    // permuted — the sampler's own width/height/steps held the leading slots and
    // nothing could move a promoted widget above them. With that list migrated
    // away there is one order, so moving the socket moves the widget.
    bringUpToDate();
    const names = boundaryInputNames(current());
    useWorkflowStore.getState().moveBoundarySlot('input', names.indexOf('text'), 0, { subgraphId: SECTION_2 });
    useWorkflowStore.getState().moveBoundarySlot('input', boundaryInputNames(current()).indexOf('value'), 1, { subgraphId: SECTION_2 });

    expect(proxyNames().slice(0, 2)).toEqual(['text', 'value']);
    expectClean(current(), 'after ordering the card');
    // And the values went with their widgets.
    expect(promotedByName().text).toBe(PROMPT);
    expect(promotedByName().value).toBe(SECONDS_VALUE);
  });
});

/**
 * Node definitions for the nodes the auto-promotion flow reasons about.
 *
 * Deliberately mirrors what the server actually returns for these types,
 * including the fact that neither declares a `default` — that absence is what
 * the promotion rule has to cope with, so a fixture that invented one would
 * test something easier than reality.
 */
const PROMOTION_NODE_TYPES = {
  CLIPTextEncode: {
    input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } },
    output: ['CONDITIONING'],
  },
  PrimitiveFloat: {
    input: { required: { value: ['FLOAT', { min: -1e9, max: 1e9, step: 0.1 }] } },
    output: ['FLOAT'],
  },
  'MathExpression|pysssss': {
    input: {
      required: { expression: ['STRING', { multiline: true }] },
      optional: { a: ['INT,FLOAT,IMAGE,LATENT'], b: ['INT,FLOAT,IMAGE,LATENT'], c: ['INT,FLOAT,IMAGE,LATENT'] },
    },
    output: ['INT', 'FLOAT'],
  },
} as unknown as NodeTypes;

describe('moving nodes in keeps their values reachable', () => {
  beforeEach(() => {
    // Replace the active tab rather than opening another: the session keeps a
    // small number of tabs, so a suite that loads once per test runs out and a
    // later block is handed a workflow an earlier one left behind.
    useWorkflowStore.getState().loadWorkflow(loadFixture(), 'wan-sections.json', { fresh: true, replaceActive: true });
    useWorkflowStore.getState().setNodeTypes(PROMOTION_NODE_TYPES);
  });

  const current = (): Workflow => useWorkflowStore.getState().workflow!;
  const keyOf = (nodeId: number): string =>
    current().nodes.find((n) => n.id === nodeId)!.itemKey!;
  const widgetNames = (): string[] =>
    getSubgraphBoundaryWidgetSlots(section(current()))
      .map(({ boundarySlot }) => section(current()).inputs![boundarySlot].name!);
  const widgetValues = (): Record<string, unknown> => {
    const placeholder = current().nodes.find((n) => n.id === PLACEHOLDER)!;
    const values = (placeholder.widgets_values ?? []) as unknown[];
    return Object.fromEntries(widgetNames().map((name, index) => [name, values[index]]));
  };

  it('promotes a moved prompt so its text is still settable from the card', () => {
    const before = current().nodes.find((n) => n.id === POSITIVE_PROMPT)!;
    const text = (before.widgets_values as unknown[])[0];
    expect(widgetNames(), 'nothing called text to begin with').not.toContain('text');

    useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER));

    expectClean(current(), 'after moving the prompt in');
    expect(widgetNames(), 'the prompt is promoted').toContain('text');
    expect(widgetValues().text, 'and carries the text it had').toBe(text);
  });

  it('promotes the seconds and the expression when those move in', () => {
    const seconds = (current().nodes.find((n) => n.id === SECONDS)!.widgets_values as unknown[])[0];
    const expression = (current().nodes.find((n) => n.id === MATH_EXPRESSION)!.widgets_values as unknown[])[0];

    useWorkflowStore.getState().moveItemsIntoSubgraph(
      [keyOf(SECONDS), keyOf(MATH_EXPRESSION)], keyOf(PLACEHOLDER),
    );

    expectClean(current(), 'after moving the seconds and math nodes in');
    expect(widgetValues().value, 'the seconds value').toBe(seconds);
    expect(widgetValues().expression, 'the math expression').toBe(expression);
  });

  it('keeps every promoted value on its own name across both moves', () => {
    // The whole flow, in the order it happens. Each move changes the boundary
    // under the values the previous one promoted, which is exactly where a
    // positional list hands a widget its neighbour's value.
    const text = (current().nodes.find((n) => n.id === POSITIVE_PROMPT)!.widgets_values as unknown[])[0];
    const seconds = (current().nodes.find((n) => n.id === SECONDS)!.widgets_values as unknown[])[0];
    const originalFeeds = expandedSamplerFeeds(current());

    useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER));
    expect(widgetValues().text).toBe(text);

    useWorkflowStore.getState().moveItemsIntoSubgraph(
      [keyOf(SECONDS), keyOf(MATH_EXPRESSION)], keyOf(PLACEHOLDER),
    );

    expectClean(current(), 'after the whole flow');
    expect(widgetValues().text, 'the prompt survived the second move').toBe(text);
    expect(widgetValues().value, 'the seconds value').toBe(seconds);
    expect(new Set(widgetNames()).size, 'no widget listed twice').toBe(widgetNames().length);
    // And none of it changed what gets submitted.
    expect(expandedSamplerFeeds(current())).toEqual(originalFeeds);
  });

  it('leaves widgets alone when it cannot tell a set value from a default', () => {
    // Without node definitions there is nothing to compare against, so the move
    // behaves exactly as it did before rather than promoting on a guess.
    useWorkflowStore.getState().setNodeTypes(null as unknown as NodeTypes);
    const before = widgetNames();
    useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER));
    expectClean(current(), 'after moving in with no node definitions');
    expect(widgetNames()).toEqual(before.filter((name) => name !== 'positive'));
  });
});

/**
 * The same capture with sections 3–12 repointed onto section 2's definition.
 *
 * The file has eleven identical definitions with one instance each — they were
 * cloned rather than shared — so a shared type has to be made here to exercise
 * what happens when an edit to one instance reaches the other ten. Repointing is
 * all it takes: the definitions are identical, which is the whole problem.
 */
function loadAsSharedType(): Workflow {
  const workflow = loadFixture();
  const defs = workflow.definitions!.subgraphs!;
  const survivor = defs.find((d) => d.name === '2nd_Section')!;
  const retired = new Set(
    defs.filter((d) => /^\d+(st|nd|rd|th)_Section$/.test(d.name ?? '')
      && d.name !== '2nd_Section' && d.name !== '1st_Section').map((d) => d.id),
  );
  let number = 2;
  for (const node of workflow.nodes) {
    if (node.type !== survivor.id && !retired.has(node.type)) continue;
    node.type = survivor.id;
    node.properties = { ...(node.properties ?? {}), mobileInstanceNumber: number };
    number += 1;
  }
  workflow.definitions!.subgraphs = defs.filter((d) => !retired.has(d.id));
  return workflow;
}

describe('editing one instance of a shared type', () => {
  /** Each section's encoder gets its own text, the way a real workflow has. */
  function seeded(): Workflow {
    const workflow = loadAsSharedType();
    for (const node of workflow.nodes) {
      if (node.type === 'CLIPTextEncode' && /\d+(st|nd|rd|th)_CLIP/.test(node.title ?? '')) {
        node.widgets_values = [`prompt for ${node.title}`];
      }
    }
    return workflow;
  }

  const current = (): Workflow => useWorkflowStore.getState().workflow!;
  const keyOf = (nodeId: number): string =>
    current().nodes.find((n) => n.id === nodeId)!.itemKey!;
  const sharedId = (): string =>
    current().definitions!.subgraphs!.find((d) => d.name === '2nd_Section')!.id;
  const sharedDefinition = () =>
    current().definitions!.subgraphs!.find((d) => d.id === sharedId())!;
  const widgetNames = (): string[] =>
    getSubgraphBoundaryWidgetSlots(sharedDefinition())
      .map(({ boundarySlot }) => sharedDefinition().inputs![boundarySlot].name!);
  const textByInstance = (): Record<number, unknown> => {
    const index = widgetNames().indexOf('text');
    return Object.fromEntries(current().nodes
      .filter((n) => n.type === sharedId())
      .map((n) => [
        (n.properties as Record<string, number>).mobileInstanceNumber,
        (n.widgets_values as unknown[])?.[index],
      ]));
  };

  beforeEach(() => {
    useWorkflowStore.getState().loadWorkflow(seeded(), 'shared.json', { fresh: true, replaceActive: true });
    useWorkflowStore.getState().setNodeTypes(PROMOTION_NODE_TYPES);
  });

  it('is a shared type with one definition and many instances', () => {
    expect(current().nodes.filter((n) => n.type === sharedId()).length).toBeGreaterThan(5);
    expectClean(current(), 'the shared-type fixture');
  });

  it('gives every sibling its own prompt when one instance takes the encoder in', () => {
    // The slot the encoder fed belongs to the DEFINITION, so this move retires
    // it for all eleven instances at once. Without carrying each sibling's value
    // inside first, ten sections would silently start rendering the prompt of
    // the one that happened to be edited.
    const expected = Object.fromEntries(current().nodes
      .filter((n) => n.type === sharedId())
      .map((n) => {
        const number = (n.properties as Record<string, number>).mobileInstanceNumber;
        const link = (current().links ?? []).find((l) => l[0] === n.inputs.find((i) => i.name === 'positive')?.link);
        const source = link ? current().nodes.find((x) => x.id === link[1]) : undefined;
        return [number, (source?.widgets_values as unknown[])?.[0]];
      }));

    useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER));

    expectClean(current(), 'after one instance took the encoder in');
    expect(widgetNames(), 'the prompt is promoted for the type').toContain('text');
    for (const [number, text] of Object.entries(expected)) {
      if (text === undefined) continue;
      expect(textByInstance()[Number(number)], `instance ${number} kept its own prompt`).toBe(text);
    }
  });

  it('offers the stranded encoders for removal, and nothing else', () => {
    const result = useWorkflowStore.getState().moveItemsIntoSubgraph(
      [keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER),
    )!;
    // Every sibling's encoder fed only that one slot, so all of them are now
    // feeding nothing and are safe to offer.
    expect(result.harvestedFrom.length).toBeGreaterThan(5);
    for (const id of result.harvestedFrom) {
      expect((current().links ?? []).some((l) => l[1] === id), `#${id} still feeds something`).toBe(false);
    }
  });

  it('removes the offered nodes and leaves the submitted graph alone', () => {
    const before = expandedSamplerFeeds(current());
    const result = useWorkflowStore.getState().moveItemsIntoSubgraph(
      [keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER),
    )!;
    const texts = textByInstance();

    const removed = useWorkflowStore.getState().removeHarvestedNodes(result.harvestedFrom);
    expect(removed, 'every offered node was removed').toBe(result.harvestedFrom.length);
    for (const id of result.harvestedFrom) {
      expect(current().nodes.some((n) => n.id === id), `#${id} is gone`).toBe(false);
    }
    // The values they were carrying are on the placeholders, so nothing about
    // what runs has changed.
    expect(textByInstance()).toEqual(texts);
    expectClean(current(), 'after removing the collapsed nodes');
    expect(expandedSamplerFeeds(current())).toEqual(before);
  });

  it('refuses to remove a node that still feeds something', () => {
    // Defence in depth: the caller is handed safe candidates, but this is the
    // call that actually deletes, so it re-checks rather than trusting the list.
    const stillWired = current().nodes.find(
      (n) => n.type === 'CLIPTextEncode' && (current().links ?? []).some((l) => l[1] === n.id),
    )!;
    expect(useWorkflowStore.getState().removeHarvestedNodes([stillWired.id])).toBe(0);
    expect(current().nodes.some((n) => n.id === stillWired.id)).toBe(true);
  });

  it('wires the boundary inputs the move added on every instance', () => {
    // A moved node's own feeds become NEW boundary inputs, and only the edited
    // instance gets them wired. On a shared type that leaves every sibling with
    // a required input and nothing in it — the encoder's `clip` — which the
    // backend refuses outright. Each sibling is wired from whatever fed the same
    // input on its own counterpart.
    const clipSourceFor = (instanceId: number): number | undefined => {
      const placeholder = current().nodes.find((n) => n.id === instanceId)!;
      const slot = placeholder.inputs.find((i) => i.name === 'positive');
      const link = (current().links ?? []).find((l) => l[0] === slot?.link);
      const encoder = link ? current().nodes.find((n) => n.id === link[1]) : undefined;
      const clipIndex = (encoder?.inputs ?? []).findIndex((i) => i.name === 'clip');
      const clipLink = (current().links ?? []).find(
        (l) => l[3] === encoder?.id && l[4] === clipIndex,
      );
      return clipLink?.[1];
    };
    const instances = current().nodes.filter((n) => n.type === sharedId()).map((n) => n.id);
    const expectedSource = new Map(instances.map((id) => [id, clipSourceFor(id)]));

    useWorkflowStore.getState().moveItemsIntoSubgraph([keyOf(POSITIVE_PROMPT)], keyOf(PLACEHOLDER));

    expectClean(current(), 'after the move added a boundary input');
    const definition = sharedDefinition();
    const clipSlot = (definition.inputs ?? []).findIndex((slot) => slot.name === 'clip');
    expect(clipSlot, 'the move added a clip input').toBeGreaterThanOrEqual(0);

    for (const instanceId of instances) {
      const placeholder = current().nodes.find((n) => n.id === instanceId)!;
      const input = placeholder.inputs.find((i) => i.name === 'clip');
      expect(input?.link, `instance ${instanceId} has clip connected`).not.toBeNull();
      const link = (current().links ?? []).find((l) => l[0] === input?.link);
      expect(link?.[1], `instance ${instanceId} draws clip from its own source`)
        .toBe(expectedSource.get(instanceId));
    }
  });

  it('never offers a node the other instances still share', () => {
    // The negative encoder is ONE node wired into every instance. Moving it in
    // leaves nothing stranded — every instance legitimately shares its value —
    // and deleting it would break the sections that are not of this type.
    const result = useWorkflowStore.getState().moveItemsIntoSubgraph(
      [keyOf(NEGATIVE_PROMPT)], keyOf(PLACEHOLDER),
    )!;
    expect(result.harvestedFrom, 'a shared feed is not an orphan').toEqual([]);
    expectClean(current(), 'after moving the shared negative encoder in');
  });
});
