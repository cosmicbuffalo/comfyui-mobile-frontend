import type { Workflow, WorkflowGroup, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import {
  getInstanceNumber,
  getMobileDefMeta,
  withMobileDefMeta,
} from '@/utils/canonicalWorkflowOps';
import { collectSubgraphInstances } from '@/utils/boundarySlotLabels';
import { interpolateInstanceLabel } from '@/utils/subgraphInstanceLabels';

/**
 * Write rendered instance names into the workflow itself.
 *
 * `{n}` lives on a shared definition, so it is a mobile convention: every other
 * frontend reads the raw template and shows "Segment {n}" on all twelve cards.
 * For anything else to see the rendered name it has to be somewhere standard
 * and per-instance, and a node's own `title` is exactly that — which is also
 * what rgthree's Fast Bypasser labels its toggles from.
 *
 * Two different shapes of template, so two rules:
 *
 * - A PLACEHOLDER's template is its type's name, which is stored separately
 *   from the title. Rendering into the title loses nothing, and the name is
 *   still there to re-render from when the type is renamed.
 * - A node or group INSIDE a definition has its template in the title itself,
 *   so rendering over it would destroy the only copy. The template is kept in
 *   metadata first, and the title becomes the rendered text.
 *
 * Inner contents are only rendered where the type has a single instance. There
 * is one copy of them for the whole type — twelve instances share one group
 * object — so with more than one there is no number that is true of it, and
 * the template is left showing rather than resolved to an arbitrary instance.
 */
export function materializeSubgraphTitles(workflow: Workflow): Workflow {
  const definitions = workflow.definitions?.subgraphs ?? [];
  if (definitions.length === 0) return workflow;

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const retitleInstance = (node: WorkflowNode): WorkflowNode => {
    const definition = byId.get(node.type);
    if (!definition) return node;
    return applyManagedTitle(node, definition.name?.trim() ?? '', getInstanceNumber(node), false);
  };

  const nodes = mapChanged(workflow.nodes ?? [], retitleInstance);
  const subgraphs = mapChanged(definitions, (definition) => {
    // Placeholders nested inside this definition are instances in their own
    // right, and named from their own type.
    const inner = mapChanged(definition.nodes ?? [], retitleInstance);
    const instances = collectSubgraphInstances(workflow, definition.id);
    const number = instances.length === 1 ? getInstanceNumber(instances[0].node) : undefined;
    return retitleContents(definition, inner, number);
  });

  if (nodes === workflow.nodes && subgraphs === definitions) return workflow;
  return { ...workflow, nodes, definitions: { ...workflow.definitions, subgraphs } };
}

/** `Array.map` that returns the original array when nothing moved. */
function mapChanged<T>(items: T[], mapper: (item: T) => T): T[] {
  let changed = false;
  const next = items.map((item) => {
    const mapped = mapper(item);
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? next : items;
}

/** The nodes and groups a definition holds, named for `instanceNumber`. */
function retitleContents(
  definition: WorkflowSubgraphDefinition,
  inner: WorkflowNode[],
  instanceNumber: number | undefined,
): WorkflowSubgraphDefinition {
  const nodes = mapChanged(inner, (node) =>
    applyManagedTitle(node, titleTemplateOf(node), instanceNumber, true),
  );

  const managed = { ...(getMobileDefMeta(definition).autoGroupTitles ?? {}) };
  let groupsChanged = false;
  const groups = (definition.groups ?? []).map((group) => {
    const key = String(group.id);
    const next = retitleGroup(group, managed[key], instanceNumber);
    if (next.marker === undefined) delete managed[key];
    else managed[key] = next.marker;
    if (next.group === group) return group;
    groupsChanged = true;
    return next.group;
  });

  if (!groupsChanged) {
    return nodes === definition.nodes ? definition : { ...definition, nodes };
  }
  return withMobileDefMeta({ ...definition, nodes, groups }, { autoGroupTitles: managed });
}

/** What a title is a template for, remembering what was rendered from it. */
export interface ManagedTitle {
  template: string;
  rendered?: string;
}

function retitleGroup(
  group: WorkflowGroup,
  marker: ManagedTitle | undefined,
  instanceNumber: number | undefined,
): { group: WorkflowGroup; marker: ManagedTitle | undefined } {
  const resolved = resolveManagedTitle(group.title, marker, instanceNumber);
  if (!resolved) return { group, marker: undefined };
  if (group.title === resolved.title) return { group, marker: resolved.marker };
  return { group: { ...group, title: resolved.title }, marker: resolved.marker };
}

/**
 * Decide the title to show and the template to remember.
 *
 * A title the user retyped is theirs: if it still holds a token it becomes the
 * new template, and if it does not, this stops managing that title at all.
 */
function resolveManagedTitle(
  current: string | undefined,
  marker: ManagedTitle | undefined,
  instanceNumber: number | undefined,
): { title: string; marker: ManagedTitle } | null {
  const title = current?.trim() || undefined;
  const userEdited = title !== undefined && title !== marker?.rendered && title !== marker?.template;
  const template = userEdited ? (title?.includes('{') ? title : undefined) : marker?.template ?? title;
  if (!template?.includes('{')) return null;

  // Nothing to resolve against: show the template rather than an arbitrary
  // instance's number, and keep it as the thing to render later.
  if (instanceNumber == null) return { title: template, marker: { template } };

  const rendered = interpolateInstanceLabel(template, instanceNumber);
  if (!rendered) return { title: template, marker: { template } };
  return { title: rendered, marker: { template, rendered } };
}

/** A node's own title, when it is a template. */
function titleTemplateOf(node: WorkflowNode): string {
  const managed = readManagedTitle(node);
  if (managed?.template) return managed.template;
  const title = typeof node.title === 'string' ? node.title.trim() : '';
  return title.includes('{') ? title : '';
}

/**
 * Set a node's title from `template`, leaving a title the user typed alone.
 *
 * `templateIsTheTitle` says where the template came from: an inner node keeps
 * its own in metadata, because the title is about to be overwritten with the
 * rendered text; a placeholder's lives on its type and needs no copy.
 */
function applyManagedTitle(
  node: WorkflowNode,
  template: string,
  instanceNumber: number | undefined,
  templateIsTheTitle: boolean,
): WorkflowNode {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const marker = readManagedTitle(node);
  const title = typeof node.title === 'string' ? node.title.trim() || undefined : undefined;

  const resolved = templateIsTheTitle
    ? resolveManagedTitle(title, marker, instanceNumber)
    : resolveInstanceTitle(title, template, marker, instanceNumber);

  if (!resolved) {
    // No template any more. Drop what was written, so the card falls back to
    // its type's name rather than keeping a number that means nothing now.
    if (marker === undefined) return node;
    const rest = { ...properties };
    delete rest[MANAGED_TITLE];
    return { ...node, title: title === marker.rendered ? undefined : node.title, properties: rest };
  }

  if (title === resolved.title && sameMarker(marker, resolved.marker)) return node;
  return {
    ...node,
    title: resolved.title,
    properties: { ...properties, [MANAGED_TITLE]: resolved.marker },
  };
}

/** A placeholder's title, rendered from its type's name. */
function resolveInstanceTitle(
  current: string | undefined,
  template: string,
  marker: ManagedTitle | undefined,
  instanceNumber: number | undefined,
): { title: string; marker: ManagedTitle } | null {
  if (!template.includes('{')) return null;
  // Anything the user typed wins, and is left exactly as it is.
  if (current !== undefined && current !== marker?.rendered) return null;
  if (instanceNumber == null) return null;
  const rendered = interpolateInstanceLabel(template, instanceNumber);
  if (!rendered || rendered === template) return null;
  return { title: rendered, marker: { template, rendered } };
}

/**
 * The title this pass wrote onto a node, when that is still what it says.
 *
 * Display renders from the type's name live rather than trusting this, so a
 * title left behind by a rename does not out-live it on the card. The stored
 * one is for the frontends that have no idea what `{n}` means.
 */
export function generatedTitleOf(node: WorkflowNode): string | undefined {
  const marker = readManagedTitle(node);
  const title = typeof node.title === 'string' ? node.title.trim() : undefined;
  return marker?.rendered && marker.rendered === title ? title : undefined;
}

function readManagedTitle(node: WorkflowNode): ManagedTitle | undefined {
  const value = (node.properties as Record<string, unknown> | undefined)?.[MANAGED_TITLE];
  if (!value || typeof value !== 'object') return undefined;
  const { template, rendered } = value as ManagedTitle;
  return typeof template === 'string' ? { template, rendered } : undefined;
}

function sameMarker(a: ManagedTitle | undefined, b: ManagedTitle | undefined): boolean {
  return a?.template === b?.template && a?.rendered === b?.rendered;
}

/** Node property recording the template a title came from, and what it rendered. */
const MANAGED_TITLE = 'mobileTitle';
