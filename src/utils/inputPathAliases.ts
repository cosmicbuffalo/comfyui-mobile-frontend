import type { NodeTypes, Workflow, WorkflowNode, WorkflowSubgraphDefinition } from "@/api/types";
import {
  createFilePrefixAliases,
  createInputAliases,
  resolveFilePrefixAliases,
  resolveInputAliases,
} from "@/api/client";
import {
  PROXY_INDEX_OFFSET,
  getInputWidgetDefinitions,
  getWidgetDefinitions,
  resolveInnerWidgetForBoundaryName,
  resolveSubgraphPlaceholderInputWidgetDefs,
} from "@/utils/widgetDefinitions";
import { isSubgraphPlaceholder } from "@/utils/canonicalWorkflowOps";
import { splitPathAnnotation, type AnnotatedPath } from "@/utils/annotatedPath";

const INPUT_KEYS = ["image", "filename", "file"] as const;
const ALIAS_PREFIX = ".mi-";
const FILE_PREFIX_ALIAS_PREFIX = "mp-";

function isLoadImageType(value: unknown): boolean {
  if (typeof value !== "string" || !/load[\s_-]*image/i.test(value)) return false;
  // LoadImageOutput ("Load Image (from Outputs)") and similarly-named variants
  // read from the OUTPUT folder, not the input folder this alias mechanism
  // manages. Their values reference output-resident files (often carrying a
  // "[output]" annotation that ComfyUI resolves natively), so aliasing them
  // against input/ raises "Input file not found" and blocks the whole queue.
  // Leave them untouched. (Mobile-authored output picks are copied into input/
  // first — see resolveUploadFolder — so they don't reach this node type.)
  if (/output/i.test(value)) return false;
  return true;
}

/**
 * Only input-resident files can be aliased. An `[output]`/`[temp]` value lives
 * in a directory this mechanism does not manage, exactly like LoadImageOutput
 * above, so it is left alone rather than failing the queue.
 *
 * Handing an annotated string to the alias endpoint makes it look for a file
 * whose name literally ends in " [input]", which never exists -- it raises
 * "Input file not found" and takes the whole queue submission down. That is
 * what the mask editor hit; see `@/utils/annotatedPath`.
 */
function aliasablePath(value: string): AnnotatedPath | null {
  const split = splitPathAnnotation(value);
  if (split.type === 'output' || split.type === 'temp') return null;
  if (!split.path.trim()) return null;
  return split;
}

// App-generated aliases are `<prefix><hex token>` (input aliases may also carry
// a file extension — see secrets.token_hex(...) in the backend). Requiring the
// token to be hex means a real user file/prefix that merely *starts* with the
// marker isn't mistaken for an alias, without coupling to the exact token length.
function isAliasPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.includes("/") || !normalized.startsWith(ALIAS_PREFIX)) return false;
  return /^[0-9a-f]+(\.[^/]+)?$/.test(normalized.slice(ALIAS_PREFIX.length));
}

function isFilePrefixAlias(value: string): boolean {
  if (!value.startsWith(FILE_PREFIX_ALIAS_PREFIX)) return false;
  return /^[0-9a-f]+$/.test(value.slice(FILE_PREFIX_ALIAS_PREFIX.length));
}

/**
 * The node that actually owns the widget a boundary input drives, following
 * the chain when the boundary drives ANOTHER placeholder's promoted slot.
 *
 * `resolveInnerWidgetForBoundaryName` stops at the first node inside the
 * definition, which under chained promotion is a nested placeholder rather than
 * the LoadImage. Stopping there failed the "is this really an input file?"
 * test, so the outer instance's LIVE value -- the one that executes -- was
 * never aliased at all, and the real filename shipped in the embedded copy.
 *
 * The link walk is repeated here rather than reused because the next hop needs
 * the target INPUT (its `name` is the nested definition's boundary slot), and
 * the shared helper only hands back the widget name. `seen` stops a definition
 * cycle from recursing forever.
 */
