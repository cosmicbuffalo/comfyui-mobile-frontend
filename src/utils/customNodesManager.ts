import type { Workflow, WorkflowNode } from '@/api/types';
import { collectAllWorkflowNodes } from '@/utils/workflowNodes';
import type {
  CustomNodeAlternativesResponse,
  CustomNodeMappingsResponse,
  CustomNodePackageMetadata,
} from '@/api/customNodesManagerClient';

// A row is "unknown" (non-ComfyRegistry) when it has no CNR version string.
// Treat a missing/undefined version the same as the literal "unknown" so it
// isn't misclassified as a known registry package by filters/sort/actions.
export function isUnknownVersion(version?: string): boolean {
  return !version || version === 'unknown';
}

export const CUSTOM_NODE_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Installed', value: 'installed' },
  { label: 'Enabled', value: 'enabled' },
  { label: 'Disabled', value: 'disabled' },
  { label: 'Import Failed', value: 'import-fail' },
  { label: 'Not Installed', value: 'not-installed' },
  { label: 'ComfyRegistry', value: 'cnr' },
  { label: 'Non-ComfyRegistry', value: 'unknown' },
  { label: 'Update Available', value: 'Update' },
  { label: 'In Workflow', value: 'In Workflow' },
  { label: 'Missing', value: 'Missing' },
  { label: 'Favorites', value: 'Favorites' },
  { label: 'Alternatives of A1111', value: 'Alternatives' },
] as const;

export type CustomNodeFilterValue = (typeof CUSTOM_NODE_FILTERS)[number]['value'];

export interface CustomNodeRow extends CustomNodePackageMetadata {
  key: string;
  hash: string;
  originalData: CustomNodePackageMetadata;
  action: string;
  filterTypes: CustomNodeFilterValue[];
  nodes?: number;
  nodesList?: Array<{ name: string; conflicts?: Array<{ key: string; title: string; hash: string }> }>;
  conflicts?: number;
  alternatives?: string;
}

export interface CustomNodeActionOption {
  label: string;
  mode: 'install' | 'update' | 'switch' | 'disable' | 'uninstall';
  destructive?: boolean;
}

const BUILTIN_WORKFLOW_NODE_TYPES = new Set([
  'Note',
  'Reroute',
  'PrimitiveNode',
  'MarkdownNote',
  'GraphInput',
  'GraphOutput',
]);

function stableHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}


function normalizeComparableDate(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (!value) return -1;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? -1 : timestamp;
}

function titleOf(node: CustomNodePackageMetadata, fallback: string): string {
  return String(node.title || node.name || node.id || fallback);
}

function getRepoAuxId(repository: unknown): string | null {
  if (typeof repository !== 'string' || !repository.trim()) return null;
  const normalized = repository.replace(/\/$/, '');
  if (normalized.includes('github.com')) {
    return normalized.split('/').slice(-2).join('/');
  }
  return normalized.split('/').pop() || null;
}

