/**
 * Does a workflow we edited still load in the stock ComfyUI frontend?
 *
 * Everything here is checked against ComfyUI's own workflow-template corpus
 * rather than hand-built fixtures. A fixture only proves the case someone
 * thought of; the corpus is a few hundred real workflows, and it was the corpus
 * that caught the bug this file exists for — a subgraph created on mobile threw
 * "Cannot read properties of undefined (reading 'bounding')" out of stock's
 * `loadSubgraphs`, in every one of 521 workflows, after the canvas had already
 * been cleared.
 *
 * The rules encoded below are read out of stock's own source, recovered from
 * the shipped sourcemaps (see the `comfyui_frontend_package` wheel). They are
 * not guesses about what a workflow "should" look like:
 *
 *   Subgraph._configureSubgraph   this.inputNode.configure(data.inputNode)
 *   SubgraphIONodeBase.configure  this._boundingRect.set(data.bounding)
 *   LGraphNode.connect            graph.state.lastLinkId + 1
 *
 * If the corpus is not installed the suite skips rather than fails: it is a
 * property of the dev machine, not of this repo.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/api/types';
import { createSubgraphFromSelection } from '@/utils/createSubgraphFromSelection';
import { dissolveSubgraph } from '@/utils/dissolveSubgraph';
import { moveNodesIntoSubgraph } from '@/utils/moveIntoSubgraph';
import { popNodeOutOfSubgraph } from '@/utils/popNodeOutOfSubgraph';
import { getWorkflowForPersistence } from '@/utils/workflowPersistence';
import { reconcileInstanceWidgetValues } from '@/utils/instanceWidgetValues';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { applyClipboardPaste, buildNodeClipboardPayload } from '@/utils/workflowClipboard';

type Json = Record<string, unknown>;

const CORPUS = resolveCorpus();

/**
 * Where a python install might keep its site-packages. Deliberately derived
 * rather than listed: the venv this repo's ComfyUI runs in is one machine's
 * detail, and a path with somebody's home directory in it only works for them.
 * `COMFYUI_TEMPLATES_DIR` short-circuits all of this and is what CI sets.
 */
function pythonLibDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.VIRTUAL_ENV) dirs.push(path.join(process.env.VIRTUAL_ENV, 'lib'));
  // A virtualenv beside the user's home, whatever they named it.
  try {
    const home = os.homedir();
    for (const entry of fs.readdirSync(home)) {
      if (!/env/i.test(entry)) continue;
      const lib = path.join(home, entry, 'lib');
      if (fs.existsSync(lib)) dirs.push(lib);
    }
  } catch {
    // No home directory worth reading; the system paths below still apply.
  }
  dirs.push('/usr/lib', '/usr/local/lib');
  return dirs;
}

/**
 * ComfyUI ships its templates as a separate wheel, installed next to the
 * frontend package. Located by walking up from the site-packages copy of the
 * templates rather than hard-coding one machine's python version.
 */
function resolveCorpus(): string | null {
  const roots = [
    process.env.COMFYUI_TEMPLATES_DIR,
    ...pythonLibDirs().flatMap((base) => {
      try {
        return fs
          .readdirSync(base)
          .filter((entry) => entry.startsWith('python'))
          .map((entry) =>
            path.join(base, entry, 'site-packages', 'comfyui_workflow_templates_json', 'templates'),
          );
      } catch {
        return [];
      }
    }),
  ];
  for (const root of roots) {
    if (root && fs.existsSync(root)) return root;
  }
  return null;
}

interface Template {
  file: string;
  workflow: Json;
}

function templates(): Template[] {
  if (!CORPUS) return [];
  return fs
    .readdirSync(CORPUS)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      try {
        const workflow = JSON.parse(fs.readFileSync(path.join(CORPUS, file), 'utf8')) as Json;
        return workflow && typeof workflow === 'object' && Array.isArray(workflow.nodes)
          ? [{ file, workflow }]
          : [];
      } catch {
        return [];
      }
    });
}

const definitionsOf = (graph: Json): Json[] =>
  (((graph.definitions as Json)?.subgraphs ?? []) as Json[]) ?? [];
const withSubgraphs = (list: Template[]) => list.filter((t) => definitionsOf(t.workflow).length > 0);
const save = (workflow: Workflow): Json => getWorkflowForPersistence(workflow) as unknown as Json;
const load = (template: Template): Workflow => structuredClone(template.workflow) as unknown as Workflow;

// ---------------------------------------------------------------------------
// Stock's rules
// ---------------------------------------------------------------------------