function resolveBoundaryOwnerNode(
  definition: WorkflowSubgraphDefinition | undefined,
  boundaryName: string,
  workflow: Workflow,
  seen: Set<string> = new Set(),
): WorkflowNode | null {
  if (!definition || seen.has(definition.id)) return null;
  seen.add(definition.id);
  const boundaryInput = (definition.inputs ?? []).find((slot) => slot.name === boundaryName);
  const linkId = boundaryInput?.linkIds?.[0];
  if (linkId === undefined) return null;
  const link = (definition.links ?? []).find((entry) => entry.id === linkId);
  if (!link) return null;
  const target = (definition.nodes ?? []).find((entry) => entry.id === link.target_id);
  if (!target) return null;
  if (!isSubgraphPlaceholder(target, workflow)) return target;
  const nestedBoundary = target.inputs?.[link.target_slot]?.name;
  if (!nestedBoundary) return null;
  const nested = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === target.type);
  return resolveBoundaryOwnerNode(nested, nestedBoundary, workflow, seen);
}

/**
 * The input-file widgets a subgraph placeholder owns, as {value index, value}.
 *
 * Promoting a LoadImage's `image` widget to the subgraph boundary moves the
 * LIVE value onto the placeholder -- the inner node keeps a copy that stops
 * being updated. Every walk here recurses into `definitions.subgraphs[*].nodes`,
 * so it used to alias that stale inner copy and skip the placeholder entirely,
 * because a placeholder's `type` is the definition's id and never satisfies
 * `isLoadImageType`. With obfuscation on, an alias that landed on a placeholder
 * was therefore never resolved back, and `mobile_object_info` strips alias
 * entries from the offered options -- so the card showed an unofferable
 * `.mi-<hash>` while the run itself still worked off the hard link.
 *
 * Three things this must not get wrong:
 *
 *  - The value index is NOT the boundary slot. A placeholder's `widgets_values`
 *    is ordered by `properties.proxyWidgets` when it has one; the resolver
 *    settles that (via getPlaceholderValueIndexForBoundarySlot) and hands back
 *    a real index.
 *  - Proxy defs carry `PROXY_INDEX_OFFSET`-shifted indices and must never reach
 *    a positional write. This resolver returns boundary defs only; the guard
 *    below keeps that true if that ever changes.
 *  - The def's `name` is a DISPLAY LABEL, so it is matched on `inputName` (the
 *    canonical schema name) instead -- otherwise relabelling a promoted slot
 *    quietly took the widget out of scope again.
 */
function placeholderInputFileWidgets(
  node: WorkflowNode,
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Array<{ widgetIndex: number; value: string }> {
  if (!isSubgraphPlaceholder(node, workflow)) return [];
  // Bypassed: excluded from the prompt, so its file may legitimately be gone.
  if (node.mode === 4) return [];
  if (!Array.isArray(node.widgets_values)) return [];
  const definition = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === node.type);
  if (!definition) return [];

  const found: Array<{ widgetIndex: number; value: string }> = [];
  for (const definitionEntry of resolveSubgraphPlaceholderInputWidgetDefs(node, workflow, nodeTypes)) {
    const { widgetIndex, inputIndex, connected } = definitionEntry;
    if (connected) continue; // fed by a link, not a stored value
    if (widgetIndex < 0 || widgetIndex >= PROXY_INDEX_OFFSET) continue;
    const canonicalName = definitionEntry.inputName ?? definitionEntry.name;
    if (!INPUT_KEYS.includes(canonicalName as (typeof INPUT_KEYS)[number])) continue;
    // Only widgets belonging to a LoadImage-ish inner node name input files.
    const boundaryName = node.inputs?.[inputIndex]?.name;
    // Follows chained promotion; see resolveBoundaryOwnerNode.
    const owner = boundaryName
      ? resolveBoundaryOwnerNode(definition, boundaryName, workflow)
      : null;
    if (!owner || !isLoadImageType(owner.type)) continue;
    if (owner.mode === 4) continue;
    const value = node.widgets_values[widgetIndex];
    if (typeof value !== "string") continue;
    found.push({ widgetIndex, value });
  }
  return found;
}