export function buildCustomNodeRows(
  nodePacks: Record<string, CustomNodePackageMetadata>,
  options: {
    updateHashMap?: Record<string, true>;
    inWorkflowHashMap?: Record<string, true>;
    missingHashMap?: Record<string, true>;
    favoritesHashMap?: Record<string, true>;
    alternativesHashMap?: Record<string, { alternatives?: string }>;
    mappings?: CustomNodeMappingsResponse;
  } = {}
): CustomNodeRow[] {
  const rowsByKey: Record<string, CustomNodeRow> = {};

  for (const [key, node] of Object.entries(nodePacks)) {
    const hash = stableHash(key);
    const row: CustomNodeRow = {
      ...node,
      key,
      hash,
      // Shallow copy is enough: originalData is only ever read (spread into the
      // manager action payload), never mutated. A deep JSON round-trip here ran
      // once per pack (thousands of times) and blocked the modal's first paint.
      originalData: { ...node, id: node.id ?? key },
      action: node.state ?? 'unknown',
      filterTypes: [],
    };
    rowsByKey[key] = row;
  }

  if (options.mappings) {
    populateNodeMappings(rowsByKey, options.mappings);
  }

  for (const row of Object.values(rowsByKey)) {
    if (options.alternativesHashMap?.[row.hash]?.alternatives) {
      row.alternatives = options.alternativesHashMap[row.hash].alternatives;
    }

    if (row['update-state'] === 'true' || options.updateHashMap?.[row.hash]) {
      row.action = 'updatable';
      row['update-state'] = 'true';
    } else if (row['import-fail']) {
      row.action = 'import-fail';
    } else {
      row.action = row.state ?? 'unknown';
    }

    if (row['invalid-installation']) {
      row.action = 'invalid-installation';
    }

    const filters = new Set<CustomNodeFilterValue>();
    const state = row.state;
    if (state === 'enabled') {
      filters.add('enabled');
      filters.add('installed');
    } else if (state === 'disabled') {
      filters.add('disabled');
      filters.add('installed');
    } else if (state === 'not-installed') {
      filters.add('not-installed');
    }

    if (isUnknownVersion(row.version)) filters.add('unknown');
    else filters.add('cnr');

    if (row['update-state'] === 'true') filters.add('Update');
    if (row['import-fail']) filters.add('import-fail');
    if (row['invalid-installation']) filters.add('installed');
    if (options.inWorkflowHashMap?.[row.hash]) filters.add('In Workflow');
    if (options.missingHashMap?.[row.hash]) filters.add('Missing');
    if (row.is_favorite || options.favoritesHashMap?.[row.hash]) filters.add('Favorites');
    if (options.alternativesHashMap?.[row.hash]) filters.add('Alternatives');

    row.filterTypes = Array.from(filters);
  }

  return Object.values(rowsByKey).sort((a, b) => {
    const aUnknown = isUnknownVersion(a.version);
    const bUnknown = isUnknownVersion(b.version);
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
    const aStars = typeof a.stars === 'number' ? a.stars : -1;
    const bStars = typeof b.stars === 'number' ? b.stars : -1;
    if (aStars !== bStars) return bStars - aStars;
    return normalizeComparableDate(b.last_update) - normalizeComparableDate(a.last_update);
  });
}

