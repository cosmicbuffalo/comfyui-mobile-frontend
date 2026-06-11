import type { NodeTypes, Workflow, WorkflowNode } from "@/api/types";
import {
  createFilePrefixAliases,
  createInputAliases,
  resolveFilePrefixAliases,
} from "@/api/client";
import { getInputWidgetDefinitions, getWidgetDefinitions } from "@/utils/widgetDefinitions";

const INPUT_KEYS = ["image", "filename", "file"] as const;
const ALIAS_PREFIX = ".mi-";
const FILE_PREFIX_ALIAS_PREFIX = "mp-";

function isLoadImageType(value: unknown): boolean {
  return typeof value === "string" && /load[\s_-]*image/i.test(value);
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

function collectNodePaths(node: WorkflowNode, nodeTypes: NodeTypes, paths: Set<string>): void {
  if (!isLoadImageType(node.type)) return;
  // A bypassed node is excluded from the queued prompt and never executes, so its
  // input file may legitimately be missing. Don't collect its path for aliasing —
  // the backend alias endpoint raises "Input file not found" for missing files,
  // which would otherwise block the whole queue over a node that won't even run.
  if (node.mode === 4) return;
  if (Array.isArray(node.widgets_values)) {
    for (const definition of getInputWidgetDefinitions(nodeTypes, node)) {
      if (!INPUT_KEYS.includes(definition.name as (typeof INPUT_KEYS)[number])) continue;
      const value = node.widgets_values[definition.widgetIndex];
      if (typeof value === "string" && value.trim() && !isAliasPath(value)) paths.add(value);
    }
    return;
  }
  for (const key of INPUT_KEYS) {
    const value = node.widgets_values?.[key];
    if (typeof value === "string" && value.trim() && !isAliasPath(value)) paths.add(value);
  }
}

function replaceNodePaths(
  node: WorkflowNode,
  nodeTypes: NodeTypes,
  aliases: Record<string, string>,
): WorkflowNode {
  if (!isLoadImageType(node.type)) return node;
  if (Array.isArray(node.widgets_values)) {
    let nextValues: unknown[] | null = null;
    for (const definition of getInputWidgetDefinitions(nodeTypes, node)) {
      if (!INPUT_KEYS.includes(definition.name as (typeof INPUT_KEYS)[number])) continue;
      const value = node.widgets_values[definition.widgetIndex];
      if (typeof value !== "string" || !aliases[value]) continue;
      nextValues ??= [...node.widgets_values];
      nextValues[definition.widgetIndex] = aliases[value];
    }
    return nextValues ? { ...node, widgets_values: nextValues } : node;
  }

  let nextValues: Record<string, unknown> | null = null;
  for (const key of INPUT_KEYS) {
    const value = node.widgets_values?.[key];
    if (typeof value !== "string" || !aliases[value]) continue;
    nextValues ??= { ...node.widgets_values };
    nextValues[key] = aliases[value];
  }
  return nextValues ? { ...node, widgets_values: nextValues } : node;
}

function collectWorkflowPaths(workflow: Workflow, nodeTypes: NodeTypes, paths: Set<string>): void {
  workflow.nodes.forEach((node) => collectNodePaths(node, nodeTypes, paths));
  workflow.definitions?.subgraphs?.forEach((subgraph) => {
    subgraph.nodes.forEach((node) => collectNodePaths(node, nodeTypes, paths));
  });
}

function replaceWorkflowPaths(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  aliases: Record<string, string>,
): Workflow {
  const nodes = workflow.nodes.map((node) => replaceNodePaths(node, nodeTypes, aliases));
  const rootChanged = nodes.some((node, index) => node !== workflow.nodes[index]);
  const subgraphs = workflow.definitions?.subgraphs?.map((subgraph) => {
    const nextNodes = subgraph.nodes.map((node) => replaceNodePaths(node, nodeTypes, aliases));
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
      const path = (inputs as Record<string, unknown>)[key];
      if (typeof path === "string" && path.trim() && !isAliasPath(path)) paths.add(path);
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
      const path = (inputs as Record<string, unknown>)[key];
      if (typeof path !== "string" || !aliases[path]) continue;
      nextInputs ??= { ...(inputs as Record<string, unknown>) };
      nextInputs[key] = aliases[path];
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
  const inputObfuscated = paths.size === 0
    ? workflow
    : replaceWorkflowPaths(workflow, nodeTypes, await createInputAliases(Array.from(paths)));
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
  const inputObfuscatedWorkflow = replaceWorkflowPaths(workflow, nodeTypes, aliases);
  return {
    prompt: replacePromptPaths(prompt, aliases),
    // Keep the executable prompt's filename_prefix unchanged so output paths
    // remain exactly as configured. Only the embedded workflow is obfuscated.
    workflow: await obfuscateWorkflowFilePrefixes(inputObfuscatedWorkflow, nodeTypes),
  };
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