/**
 * The link-driven promoted slots of a placeholder that `staleInnerWidgets` has
 * already condemned -- chained promotion.
 *
 * Promote a LoadImage's widget to its subgraph's boundary, nest THAT subgraph
 * in another one and promote the slot again, and the value exists three times:
 * live on the outer instance, and as a leftover on both the mid-level
 * placeholder and the innermost node. The innermost copy is handled as an
 * ordinary stale inner widget. The mid-level one is not reached by any walk
 * here: `placeholderInputFileWidgets` skips a slot whose input carries a link,
 * because a link-fed slot's stored entry is not what executes -- true, and
 * exactly why the leftover sitting in it is dead data that still ships inside
 * `definitions.subgraphs[*].nodes[*]` of the embedded workflow.
 *
 * Membership of the stale map is the whole safety argument: `staleInnerWidgets`
 * only records a widget once every live instance of the enclosing type supplies
 * the slot, so a value it names is provably never read. This adds no judgement
 * of its own -- it finds the slot the map is talking about and hands it back.
 *
 * The key is rebuilt from `inp.widget.name`, the same field
 * `resolveInnerWidgetForBoundaryName` reads when the map is built, rather than
 * from the resolver's canonical `inputName`. Those two differ the moment a
 * boundary slot is named something other than the widget it drives, and a key
 * that silently missed would look exactly like "no leak here".
 */
function placeholderChainedStaleSlots(
  node: WorkflowNode,
  workflow: Workflow,
  nodeTypes: NodeTypes,
  staleWidgets: ReadonlyMap<string, string> | undefined,
): Array<{ widgetIndex: number; value: string; key: string }> {
  if (!staleWidgets?.size) return [];
  if (!isSubgraphPlaceholder(node, workflow)) return [];
  if (!Array.isArray(node.widgets_values)) return [];

  const defs = resolveSubgraphPlaceholderInputWidgetDefs(node, workflow, nodeTypes);
  const found: Array<{ widgetIndex: number; value: string; key: string }> = [];
  (node.inputs ?? []).forEach((input, inputIndex) => {
    const widgetName = input.widget?.name;
    // Only a slot actually driven by a link: an unlinked one still owns its
    // value and belongs to placeholderInputFileWidgets.
    if (!widgetName || input.link == null) return;
    const key = `${node.id}:${widgetName}`;
    if (!staleWidgets.has(key)) return;
    const definitionEntry = defs.find((def) => def.inputIndex === inputIndex);
    if (!definitionEntry) return;
    const { widgetIndex } = definitionEntry;
    if (widgetIndex < 0 || widgetIndex >= PROXY_INDEX_OFFSET) return;
    const canonicalName = definitionEntry.inputName ?? definitionEntry.name;
    if (!INPUT_KEYS.includes(canonicalName as (typeof INPUT_KEYS)[number])) return;
    const value = (node.widgets_values as unknown[])[widgetIndex];
    if (typeof value !== "string") return;
    found.push({ widgetIndex, value, key });
  });
  return found;
}

/**
 * Inner widgets whose value never executes: `<nodeId>:<widgetName>` for every
 * widget a boundary input drives, PROVIDED every live instance of the type
 * actually supplies the value (a link into the slot, or a defined
 * `widgets_values` entry). The inner copy is then the stale leftover promotion
 * created, and it can point at a file that has since been deleted -- sending it
 * to the alias endpoint raises "Input file not found" and takes the whole
 * queue submission down over a value nothing runs.
 *
 * The per-instance check matters: stock's _applyPromotedWidgetValues guards on
 * `value !== undefined`, so an instance whose `widgets_values` stops short of
 * the promoted index falls through to the inner node's own value -- the inner
 * copy is then live for that instance and must keep being aliased. A type with
 * no live instance (none, or all bypassed) never executes its inner nodes at
 * all, so its driven widgets are stale by the same rule as a bypassed node.
 *
 * Each entry maps to a REPLACEMENT for the stale value in the obfuscated copy.
 * Skipping collection alone is not enough: with no alias minted, the replace
 * walk would leave the literal old filename inside
 * `definitions.subgraphs[*].nodes`, leaking the pre-repoint name in every
 * shared output -- the exact thing obfuscation exists to prevent. An
 * instance's own value is safe to write there (it ships on that placeholder
 * regardless, aliased when aliasable), and no live instance reads the slot,
 * which is the same argument that made skipping it safe. Blank when no
 * instance holds one.
 */