/**
 * Replays the one step of stock's load that is fatal rather than merely noisy.
 * Transcribed from the shipped bundle:
 *   configure(e){this._boundingRect.set(e.bounding),this.pinned=e.pinned??!1}
 */
function stockLoadSubgraphs(graph: Json): string | null {
  const visit = (defs: Json[]): void => {
    for (const def of defs) {
      const cloned = structuredClone(def);
      for (const side of ['inputNode', 'outputNode'] as const) {
        // Stock reads `.bounding` off whatever is there, including undefined.
        const io = cloned[side] as { bounding: number[] } | undefined;
        void (io as { bounding: number[] }).bounding;
      }
      visit(definitionsOf(cloned));
    }
  };
  try {
    visit(definitionsOf(graph));
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every way a definition can breach stock's schema, as a list of complaints. */
function schemaComplaints(graph: Json): string[] {
  const complaints: string[] = [];
  const visit = (defs: Json[], where: string): void => {
    for (const def of defs) {
      const at = `${where}[${String(def.name ?? def.id).slice(0, 24)}]`;
      if (def.version !== 1) complaints.push(`${at}.version is ${JSON.stringify(def.version)}, not 1`);
      if (typeof def.revision !== 'number') complaints.push(`${at}.revision is missing`);
      if (typeof def.name !== 'string') complaints.push(`${at}.name is missing`);
      const state = def.state as Json | undefined;
      for (const counter of ['lastGroupId', 'lastNodeId', 'lastLinkId', 'lastRerouteId']) {
        if (typeof state?.[counter] !== 'number') complaints.push(`${at}.state.${counter} is missing`);
      }
      for (const side of ['inputs', 'outputs'] as const) {
        const seen = new Set<string>();
        for (const [index, slot] of ((def[side] ?? []) as Json[]).entries()) {
          const id = String(slot.id ?? '');
          if (!UUID.test(id)) complaints.push(`${at}.${side}[${index}].id ${JSON.stringify(id)} is not a uuid`);
          if (seen.has(id)) complaints.push(`${at}.${side}[${index}].id ${JSON.stringify(id)} is a duplicate`);
          seen.add(id);
        }
      }
      visit(definitionsOf(def), `${at}.`);
    }
  };
  visit(definitionsOf(graph), 'definitions.subgraphs');
  return complaints;
}

/**
 * Stock allocates the next link id as `state.lastLinkId + 1`, and a subgraph
 * has no counter of its own — `Subgraph.state` returns the root graph's. So an
 * interior link numbered past the root counter means the next connection drawn
 * inside that subgraph reuses a live id.
 */
function allocatorComplaints(graph: Json): string[] {
  let maxLink = 0;
  for (const link of ((graph.links ?? []) as unknown[])) {
    const id = Array.isArray(link) ? (link[0] as number) : ((link as Json)?.id as number);
    if (typeof id === 'number') maxLink = Math.max(maxLink, id);
  }
  const visit = (defs: Json[]): void => {
    for (const def of defs) {
      for (const link of ((def.links ?? []) as Json[])) {
        if (typeof link.id === 'number') maxLink = Math.max(maxLink, link.id);
      }
      visit(definitionsOf(def));
    }
  };
  visit(definitionsOf(graph));

  const declared = Math.max(
    Number(graph.last_link_id ?? 0),
    Number((graph.state as Json | undefined)?.lastLinkId ?? 0),
  );
  return maxLink > declared
    ? [`lastLinkId is ${declared} but link ${maxLink} is already in use`]
    : [];
}

/** Every complaint stock could raise about a workflow, in one list. */
function stockComplaints(graph: Json): string[] {
  const fatal = stockLoadSubgraphs(graph);
  return [
    ...(fatal ? [`loadSubgraphs throws: ${fatal}`] : []),
    ...schemaComplaints(graph),
    ...allocatorComplaints(graph),
  ];
}

/**
 * Run one edit over every template it applies to, and report the workflows it
 * left in a state stock would object to. Templates stock itself already ships
 * in that state are excluded, so a failure is always ours.
 */
function auditEdit(edit: (template: Template) => Workflow | null): string[] {
  const failures: string[] = [];
  for (const template of templates()) {
    if (stockComplaints(template.workflow).length > 0) continue;
    let saved: Json;
    try {
      const edited = edit(template);
      if (!edited) continue;
      saved = save(edited);
    } catch (error) {
      failures.push(`${template.file}: the edit itself threw — ${(error as Error).message}`);
      continue;
    }
    for (const complaint of stockComplaints(saved)) failures.push(`${template.file}: ${complaint}`);
  }
  return failures;
}

/** Keep the failure readable when a change breaks hundreds of templates at once. */
function summarize(failures: string[]): string {
  if (failures.length === 0) return '';
  const shown = failures.slice(0, 8).join('\n  ');
  const rest = failures.length > 8 ? `\n  …and ${failures.length - 8} more` : '';
  return `${failures.length} problem(s):\n  ${shown}${rest}`;
}

const plainNodeIds = (template: Template, count: number): number[] => {
  const defIds = new Set(definitionsOf(template.workflow).map((def) => def.id));
  return ((template.workflow.nodes ?? []) as Json[])
    .filter((node) => !defIds.has(node.type))
    .slice(0, count)
    .map((node) => node.id as number);
};

const firstPlaceholder = (template: Template): Json | undefined => {
  const defIds = new Set(definitionsOf(template.workflow).map((def) => def.id));
  return ((template.workflow.nodes ?? []) as Json[]).find((node) => defIds.has(node.type));
};

// ---------------------------------------------------------------------------
// Noticing when the corpus itself changes
// ---------------------------------------------------------------------------

/**
 * ComfyUI adds and rewrites official templates on its own schedule, and the
 * cases below audit whatever is installed — so a new template is checked the
 * moment it appears, but silently. Silent is the problem: a template added
 * upstream is exactly when we most want a person to look, and "all green"
 * reads identically whether it audited 537 workflows or 4.
 *
 * So the corpus is pinned to a blessed manifest. When upstream changes, this
 * fails and names what moved; the audits in the same run say whether the new
 * workflows are compatible. If they are, re-bless and commit:
 *
 *   UPDATE_TEMPLATE_MANIFEST=1 npx vitest run src/utils/__tests__/stockFrontendCompatibility.test.ts
 *
 * `stockRejects` is recorded too, because the audits skip templates stock
 * itself already objects to. A template moving INTO that list is how a
 * compatibility regression could hide behind a passing suite.
 */
// Relative to the repo root: vitest runs from there, and import.meta.url is
// not a file URL under its transform.
const MANIFEST_PATH = path.join(
  process.cwd(),
  'src/utils/__tests__/templateCorpus.manifest.json',
);

interface CorpusManifest {
  templateCount: number;
  withSubgraphs: number;
  stockRejects: string[];
  templates: Record<string, string>;
}

function buildManifest(list: Template[]): CorpusManifest {
  const templates: Record<string, string> = {};
  for (const template of list) {
    templates[template.file] = crypto
      .createHash('sha256')
      .update(JSON.stringify(template.workflow))
      .digest('hex')
      .slice(0, 12);
  }
  return {
    templateCount: list.length,
    withSubgraphs: withSubgraphs(list).length,
    stockRejects: list
      .filter((template) => stockComplaints(template.workflow).length > 0)
      .map((template) => template.file)
      .sort(),
    templates: Object.fromEntries(Object.entries(templates).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** What changed between the blessed corpus and the installed one, in words. */
function describeCorpusDrift(blessed: CorpusManifest, found: CorpusManifest): string {
  const lines: string[] = [];
  const list = (what: string, files: string[]) => {
    if (files.length === 0) return;
    const shown = files.slice(0, 10).join(', ');
    const rest = files.length > 10 ? `, …and ${files.length - 10} more` : '';
    lines.push(`${what} (${files.length}): ${shown}${rest}`);
  };

  const blessedFiles = Object.keys(blessed.templates);
  const foundFiles = Object.keys(found.templates);
  list('added upstream', foundFiles.filter((file) => !(file in blessed.templates)));
  list('removed upstream', blessedFiles.filter((file) => !(file in found.templates)));
  list(
    'rewritten upstream',
    foundFiles.filter(
      (file) => file in blessed.templates && blessed.templates[file] !== found.templates[file],
    ),
  );
  list(
    'newly rejected by stock itself',
    found.stockRejects.filter((file) => !blessed.stockRejects.includes(file)),
  );
  list(
    'no longer rejected by stock',
    blessed.stockRejects.filter((file) => !found.stockRejects.includes(file)),
  );
  return lines.join('\n  ');
}

describe('the stock-frontend template corpus', () => {
  // The suite below skips when the corpus is not installed, which is right on
  // a dev machine and wrong in CI: a silent skip there would report "all
  // green" while checking nothing at all. CI sets this to demand it.
  it('is installed when the environment requires it', () => {
    if (!process.env.REQUIRE_TEMPLATE_CORPUS) return;
    expect(
      CORPUS,
      'REQUIRE_TEMPLATE_CORPUS is set but no ComfyUI template corpus was found. '
        + 'Install comfyui-workflow-templates and/or set COMFYUI_TEMPLATES_DIR.',
    ).not.toBeNull();
  });
});

describe.skipIf(!CORPUS)('workflows we edit still load in the stock frontend', () => {
  it('is the corpus this repo was last audited against', () => {
    const found = buildManifest(templates());

    if (process.env.UPDATE_TEMPLATE_MANIFEST) {
      fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(found, null, 2)}\n`);
      return;
    }

    expect(
      fs.existsSync(MANIFEST_PATH),
      `No blessed corpus manifest at ${MANIFEST_PATH}. Create one with UPDATE_TEMPLATE_MANIFEST=1.`,
    ).toBe(true);

    const blessed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as CorpusManifest;
    const drift = describeCorpusDrift(blessed, found);
    expect(
      drift,
      [
        "ComfyUI's official templates have changed since this corpus was blessed.",
        '',
        `  ${drift}`,
        '',
        'The other cases in this file audited the new set. If they passed, the',
        'change is compatible — re-bless it and commit the manifest:',
        '',
        '  UPDATE_TEMPLATE_MANIFEST=1 npx vitest run src/utils/__tests__/stockFrontendCompatibility.test.ts',
      ].join('\n'),
    ).toBe('');
  });

  it('has a corpus with subgraphs to check against', () => {
    expect(withSubgraphs(templates()).length).toBeGreaterThan(50);
  });

  it('leaves a workflow it only opened and saved exactly as loadable', () => {
    expect(summarize(auditEdit((template) => load(template)))).toBe('');
  });

  it('creates subgraphs the stock frontend can load', () => {
    expect(
      summarize(
        auditEdit((template) => {
          const selection = plainNodeIds(template, 3);
          if (selection.length < 2) return null;
          return (
            createSubgraphFromSelection(load(template), null, { nodeIds: selection, groupIds: [] }, 'Mobile Subgraph')
              ?.workflow ?? null
          );
        }),
      ),
    ).toBe('');
  });

  it('moves nodes into a subgraph without breaking it', () => {
    expect(
      summarize(
        auditEdit((template) => {
          const placeholder = firstPlaceholder(template);
          const [victim] = plainNodeIds(template, 1);
          if (!placeholder || victim === undefined) return null;
          return (
            moveNodesIntoSubgraph(load(template), null, placeholder.id as number, [victim], [])?.workflow ?? null
          );
        }),
      ),
    ).toBe('');
  });

  it('survives repeated moves into the same subgraph', () => {
    expect(
      summarize(
        auditEdit((template) => {
          const placeholder = firstPlaceholder(template);
          const victims = plainNodeIds(template, 4);
          if (!placeholder || victims.length < 2) return null;
          let current = load(template);
          for (const victim of victims) {
            const result = moveNodesIntoSubgraph(current, null, placeholder.id as number, [victim], []);
            if (!result) break;
            current = result.workflow;
          }
          return current;
        }),
      ),
    ).toBe('');
  });

  it('pops a node out of a subgraph without breaking it', () => {
    expect(
      summarize(
        auditEdit((template) => {
          for (const def of definitionsOf(template.workflow)) {
            for (const inner of ((def.nodes ?? []) as Json[])) {
              const result = popNodeOutOfSubgraph(load(template), def.id as string, inner.id as number);
              if (result) return result.workflow;
            }
          }
          return null;
        }),
      ),
    ).toBe('');
  });

  it('dissolves a subgraph without breaking the rest', () => {
    expect(
      summarize(
        auditEdit((template) => {
          const placeholder = firstPlaceholder(template);
          if (!placeholder) return null;
          return dissolveSubgraph(load(template), placeholder.type as string, null, null)?.workflow ?? null;
        }),
      ),
    ).toBe('');
  });

  // -------------------------------------------------------------------------
  // Store-driven edits
  //
  // The cases above call the pure helpers directly. These drive the store
  // actions the UI actually calls, because that is where the scope stack, the
  // instance bookkeeping and the reconcile all come together — and it was
  // exactly that combination, not the helpers, that produced the value bugs
  // this branch fixed.
  // -------------------------------------------------------------------------

  /**
   * auditEdit reports only failures, so an edit that applies to NO template
   * passes silently. These cases count what they actually edited and assert it,
   * because "the corpus is happy" and "the corpus was never touched" look
   * identical otherwise. The thresholds sit a little under what the shipped
   * template corpus actually reaches today, so ordinary corpus churn does not
   * fail them but an edit that quietly stops applying does.
   */
  const auditCovered = (edit: (template: Template) => Workflow | null) => {
    let applied = 0;
    const failures = auditEdit((template) => {
      const result = edit(template);
      if (result) applied += 1;
      return result;
    });
    return { problems: summarize(failures), applied };
  };

  /**
   * Put the store inside a subgraph of this template, through one of its
   * instances. Tries every definition rather than only the first: which
   * definition happens to be listed first is an accident of the file, and
   * picking it alone left most templates untested.
   */
  const enterSubgraph = (
    template: Template,
    wanted?: (workflow: Json, definition: Json) => boolean,
  ): { workflow: Workflow; definition: Json } | null => {
    const workflow = load(template);
    for (const definition of definitionsOf(workflow as unknown as Json)) {
      if (wanted && !wanted(workflow as unknown as Json, definition)) continue;
      const placeholder = ((workflow.nodes ?? []) as unknown as Json[]).find(
        (node) => node.type === definition.id,
      );
      if (!placeholder) continue;
      useWorkflowStore.setState({
        workflow,
        scopeStack: [
          { type: 'root' },
          {
            type: 'subgraph',
            id: definition.id as string,
            placeholderNodeId: placeholder.id as number,
          },
        ],
        nodeTypes: null,
        itemKeyByPointer: {},
        pointerByHierarchicalKey: {},
      });
      return { workflow, definition };
    }
    return null;
  };

  const innerKeyFor = (definitionId: string, nodeId: number) =>
    makeLocationPointer({ type: 'node', nodeId, subgraphId: definitionId });

  /**
   * An inner widget this definition could promote.
   *
   * Two sources, because one alone barely covers the corpus. A serialized input
   * slot carrying `widget` is the obvious case, but inner nodes mostly do NOT
   * serialize one until something promotes them — only five templates qualify
   * that way. The placeholders themselves name inner widgets in their
   * `proxyWidgets` entries (`[innerNodeId, widgetName]`), which is a real
   * widget name without needing node definitions the harness has no access to.
   */
  const firstPromotableWidget = (workflow: Json, definition: Json) => {
    for (const inner of ((definition.nodes ?? []) as Json[])) {
      for (const input of ((inner.inputs ?? []) as Json[])) {
        const widget = input.widget as { name?: string } | undefined;
        if (widget?.name && input.link == null) {
          return {
            nodeId: inner.id as number,
            inputName: widget.name,
            type: String(input.type ?? '*'),
          };
        }
      }
    }

    const innerById = new Map(
      ((definition.nodes ?? []) as Json[]).map((node) => [node.id, node]),
    );
    for (const node of ((workflow.nodes ?? []) as Json[])) {
      if (node.type !== definition.id) continue;
      const proxies = ((node.properties as Json | undefined)?.proxyWidgets ?? []) as unknown[];
      for (const entry of proxies) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const nodeId = Number(entry[0]);
        const inner = innerById.get(nodeId);
        if (!Number.isFinite(nodeId) || !inner) continue;
        const inputName = String(entry[1]);
        // A widget whose slot already carries a link is driven by something
        // else and is genuinely not promotable — the store refuses it, and
        // most direct proxy entries in the corpus are exactly that. Keep
        // looking rather than stopping at the first name.
        const slot = ((inner.inputs ?? []) as Json[]).find(
          (input) =>
            input.name === inputName
            || (input.widget as { name?: string } | undefined)?.name === inputName,
        );
        if (slot?.link != null) continue;
        return { nodeId, inputName, type: String(slot?.type ?? '*') };
      }
    }
    return null;
  };

  const firstPromotableWidgetExists = (workflow: Json, definition: Json) =>
    firstPromotableWidget(workflow, definition) !== null;

  it('promotes a widget without breaking the workflow', () => {
    const { problems, applied } = auditCovered((template) => {
        const entered = enterSubgraph(template, firstPromotableWidgetExists);
        if (!entered) return null;
        const target = firstPromotableWidget(
          entered.workflow as unknown as Json,
          entered.definition,
        );
        if (!target) return null;
        const ok = useWorkflowStore.getState().promoteWidget({
          nodeKey: innerKeyFor(entered.definition.id as string, target.nodeId),
          inputName: target.inputName,
          inputType: target.type,
          value: null,
        });
        return ok ? useWorkflowStore.getState().workflow : null;
      });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(50);
  });

  it('promotes, switches form, and unpromotes back without breaking it', () => {
    const { problems, applied } = auditCovered((template) => {
        const entered = enterSubgraph(template, firstPromotableWidgetExists);
        if (!entered) return null;
        const target = firstPromotableWidget(
          entered.workflow as unknown as Json,
          entered.definition,
        );
        if (!target) return null;
        const nodeKey = innerKeyFor(entered.definition.id as string, target.nodeId);
        const store = () => useWorkflowStore.getState();
        if (!store().promoteWidget({
          nodeKey,
          inputName: target.inputName,
          inputType: target.type,
          value: null,
        })) return null;
        store().setPromotedWidgetForm({ nodeKey, inputName: target.inputName }, 'input');
        store().setPromotedWidgetForm({ nodeKey, inputName: target.inputName }, 'widget');
        store().demoteWidget({ nodeKey, inputName: target.inputName });
        return store().workflow;
      });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(50);
  });

  it('reorders every boundary slot in turn without breaking the workflow', () => {
    const { problems, applied } = auditCovered((template) => {
        const entered = enterSubgraph(template);
        if (!entered) return null;
        const slots = ((entered.definition.inputs ?? []) as Json[]).length;
        if (slots < 2) return null;
        // Walk the whole list forward, so every slot is both moved and
        // moved past — a reorder is a delete and a re-insert in one step.
        for (let index = slots - 1; index > 0; index -= 1) {
          useWorkflowStore.getState().moveBoundarySlot('input', index, index - 1);
        }
        return useWorkflowStore.getState().workflow;
      });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(150);
  });

  it('removes a boundary slot without breaking the workflow', () => {
    const { problems, applied } = auditCovered((template) => {
        const entered = enterSubgraph(template);
        if (!entered) return null;
        if (((entered.definition.inputs ?? []) as Json[]).length === 0) return null;
        useWorkflowStore.getState().removeBoundarySlot('input', 0);
        return useWorkflowStore.getState().workflow;
      });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(150);
  });

  it('forks a shared type into one of its own without breaking either', () => {
    const { problems, applied } = auditCovered((template) => {
        const workflow = load(template);
        const definition = definitionsOf(workflow as unknown as Json)[0];
        if (!definition) return null;
        const placeholder = ((workflow.nodes ?? []) as unknown as Json[]).find(
          (node) => node.type === definition.id,
        );
        if (!placeholder) return null;
        useWorkflowStore.setState({
          workflow,
          scopeStack: [{ type: 'root' }],
          nodeTypes: null,
          itemKeyByPointer: {},
          pointerByHierarchicalKey: {},
        });
        useWorkflowStore.getState().forkSubgraphType(
          definition.id as string,
          [placeholder.id as number],
          '',
        );
        return useWorkflowStore.getState().workflow;
      });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(150);
  });

  it('renames a type without breaking the workflow', () => {
    const { problems, applied } = auditCovered((template) => {
        const workflow = load(template);
        const definition = definitionsOf(workflow as unknown as Json)[0];
        if (!definition) return null;
        useWorkflowStore.setState({
          workflow,
          scopeStack: [{ type: 'root' }],
          nodeTypes: null,
          itemKeyByPointer: {},
          pointerByHierarchicalKey: {},
        });
        useWorkflowStore.getState().renameSubgraphType(definition.id as string, 'Renamed');
        return useWorkflowStore.getState().workflow;
      });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(150);
  });

  /**
   * Deleting a type rewrites or removes definitions that placeholders point at,
   * and has to find its instances wherever they are — a shared type can be
   * instantiated inside another subgraph, not just at root. Both modes are
   * exercised: 'dissolve' unpacks each instance into the graph holding it,
   * 'delete' takes the instances with it.
   */
  const deleteTypeCase = (mode: 'dissolve' | 'delete') =>
    auditCovered((template) => {
      const workflow = load(template);
      const definition = definitionsOf(workflow as unknown as Json)[0];
      if (!definition) return null;
      useWorkflowStore.setState({
        workflow,
        scopeStack: [{ type: 'root' }],
        nodeTypes: null,
        itemKeyByPointer: {},
        pointerByHierarchicalKey: {},
      });
      useWorkflowStore.getState().deleteSubgraphType(definition.id as string, mode);
      const next = useWorkflowStore.getState().workflow;
      // Count it only if the type really went, so the coverage floor below
      // means "179 types were actually deleted" rather than "the action was
      // called 179 times and may have returned early every time".
      const gone = !definitionsOf(next as unknown as Json).some(
        (candidate) => candidate.id === definition.id,
      );
      return gone ? next : null;
    });

  it('dissolves a whole type back into the graphs holding it', () => {
    const { problems, applied } = deleteTypeCase('dissolve');
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(150);
  });

  it('deletes a whole type along with its instances', () => {
    const { problems, applied } = deleteTypeCase('delete');
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(150);
  });

  it('swaps an instance onto another type without breaking the graph', () => {
    const { problems, applied } = auditCovered((template) => {
      const workflow = load(template);
      const definitions = definitionsOf(workflow as unknown as Json);
      if (definitions.length < 2) return null;
      const placeholder = ((workflow.nodes ?? []) as unknown as Json[]).find(
        (node) => node.type === definitions[0].id,
      );
      if (!placeholder) return null;
      // Addressed by hierarchical key, which load() does not annotate.
      const withKeys = {
        ...workflow,
        nodes: (workflow.nodes ?? []).map((node) => ({
          ...node,
          itemKey: makeLocationPointer({ type: 'node', nodeId: node.id, subgraphId: null }),
        })),
      } as Workflow;
      useWorkflowStore.setState({
        workflow: withKeys,
        scopeStack: [{ type: 'root' }],
        nodeTypes: null,
        itemKeyByPointer: {},
        pointerByHierarchicalKey: {},
      });
      const dropped = useWorkflowStore.getState().replaceSubgraphInstance(
        makeLocationPointer({
          type: 'node',
          nodeId: placeholder.id as number,
          subgraphId: null,
        }),
        definitions[1].id as string,
      );
      if (!dropped) return null;
      const next = useWorkflowStore.getState().workflow;
      if (!next) return null;
      // Same idea: the placeholder must actually be an instance of the other
      // type now, or this template did not exercise anything.
      const swapped = ((next.nodes ?? []) as unknown as Json[]).some(
        (node) => node.id === placeholder.id && node.type === definitions[1].id,
      );
      return swapped ? next : null;
    });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(25);
  });

  it('copies and pastes a subgraph placeholder, definition and all', () => {
    const { problems, applied } = auditCovered((template) => {
        const workflow = load(template);
        const definition = definitionsOf(workflow as unknown as Json)[0];
        if (!definition) return null;
        const placeholder = ((workflow.nodes ?? []) as unknown as Json[]).find(
          (node) => node.type === definition.id,
        );
        if (!placeholder) return null;
        // The clipboard addresses nodes by hierarchical key, which load()
        // does not annotate, so key the placeholder the way the app does.
        const withKeys = {
          ...workflow,
          nodes: (workflow.nodes ?? []).map((node) => ({
            ...node,
            itemKey: makeLocationPointer({ type: 'node', nodeId: node.id, subgraphId: null }),
          })),
        } as Workflow;
        const payload = buildNodeClipboardPayload(
          withKeys,
          makeLocationPointer({ type: 'node', nodeId: placeholder.id as number, subgraphId: null }),
        );
        if (!payload) return null;
        return applyClipboardPaste(withKeys, payload, null)?.workflow ?? null;
      });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(150);
  });

  it('nests one subgraph inside another and still loads', () => {
    const { problems, applied } = auditCovered((template) => {
        // Needs two definitions with an instance each: move one placeholder
        // into the other, which is the only way to make a nested definition
        // from the UI, and the shape least covered elsewhere.
        const workflow = load(template);
        const definitions = definitionsOf(workflow as unknown as Json);
        if (definitions.length < 2) return null;
        const rootNodes = (workflow.nodes ?? []) as unknown as Json[];
        const moving = rootNodes.find((node) => node.type === definitions[0].id);
        const destination = rootNodes.find((node) => node.type === definitions[1].id);
        if (!moving || !destination) return null;
        return moveNodesIntoSubgraph(
          workflow,
          null,
          destination.id as number,
          [moving.id as number],
        )?.workflow ?? null;
      });
    expect(problems).toBe('');
    expect(applied).toBeGreaterThanOrEqual(25);
  });

  it('reconciles instance values without disturbing what stock reads', () => {
    // Every boundary edit now ends in reconcileInstanceWidgetValues, so it is
    // the one place that can silently rewrite a placeholder's widgets_values.
    // Running it over the corpus is the cheapest way to find out whether it
    // moves a value that stock would then read under a different name.
    const readByName = (graph: Json): Map<string, string> => {
      const values = new Map<string, string>();
      const defs = new Map(definitionsOf(graph).map((def) => [def.id as string, def]));
      for (const node of ((graph.nodes ?? []) as Json[])) {
        const def = defs.get(node.type as string);
        if (!def) continue;
        const inner = new Map(((def.nodes ?? []) as Json[]).map((n) => [n.id as number, n]));
        const widgetNames: string[] = [];
        for (const [index, slot] of ((def.inputs ?? []) as Json[]).entries()) {
          const feedsWidget = ((def.links ?? []) as Json[]).some((link) => {
            if (link.origin_id !== -10 || link.origin_slot !== index) return false;
            const target = inner.get(link.target_id as number);
            return Boolean(((target?.inputs ?? []) as Json[])[link.target_slot as number]?.widget);
          });
          if (feedsWidget) widgetNames.push(String(slot.name ?? index));
        }
        const proxy = ((node.properties as Json | undefined)?.proxyWidgets ?? null) as
          | unknown[]
          | null;
        const stored = (node.widgets_values ?? []) as unknown[];
        if (Array.isArray(proxy)) {
          // With a list present, stock consumes values in ITS order.
          proxy.forEach((entry, i) => {
            if (!Array.isArray(entry) || String(entry[0]) !== '-1') return;
            values.set(`${node.id}:${String(entry[1])}`, JSON.stringify(stored[i]));
          });
          return values;
        }
        widgetNames.forEach((name, i) => values.set(`${node.id}:${name}`, JSON.stringify(stored[i])));
      }
      return values;
    };

    const drifted: string[] = [];
    let checked = 0;
    for (const template of withSubgraphs(templates())) {
      // Templates stock already objects to are excluded, the way auditEdit does
      // it, so a failure here is always ours.
      if (stockComplaints(template.workflow).length > 0) continue;
      const loaded = load(template);
      const definition = definitionsOf(loaded as unknown as Json)[0];
      if (!definition) continue;
      const before = readByName(loaded as unknown as Json);
      const reconciled = reconcileInstanceWidgetValues(
        loaded,
        definition.id as string,
        null,
      );
      const after = readByName(save(reconciled));
      for (const [key, value] of before) {
        if (!after.has(key)) continue;
        checked += 1;
        if (after.get(key) !== value) {
          drifted.push(`${template.file} ${key}: ${value} became ${after.get(key)}`);
        }
      }
      for (const complaint of stockComplaints(save(reconciled))) {
        drifted.push(`${template.file}: ${complaint}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(summarize(drifted)).toBe('');
  });

  it('leaves promoted widget values where stock reads them', () => {
    // Stock walks the boundary inputs in order and consumes one widgets_values
    // entry per input whose interior link lands on a slot carrying `.widget`
    // (SubgraphNode._applyPromotedWidgetValues). Read the same way before and
    // after, every value must still answer to the same boundary name.
    const readByName = (graph: Json): Map<string, string> => {
      const values = new Map<string, string>();
      const defs = new Map(definitionsOf(graph).map((def) => [def.id as string, def]));
      for (const node of ((graph.nodes ?? []) as Json[])) {
        const def = defs.get(node.type as string);
        if (!def) continue;
        const inner = new Map(((def.nodes ?? []) as Json[]).map((n) => [n.id as number, n]));
        const widgetNames: string[] = [];
        for (const [index, slot] of ((def.inputs ?? []) as Json[]).entries()) {
          const feedsWidget = ((def.links ?? []) as Json[]).some((link) => {
            if (link.origin_id !== -10 || link.origin_slot !== index) return false;
            const target = inner.get(link.target_id as number);
            return Boolean(((target?.inputs ?? []) as Json[])[link.target_slot as number]?.widget);
          });
          if (feedsWidget) widgetNames.push(String(slot.name ?? index));
        }
        const stored = (node.widgets_values ?? []) as unknown[];
        widgetNames.forEach((name, i) => values.set(`${node.id}:${name}`, JSON.stringify(stored[i])));
      }
      return values;
    };

    const drifted: string[] = [];
    let checked = 0;
    for (const template of withSubgraphs(templates())) {
      const before = readByName(template.workflow);
      const after = readByName(save(load(template)));
      for (const [key, value] of before) {
        if (!after.has(key)) continue;
        checked += 1;
        if (after.get(key) !== value) drifted.push(`${template.file} ${key}: ${value} became ${after.get(key)}`);
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(summarize(drifted)).toBe('');
  });
});
