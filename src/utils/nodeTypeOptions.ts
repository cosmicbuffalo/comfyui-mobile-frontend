import type { NodeInputDefinition, NodeInputEntry, NodeTypeDefinition, NodeTypes } from '@/api/types';

// When a new file is added to the input directory (an output copied in, or a
// device upload), it becomes a valid choice for every image-upload combo
// (LoadImage and friends) because the input dir is global. Rather than refetch
// the multi-MB `/api/object_info` just to learn one new filename we already
// know, we splice it straight into the cached node-type option lists.
//
// All functions return the SAME reference when nothing changed, so callers can
// cheaply skip a store update / re-render.

function appendToEntry(entry: NodeInputEntry, value: string): NodeInputEntry {
  const [choices, config] = entry;
  if (!Array.isArray(choices)) return entry;
  // Only image-upload pickers (config.image_upload === true) list input-dir
  // files; leave every other combo (samplers, schedulers, …) untouched.
  if (!config || config.image_upload !== true) return entry;
  if (choices.includes(value)) return entry;
  return [[...choices, value], config];
}

function appendInGroup(
  group: Record<string, NodeInputEntry> | undefined,
  value: string,
): Record<string, NodeInputEntry> | null {
  if (!group) return null;
  let changed = false;
  const next: Record<string, NodeInputEntry> = {};
  for (const [name, entry] of Object.entries(group)) {
    const nextEntry = appendToEntry(entry, value);
    if (nextEntry !== entry) changed = true;
    next[name] = nextEntry;
  }
  return changed ? next : null;
}

function appendToDefinition(def: NodeTypeDefinition, value: string): NodeTypeDefinition {
  const input = def.input as NodeInputDefinition | undefined;
  if (!input) return def;
  const nextRequired = appendInGroup(input.required, value);
  const nextOptional = appendInGroup(input.optional, value);
  if (!nextRequired && !nextOptional) return def;
  return {
    ...def,
    input: {
      ...input,
      ...(nextRequired ? { required: nextRequired } : {}),
      ...(nextOptional ? { optional: nextOptional } : {}),
    },
  };
}

/**
 * Return a copy of `nodeTypes` with `value` appended to the option list of every
 * image-upload combo that doesn't already include it. Returns the original
 * reference when no combo needed updating (or `value` is empty).
 */
export function addInputFileOptionToNodeTypes(nodeTypes: NodeTypes, value: string): NodeTypes {
  if (!value) return nodeTypes;
  let changed = false;
  const next: NodeTypes = {};
  for (const [typeName, def] of Object.entries(nodeTypes)) {
    const nextDef = appendToDefinition(def, value);
    if (nextDef !== def) changed = true;
    next[typeName] = nextDef;
  }
  return changed ? next : nodeTypes;
}