function staleInnerWidgets(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  subgraph: WorkflowSubgraphDefinition,
): Map<string, string> {
  const stale = new Map<string, string>();
  const driven: Array<{ boundaryName: string; ownerKey: string }> = [];
  for (const input of subgraph.inputs ?? []) {
    const boundaryName = input.name;
    if (!boundaryName) continue;
    const owner = resolveInnerWidgetForBoundaryName(subgraph, boundaryName);
    if (owner) driven.push({
      boundaryName,
      ownerKey: `${owner.innerNode.id}:${owner.widgetName}`,
    });
  }
  if (driven.length === 0) return stale;

  const liveInstances: WorkflowNode[] = [];
  const allInstances: WorkflowNode[] = [];
  const scan = (nodes: WorkflowNode[]) => {
    for (const candidate of nodes) {
      if (candidate.type !== subgraph.id) continue;
      allInstances.push(candidate);
      if (candidate.mode !== 4) liveInstances.push(candidate);
    }
  };
  scan(workflow.nodes);
  workflow.definitions?.subgraphs?.forEach((other) => scan(other.nodes));

  const slotEntry = (placeholder: WorkflowNode, boundaryName: string) =>
    resolveSubgraphPlaceholderInputWidgetDefs(placeholder, workflow, nodeTypes)
      .find((def) => placeholder.inputs?.[def.inputIndex]?.name === boundaryName);

  for (const { boundaryName, ownerKey } of driven) {
    const covered = liveInstances.every((placeholder) => {
      const entry = slotEntry(placeholder, boundaryName);
      if (!entry) return false;
      if (entry.connected) return true;
      if (entry.widgetIndex < 0 || entry.widgetIndex >= PROXY_INDEX_OFFSET) return false;
      return Array.isArray(placeholder.widgets_values)
        && placeholder.widgets_values[entry.widgetIndex] !== undefined;
    });
    if (!covered) continue;
    let replacement = "";
    for (const placeholder of allInstances) {
      const entry = slotEntry(placeholder, boundaryName);
      if (!entry || entry.widgetIndex < 0 || entry.widgetIndex >= PROXY_INDEX_OFFSET) continue;
      // A link-driven instance's own stored value is dead by the same argument
      // being applied here, and under chained promotion it is scrubbed as well
      // -- adopting it as the replacement would only move the leftover
      // filename one level down. Blank is the honest answer when no instance
      // owns a value.
      if (entry.connected) continue;
      const value = Array.isArray(placeholder.widgets_values)
        ? placeholder.widgets_values[entry.widgetIndex]
        : undefined;
      if (typeof value === "string" && value) {
        replacement = value;
        break;
      }
    }
    stale.set(ownerKey, replacement);
  }
  return stale;
}

function collectNodePaths(
  node: WorkflowNode,
  workflow: Workflow,
  nodeTypes: NodeTypes,
  paths: Set<string>,
  staleWidgets?: ReadonlyMap<string, string>,
): void {
  for (const { value } of placeholderInputFileWidgets(node, workflow, nodeTypes)) {
    const split = aliasablePath(value);
    if (split && !isAliasPath(split.path)) paths.add(split.path);
  }
  if (!isLoadImageType(node.type)) return;
  // A bypassed node is excluded from the queued prompt and never executes, so its
  // input file may legitimately be missing. Don't collect its path for aliasing —
  // the backend alias endpoint raises "Input file not found" for missing files,
  // which would otherwise block the whole queue over a node that won't even run.
  if (node.mode === 4) return;
  if (Array.isArray(node.widgets_values)) {
    for (const definition of getInputWidgetDefinitions(nodeTypes, node)) {
      if (!INPUT_KEYS.includes(definition.name as (typeof INPUT_KEYS)[number])) continue;
      // Keyed on the canonical schema name, like every stale lookup here --
      // `name` alone is a display label on qualified defs.
      if (staleWidgets?.has(`${node.id}:${definition.inputName ?? definition.name}`)) continue;
      const value = node.widgets_values[definition.widgetIndex];
      if (typeof value !== "string") continue;
      const split = aliasablePath(value);
      if (split && !isAliasPath(split.path)) paths.add(split.path);
    }
    return;
  }
  for (const key of INPUT_KEYS) {
    if (staleWidgets?.has(`${node.id}:${key}`)) continue;
    const value = node.widgets_values?.[key];
    if (typeof value !== "string") continue;
    const split = aliasablePath(value);
    if (split && !isAliasPath(split.path)) paths.add(split.path);
  }
}