export function filterCustomNodeRows(
  rows: CustomNodeRow[],
  filter: CustomNodeFilterValue,
  keywords: string
): CustomNodeRow[] {
  const query = keywords.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter && !row.filterTypes.includes(filter)) return false;
    if (!query) return true;
    const haystack = [
      row.title,
      row.name,
      row.id,
      row.author,
      row.description,
      row.repository,
      row.reference,
      row.alternatives,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

export function getCustomNodeActionOptions(row: CustomNodeRow): CustomNodeActionOption[] {
  if (row.restart) return [];
  const isManager = row.title === 'ComfyUI-Manager' || row.id === 'comfyui-manager' || row.key === 'comfyui-manager';
  const allowSwitch = !isUnknownVersion(row.version) && !isManager;
  const allowManage = !isManager;

  switch (row.action) {
    case 'updatable':
      return [
        { label: 'Update', mode: 'update' },
        ...(allowSwitch ? [{ label: 'Switch ver', mode: 'switch' } as const] : []),
        ...(allowManage ? [
          { label: 'Disable', mode: 'disable' } as const,
          { label: 'Uninstall', mode: 'uninstall', destructive: true } as const,
        ] : []),
      ];
    case 'enabled':
      return [
        { label: 'Try update', mode: 'update' },
        ...(allowSwitch ? [{ label: 'Switch ver', mode: 'switch' } as const] : []),
        ...(allowManage ? [
          { label: 'Disable', mode: 'disable' } as const,
          { label: 'Uninstall', mode: 'uninstall', destructive: true } as const,
        ] : []),
      ];
    case 'disabled':
    case 'import-fail':
      return [
        ...(allowSwitch ? [{ label: 'Switch ver', mode: 'switch' } as const] : []),
        ...(allowManage ? [{ label: 'Uninstall', mode: 'uninstall', destructive: true } as const] : []),
      ];
    case 'not-installed':
    case 'unknown':
    case 'invalid-installation':
      return [{ label: 'Install', mode: 'install' }];
    default:
      return [];
  }
}

export function buildFavoritesHashMap(rows: CustomNodeRow[]): Record<string, true> {
  const hashMap: Record<string, true> = {};
  for (const row of rows) {
    if (row.is_favorite) hashMap[row.hash] = true;
  }
  return hashMap;
}

export function buildAlternativesHashMap(
  rows: CustomNodeRow[],
  alternatives: CustomNodeAlternativesResponse
): Record<string, { alternatives?: string }> {
  const rowsByKey = new Map(rows.map((row) => [row.key, row]));
  const hashMap: Record<string, { alternatives?: string }> = {};
  for (const [key, item] of Object.entries(alternatives)) {
    const row = rowsByKey.get(key);
    if (!row) continue;
    const tags = Array.isArray(item.tags) ? item.tags.join(', ') : item.tags;
    const alternatives = [tags, item.description].filter(Boolean).join(' ');
    // Skip rows with no actual alternatives text — otherwise buildCustomNodeRows
    // marks them with the "Alternatives" filter despite having nothing to show.
    if (!alternatives) continue;
    hashMap[row.hash] = { alternatives };
  }
  return hashMap;
}

export function buildWorkflowHashMaps(
  workflow: Workflow | null,
  rows: CustomNodeRow[],
  mappings?: CustomNodeMappingsResponse,
  installedNodeTypes?: Record<string, unknown>
): {
  inWorkflowHashMap: Record<string, true>;
  missingHashMap: Record<string, true>;
} {
  const inWorkflowHashMap: Record<string, true> = {};
  const missingHashMap: Record<string, true> = {};
  if (!workflow) return { inWorkflowHashMap, missingHashMap };

  const byId = new Map<string, CustomNodeRow>();
  const byAuxId = new Map<string, CustomNodeRow>();
  for (const row of rows) {
    if (row.id) byId.set(row.id, row);
    byId.set(row.key, row);
    const auxId = getRepoAuxId(row.repository || row.reference || row.files?.[0]);
    if (auxId) byAuxId.set(auxId, row);
  }

  const mappingByNodeType = new Map<string, string[]>();
  if (mappings) {
    for (const [packKey, mapping] of Object.entries(mappings)) {
      const nodeTypes = Array.isArray(mapping?.[0]) ? mapping[0] : [];
      for (const nodeType of nodeTypes) {
        const current = mappingByNodeType.get(nodeType) ?? [];
        current.push(packKey);
        mappingByNodeType.set(nodeType, current);
      }
    }
  }

  const knownNodeTypes = new Set(Object.keys(installedNodeTypes ?? {}));
  const subgraphIds = new Set(workflow.definitions?.subgraphs?.map((subgraph) => subgraph.id) ?? []);

  for (const node of collectWorkflowNodes(workflow)) {
    const nodeIsRegistered = knownNodeTypes.has(node.type)
      || BUILTIN_WORKFLOW_NODE_TYPES.has(node.type)
      || subgraphIds.has(node.type);
    const row = resolveWorkflowNodeRow(node, byId, byAuxId);
    if (row) {
      inWorkflowHashMap[row.hash] = true;
      if (!nodeIsRegistered) missingHashMap[row.hash] = true;
      continue;
    }

    const mappedRows = (mappingByNodeType.get(node.type) ?? [])
      .map((packKey) => byId.get(packKey))
      .filter((item): item is CustomNodeRow => Boolean(item));

    for (const mappedRow of mappedRows) {
      inWorkflowHashMap[mappedRow.hash] = true;
      if (!nodeIsRegistered) missingHashMap[mappedRow.hash] = true;
    }

    if (
      !nodeIsRegistered
      && !mappedRows.length
    ) {
      for (const mappedRow of resolveMissingRowsByPattern(node.type, rows)) {
        missingHashMap[mappedRow.hash] = true;
      }
    }
  }

  return { inWorkflowHashMap, missingHashMap };
}

function populateNodeMappings(
  rowsByKey: Record<string, CustomNodeRow>,
  mappings: CustomNodeMappingsResponse
): void {
  const conflictsMap: Record<string, string[]> = {};

  const findRow = (key: string, title?: string) => {
    if (rowsByKey[key]) return rowsByKey[key];
    if (key.includes('/')) {
      const repoName = key.split('/').pop();
      if (repoName && rowsByKey[repoName]) return rowsByKey[repoName];
    }
    if (title && rowsByKey[title]) return rowsByKey[title];
    return undefined;
  };

  for (const [key, mapping] of Object.entries(mappings)) {
    const nodeTypes = Array.isArray(mapping?.[0]) ? Array.from(new Set(mapping[0])) : [];
    const metadata = mapping?.[1] ?? {};
    const row = findRow(key, metadata.title_aux);
    if (!row || nodeTypes.length === 0) continue;
    row.nodes = nodeTypes.length;
    row.nodesList = nodeTypes.map((name) => ({ name }));
    for (const name of nodeTypes) {
      const conflicts = conflictsMap[name] ?? [];
      conflicts.push(row.key);
      conflictsMap[name] = conflicts;
    }
  }

  for (const [nodeName, keys] of Object.entries(conflictsMap)) {
    if (keys.length <= 1) continue;
    for (const key of keys) {
      const row = rowsByKey[key];
      const nodeItem = row.nodesList?.find((item) => item.name === nodeName);
      if (!nodeItem) continue;
      nodeItem.conflicts = keys
        .filter((conflictKey) => conflictKey !== key)
        .map((conflictKey) => {
          const conflictRow = rowsByKey[conflictKey];
          return {
            key: conflictKey,
            hash: conflictRow.hash,
            title: titleOf(conflictRow, conflictKey),
          };
        });
    }
  }

  for (const row of Object.values(rowsByKey)) {
    row.conflicts = row.nodesList?.filter((item) => item.conflicts?.length).length;
  }
}

function collectWorkflowNodes(workflow: Workflow): WorkflowNode[] {
  return collectAllWorkflowNodes(workflow).filter((node) => Boolean(node?.type));
}

function resolveWorkflowNodeRow(
  node: WorkflowNode,
  byId: Map<string, CustomNodeRow>,
  byAuxId: Map<string, CustomNodeRow>
): CustomNodeRow | undefined {
  const cnrId = typeof node.properties?.cnr_id === 'string' ? node.properties.cnr_id : null;
  if (cnrId) return byId.get(cnrId);

  const auxId = typeof node.properties?.aux_id === 'string' ? node.properties.aux_id : null;
  if (auxId) return byAuxId.get(auxId) ?? byId.get(auxId);

  const packName = typeof node.properties?.pack_name === 'string' ? node.properties.pack_name : null;
  if (packName) return byId.get(packName);

  return undefined;
}

// Compile each server-provided pattern once and reuse it. Patterns come from a
// finite registry, so this map stays bounded; caching avoids recompiling the
// same regex on every node-type lookup. A pattern that fails to compile caches
// `null` so we don't retry it.
const compiledPatternCache = new Map<string, RegExp | null>();

function compileNodenamePattern(pattern: string): RegExp | null {
  const cached = compiledPatternCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    // No flags, so `.test()` is stateless and the cached object is safe to reuse.
    compiled = new RegExp(pattern);
  } catch {
    compiled = null;
  }
  compiledPatternCache.set(pattern, compiled);
  return compiled;
}

function resolveMissingRowsByPattern(nodeType: string, rows: CustomNodeRow[]): CustomNodeRow[] {
  const matches: CustomNodeRow[] = [];
  // JS regexes have no execution timeout, so bound BOTH the pattern and the
  // matched input: catastrophic backtracking scales with input length, and node
  // type names are short. This (plus the per-pattern length cap below) keeps a
  // malicious registry pattern from freezing the UI.
  if (nodeType.length > 200) return matches;
  for (const row of rows) {
    if (!row.nodename_pattern || row.nodename_pattern.length > 200) continue;
    const re = compileNodenamePattern(row.nodename_pattern);
    if (re && re.test(nodeType)) matches.push(row);
  }
  return matches;
}