function replaceNodePaths(
  node: WorkflowNode,
  workflow: Workflow,
  nodeTypes: NodeTypes,
  aliases: Record<string, string>,
  staleWidgets?: ReadonlyMap<string, string>,
): WorkflowNode {
  // A stale slot's raw path was never sent for aliasing (see
  // staleInnerWidgets), so `aliases` cannot cover it -- overwrite it with the
  // instance value chosen there instead of shipping the literal filename in
  // the embedded copy. An already-aliased or non-aliasable value leaks
  // nothing and is left alone, keeping this a no-op on restore-shaped input.
  const staleReplacementFor = (
    replacement: string | undefined,
    value: string,
  ): string | null => {
    if (replacement === undefined) return null;
    const split = aliasablePath(value);
    if (!split || isAliasPath(split.path)) return null;
    const replacementSplit = aliasablePath(replacement);
    const next = replacementSplit && aliases[replacementSplit.path]
      ? aliases[replacementSplit.path] + replacementSplit.suffix
      : replacement;
    return next === value ? null : next;
  };
  const staleReplacement = (canonicalName: string, value: string): string | null =>
    staleReplacementFor(staleWidgets?.get(`${node.id}:${canonicalName}`), value);

  const promoted = placeholderInputFileWidgets(node, workflow, nodeTypes);
  // Chained promotion leaves a dead value on the MID-LEVEL placeholder too; it
  // is link-driven, so `promoted` never reports it. See
  // placeholderChainedStaleSlots.
  const chainedStale = placeholderChainedStaleSlots(node, workflow, nodeTypes, staleWidgets);
  if (promoted.length > 0 || chainedStale.length > 0) {
    let nextValues: unknown[] | null = null;
    for (const { widgetIndex, value } of promoted) {
      const split = aliasablePath(value);
      if (!split || !aliases[split.path]) continue;
      nextValues ??= [...(node.widgets_values as unknown[])];
      nextValues[widgetIndex] = aliases[split.path] + split.suffix;
    }
    for (const { widgetIndex, value, key } of chainedStale) {
      const overwrite = staleReplacementFor(staleWidgets?.get(key), value);
      if (overwrite === null) continue;
      nextValues ??= [...(node.widgets_values as unknown[])];
      nextValues[widgetIndex] = overwrite;
    }
    return nextValues ? { ...node, widgets_values: nextValues } : node;
  }
  if (!isLoadImageType(node.type)) return node;
  if (Array.isArray(node.widgets_values)) {
    let nextValues: unknown[] | null = null;
    for (const definition of getInputWidgetDefinitions(nodeTypes, node)) {
      if (!INPUT_KEYS.includes(definition.name as (typeof INPUT_KEYS)[number])) continue;
      const value = node.widgets_values[definition.widgetIndex];
      if (typeof value !== "string") continue;
      const overwrite = staleReplacement(definition.inputName ?? definition.name, value);
      if (overwrite !== null) {
        nextValues ??= [...node.widgets_values];
        nextValues[definition.widgetIndex] = overwrite;
        continue;
      }
      const split = aliasablePath(value);
      if (!split || !aliases[split.path]) continue;
      nextValues ??= [...node.widgets_values];
      // Re-attach the annotation so the value keeps the same shape whether or
      // not obfuscation is on.
      nextValues[definition.widgetIndex] = aliases[split.path] + split.suffix;
    }
    return nextValues ? { ...node, widgets_values: nextValues } : node;
  }

  let nextValues: Record<string, unknown> | null = null;
  for (const key of INPUT_KEYS) {
    const value = node.widgets_values?.[key];
    if (typeof value !== "string") continue;
    const overwrite = staleReplacement(key, value);
    if (overwrite !== null) {
      nextValues ??= { ...node.widgets_values };
      nextValues[key] = overwrite;
      continue;
    }
    const split = aliasablePath(value);
    if (!split || !aliases[split.path]) continue;
    nextValues ??= { ...node.widgets_values };
    nextValues[key] = aliases[split.path] + split.suffix;
  }
  return nextValues ? { ...node, widgets_values: nextValues } : node;
}

function collectWorkflowPaths(workflow: Workflow, nodeTypes: NodeTypes, paths: Set<string>): void {
  workflow.nodes.forEach((node) => collectNodePaths(node, workflow, nodeTypes, paths));
  workflow.definitions?.subgraphs?.forEach((subgraph) => {
    const stale = staleInnerWidgets(workflow, nodeTypes, subgraph);
    subgraph.nodes.forEach((node) => collectNodePaths(node, workflow, nodeTypes, paths, stale));
  });
}

function collectNodeInputAliases(
  node: WorkflowNode,
  workflow: Workflow,
  nodeTypes: NodeTypes,
  aliases: Set<string>,
): void {
  for (const { value } of placeholderInputFileWidgets(node, workflow, nodeTypes)) {
    const { path } = splitPathAnnotation(value);
    if (isAliasPath(path)) aliases.add(path);
  }
  if (!isLoadImageType(node.type)) return;
  if (Array.isArray(node.widgets_values)) {
    for (const definition of getInputWidgetDefinitions(nodeTypes, node)) {
      if (!INPUT_KEYS.includes(definition.name as (typeof INPUT_KEYS)[number])) continue;
      const value = node.widgets_values[definition.widgetIndex];
      if (typeof value !== "string") continue;
      const { path } = splitPathAnnotation(value);
      if (isAliasPath(path)) aliases.add(path);
    }
    return;
  }
  for (const key of INPUT_KEYS) {
    const value = node.widgets_values?.[key];
    if (typeof value !== "string") continue;
    const { path } = splitPathAnnotation(value);
    if (isAliasPath(path)) aliases.add(path);
  }
}

function collectWorkflowInputAliases(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  aliases: Set<string>,
): void {
  workflow.nodes.forEach((node) => collectNodeInputAliases(node, workflow, nodeTypes, aliases));
  workflow.definitions?.subgraphs?.forEach((subgraph) => {
    subgraph.nodes.forEach((node) => collectNodeInputAliases(node, workflow, nodeTypes, aliases));
  });
}

function replaceWorkflowPaths(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  aliases: Record<string, string>,
  // Obfuscation direction only: restore must leave stale slots exactly as
  // loaded rather than "healing" them with another instance's value.
  obfuscating = false,
): Workflow {
  const nodes = workflow.nodes.map((node) => replaceNodePaths(node, workflow, nodeTypes, aliases));
  const rootChanged = nodes.some((node, index) => node !== workflow.nodes[index]);
  const subgraphs = workflow.definitions?.subgraphs?.map((subgraph) => {
    const stale = obfuscating ? staleInnerWidgets(workflow, nodeTypes, subgraph) : undefined;
    const nextNodes = subgraph.nodes.map((node) => replaceNodePaths(node, workflow, nodeTypes, aliases, stale));
    return nextNodes.some((node, index) => node !== subgraph.nodes[index])
      ? { ...subgraph, nodes: nextNodes }
      : subgraph;
  });
  const subgraphsChanged = subgraphs?.some(
    (subgraph, index) => subgraph !== workflow.definitions?.subgraphs?.[index],
  ) ?? false;
  if (!rootChanged && !subgraphsChanged) return workflow;
  return {
    ...workflow,
    nodes,
    ...(subgraphsChanged ? {
      definitions: {
        ...(workflow.definitions ?? {}),
        subgraphs,
      },
    } : {}),
  };
}

function collectNodeFilePrefixes(node: WorkflowNode, nodeTypes: NodeTypes, prefixes: Set<string>): void {
  if (Array.isArray(node.widgets_values)) {
    for (const definition of getWidgetDefinitions(nodeTypes, node)) {
      if (definition.name !== "filename_prefix") continue;
      const value = node.widgets_values[definition.widgetIndex];
      if (
        typeof value === "string"
        && value
        && !isFilePrefixAlias(value)
      ) {
        prefixes.add(value);
      }
    }
    return;
  }
  const value = node.widgets_values?.filename_prefix;
  if (typeof value === "string" && value && !isFilePrefixAlias(value)) {
    prefixes.add(value);
  }
}

function replaceNodeFilePrefixes(
  node: WorkflowNode,
  nodeTypes: NodeTypes,
  aliases: Record<string, string>,
): WorkflowNode {
  if (Array.isArray(node.widgets_values)) {
    let nextValues: unknown[] | null = null;
    for (const definition of getWidgetDefinitions(nodeTypes, node)) {
      if (definition.name !== "filename_prefix") continue;
      const value = node.widgets_values[definition.widgetIndex];
      if (typeof value !== "string" || !aliases[value]) continue;
      nextValues ??= [...node.widgets_values];
      nextValues[definition.widgetIndex] = aliases[value];
    }
    return nextValues ? { ...node, widgets_values: nextValues } : node;
  }
  const value = node.widgets_values?.filename_prefix;
  if (typeof value !== "string" || !aliases[value]) return node;
  return {
    ...node,
    widgets_values: { ...node.widgets_values, filename_prefix: aliases[value] },
  };
}

function collectWorkflowFilePrefixes(workflow: Workflow, nodeTypes: NodeTypes, prefixes: Set<string>): void {
  workflow.nodes.forEach((node) => collectNodeFilePrefixes(node, nodeTypes, prefixes));
  workflow.definitions?.subgraphs?.forEach((subgraph) => {
    subgraph.nodes.forEach((node) => collectNodeFilePrefixes(node, nodeTypes, prefixes));
  });
}

function replaceWorkflowFilePrefixes(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  aliases: Record<string, string>,
): Workflow {
  const nodes = workflow.nodes.map((node) => replaceNodeFilePrefixes(node, nodeTypes, aliases));
  const rootChanged = nodes.some((node, index) => node !== workflow.nodes[index]);
  const subgraphs = workflow.definitions?.subgraphs?.map((subgraph) => {
    const nextNodes = subgraph.nodes.map((node) => replaceNodeFilePrefixes(node, nodeTypes, aliases));
    return nextNodes.some((node, index) => node !== subgraph.nodes[index])
      ? { ...subgraph, nodes: nextNodes }
      : subgraph;
  });
  const subgraphsChanged = subgraphs?.some(
    (subgraph, index) => subgraph !== workflow.definitions?.subgraphs?.[index],
  ) ?? false;
  if (!rootChanged && !subgraphsChanged) return workflow;
  return {
    ...workflow,
    nodes,
    ...(subgraphsChanged ? {
      definitions: {
        ...(workflow.definitions ?? {}),
        subgraphs,
      },
    } : {}),
  };
}

function collectWorkflowFilePrefixAliases(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  aliases: Set<string>,
): void {
  const collect = (node: WorkflowNode) => {
    if (Array.isArray(node.widgets_values)) {
      for (const definition of getWidgetDefinitions(nodeTypes, node)) {
        if (definition.name !== "filename_prefix") continue;
        const value = node.widgets_values[definition.widgetIndex];
        if (typeof value === "string" && isFilePrefixAlias(value)) aliases.add(value);
      }
      return;
    }
    const value = node.widgets_values?.filename_prefix;
    if (typeof value === "string" && isFilePrefixAlias(value)) aliases.add(value);
  };
  workflow.nodes.forEach(collect);
  workflow.definitions?.subgraphs?.forEach((subgraph) => subgraph.nodes.forEach(collect));
}

async function obfuscateWorkflowFilePrefixes(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Promise<Workflow> {
  const prefixes = new Set<string>();
  collectWorkflowFilePrefixes(workflow, nodeTypes, prefixes);
  if (prefixes.size === 0) return workflow;
  const aliases = await createFilePrefixAliases(Array.from(prefixes));
  return replaceWorkflowFilePrefixes(workflow, nodeTypes, aliases);
}

function collectPromptPaths(prompt: Record<string, unknown>, paths: Set<string>): void {
  for (const value of Object.values(prompt)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (!isLoadImageType(node.class_type)) continue;
    const inputs = node.inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    for (const key of INPUT_KEYS) {
      const value = (inputs as Record<string, unknown>)[key];
      if (typeof value !== "string") continue;
      const split = aliasablePath(value);
      if (split && !isAliasPath(split.path)) paths.add(split.path);
    }
  }
}

function replacePromptPaths(
  prompt: Record<string, unknown>,
  aliases: Record<string, string>,
): Record<string, unknown> {
  let result: Record<string, unknown> | null = null;
  for (const [nodeId, value] of Object.entries(prompt)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (!isLoadImageType(node.class_type)) continue;
    const inputs = node.inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    let nextInputs: Record<string, unknown> | null = null;
    for (const key of INPUT_KEYS) {
      const value = (inputs as Record<string, unknown>)[key];
      if (typeof value !== "string") continue;
      const split = aliasablePath(value);
      if (!split || !aliases[split.path]) continue;
      nextInputs ??= { ...(inputs as Record<string, unknown>) };
      nextInputs[key] = aliases[split.path] + split.suffix;
    }
    if (!nextInputs) continue;
    result ??= { ...prompt };
    result[nodeId] = { ...node, inputs: nextInputs };
  }
  return result ?? prompt;
}

export async function obfuscateWorkflowInputPaths(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Promise<Workflow> {
  const paths = new Set<string>();
  collectWorkflowPaths(workflow, nodeTypes, paths);
  // Replace even with nothing to alias: stale-slot overwrites don't need one.
  const aliases = paths.size === 0 ? {} : await createInputAliases(Array.from(paths));
  const inputObfuscated = replaceWorkflowPaths(workflow, nodeTypes, aliases, true);
  return obfuscateWorkflowFilePrefixes(inputObfuscated, nodeTypes);
}

export async function obfuscateQueuedInputPaths(
  prompt: Record<string, unknown>,
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Promise<{ prompt: Record<string, unknown>; workflow: Workflow }> {
  const paths = new Set<string>();
  collectPromptPaths(prompt, paths);
  collectWorkflowPaths(workflow, nodeTypes, paths);
  const aliases = paths.size === 0 ? {} : await createInputAliases(Array.from(paths));
  const inputObfuscatedWorkflow = replaceWorkflowPaths(workflow, nodeTypes, aliases, true);
  return {
    prompt: replacePromptPaths(prompt, aliases),
    // Keep the executable prompt's filename_prefix unchanged so output paths
    // remain exactly as configured. Only the embedded workflow is obfuscated.
    workflow: await obfuscateWorkflowFilePrefixes(inputObfuscatedWorkflow, nodeTypes),
  };
}

export function hasRecognizedInputAliasShape(workflow: Workflow, nodeTypes: NodeTypes): boolean {
  const aliases = new Set<string>();
  collectWorkflowInputAliases(workflow, nodeTypes, aliases);
  return aliases.size > 0;
}

export async function restoreWorkflowInputPaths(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Promise<Workflow> {
  const aliases = new Set<string>();
  collectWorkflowInputAliases(workflow, nodeTypes, aliases);
  if (aliases.size === 0) return workflow;
  const resolved = await resolveInputAliases(Array.from(aliases));
  return replaceWorkflowPaths(workflow, nodeTypes, resolved);
}

export function hasRecognizedFilePrefixAliasShape(workflow: Workflow, nodeTypes: NodeTypes): boolean {
  const aliases = new Set<string>();
  collectWorkflowFilePrefixAliases(workflow, nodeTypes, aliases);
  return aliases.size > 0;
}

export async function restoreWorkflowFilePrefixes(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Promise<Workflow> {
  const aliases = new Set<string>();
  collectWorkflowFilePrefixAliases(workflow, nodeTypes, aliases);
  if (aliases.size === 0) return workflow;
  const resolved = await resolveFilePrefixAliases(Array.from(aliases));
  return replaceWorkflowFilePrefixes(workflow, nodeTypes, resolved);
}

export function hasRecognizedPathAliasShape(workflow: Workflow, nodeTypes: NodeTypes): boolean {
  return hasRecognizedInputAliasShape(workflow, nodeTypes)
    || hasRecognizedFilePrefixAliasShape(workflow, nodeTypes);
}

export async function restoreWorkflowPathAliases(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Promise<Workflow> {
  const inputRestored = await restoreWorkflowInputPaths(workflow, nodeTypes);
  return restoreWorkflowFilePrefixes(inputRestored, nodeTypes);
}
