import type { WorkflowNode } from '@/api/types';

export interface LoraManagerEntry {
  name: string;
  strength: number | string;
  clipStrength?: number | string;
  active?: boolean;
  expanded?: boolean;
  locked?: boolean;
  [key: string]: unknown;
}

const LORA_LOADER_NODE_TYPES = new Set([
  'Lora Loader (LoraManager)'
]);
const LORA_CHAIN_PROVIDER_NODE_TYPES = new Set([
  'Lora Stacker (LoraManager)',
  'Lora Randomizer (LoraManager)',
  'Lora Cycler (LoraManager)'
]);
const LORA_DIRECT_PROVIDER_NODE_TYPES = new Set([
  'Lora Stacker (LoraManager)',
  'Lora Randomizer (LoraManager)',
  'Lora Cycler (LoraManager)',
  'WanVideo Lora Select (LoraManager)'
]);
const LORA_CYCLER_NODE_TYPES = new Set([
  'Lora Cycler (LoraManager)'
]);

const EPSILON = Number.EPSILON;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const LORA_PATTERN = /<lora:([^:>]+):([-\d.]+)(?::([-\d.]+))?>/g;

export function isLoraManagerNodeType(nodeType: string): boolean {
  return isLoraLoaderNodeType(nodeType) || isLoraDirectProviderNodeType(nodeType);
}

export function isLoraLoaderNodeType(nodeType: string): boolean {
  if (LORA_LOADER_NODE_TYPES.has(nodeType)) return true;
  const lowered = nodeType.toLowerCase();
  return lowered.includes('(loramanager)') && lowered.includes('lora loader');
}

export function isLoraChainProviderNodeType(nodeType: string): boolean {
  if (LORA_CHAIN_PROVIDER_NODE_TYPES.has(nodeType)) return true;
  const lowered = nodeType.toLowerCase();
  return lowered.includes('(loramanager)') && (
    lowered.includes('lora stacker') ||
    lowered.includes('lora randomizer') ||
    lowered.includes('lora cycler')
  );
}

export function isLoraDirectProviderNodeType(nodeType: string): boolean {
  if (LORA_DIRECT_PROVIDER_NODE_TYPES.has(nodeType)) return true;
  const lowered = nodeType.toLowerCase();
  return lowered.includes('(loramanager)') && (
    lowered.includes('lora stacker') ||
    lowered.includes('lora randomizer') ||
    lowered.includes('lora cycler') ||
    lowered.includes('wanvideo lora select')
  );
}

export function isLoraCyclerNodeType(nodeType: string): boolean {
  if (LORA_CYCLER_NODE_TYPES.has(nodeType)) return true;
  const lowered = nodeType.toLowerCase();
  return lowered.includes('(loramanager)') && lowered.includes('lora cycler');
}

export function isLoraList(value: unknown): value is LoraManagerEntry[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return value.every((entry) =>
    isRecord(entry) && typeof entry.name === 'string' && 'strength' in entry
  );
}

export function extractLoraList(value: unknown): LoraManagerEntry[] | null {
  if (isLoraList(value)) return value;
  if (isRecord(value) && isLoraList(value.__value__)) {
    return value.__value__ as LoraManagerEntry[];
  }
  return null;
}

export function findLoraListIndex(
  node: WorkflowNode,
  textIndex?: number | null
): number | null {
  if (!Array.isArray(node.widgets_values)) return null;
  const values = node.widgets_values;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (isLoraList(value) && value.length > 0) {
      return i;
    }
  }

  if (textIndex !== null && textIndex !== undefined) {
    const candidateIndex = textIndex + 1;
    if (candidateIndex >= 0 && candidateIndex < values.length) {
      const candidate = values[candidateIndex];
      if (Array.isArray(candidate)) {
        return candidateIndex;
      }
    } else if (candidateIndex === values.length) {
      return candidateIndex;
    }
  }

  const emptyIndex = values.findIndex((value) => Array.isArray(value) && value.length === 0);
  return emptyIndex >= 0 ? emptyIndex : null;
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export function normalizeLoraEntry(entry: LoraManagerEntry): LoraManagerEntry {
  const strength = coerceNumber(entry.strength, 1);
  const clipStrength = coerceNumber(entry.clipStrength ?? strength, strength);
  const active = entry.active !== undefined ? Boolean(entry.active) : true;
  const expanded = entry.expanded !== undefined
    ? Boolean(entry.expanded)
    : Math.abs(clipStrength - strength) > EPSILON;

  return {
    ...entry,
    strength,
    clipStrength,
    active,
    expanded
  };
}

export function createDefaultLoraEntry(choices?: unknown[]): LoraManagerEntry {
  const firstChoice = Array.isArray(choices) && choices.length > 0
    ? String(choices[0])
    : '';
  const active = Boolean(firstChoice);
  return normalizeLoraEntry({
    name: firstChoice,
    strength: 1,
    clipStrength: 1,
    active,
    expanded: false
  });
}

export function mergeLoras(
  lorasText: string,
  lorasArr: LoraManagerEntry[]
): LoraManagerEntry[] {
  const parsedLoras: Record<string, { strength: number; clipStrength: number }> = {};
  let match: RegExpExecArray | null;
  LORA_PATTERN.lastIndex = 0;
  while ((match = LORA_PATTERN.exec(lorasText)) !== null) {
    const name = match[1];
    const modelStrength = Number(match[2]);
    const clipStrength = match[3] ? Number(match[3]) : modelStrength;
    parsedLoras[name] = { strength: modelStrength, clipStrength };
  }

  const result: LoraManagerEntry[] = [];
  const usedNames = new Set<string>();

  for (const lora of lorasArr) {
    if (!lora || !parsedLoras[lora.name]) continue;
    const parsed = parsedLoras[lora.name];
    result.push({
      ...lora,
      strength: lora.strength !== undefined ? lora.strength : parsed.strength,
      clipStrength: lora.clipStrength !== undefined ? lora.clipStrength : parsed.clipStrength,
      active: lora.active !== undefined ? lora.active : true,
      expanded: lora.expanded !== undefined ? lora.expanded : false
    });
    usedNames.add(lora.name);
  }

  for (const name of Object.keys(parsedLoras)) {
    if (usedNames.has(name)) continue;
    const parsed = parsedLoras[name];
    result.push({
      name,
      strength: parsed.strength,
      clipStrength: parsed.clipStrength,
      active: true
    });
  }

  return result;
}

function normalizeStrengthValue(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return (1).toFixed(2);
  }
  return numeric.toFixed(2);
}

function shouldIncludeClipStrength(
  lora: LoraManagerEntry | undefined,
  hadClipFromText: unknown
): boolean {
  const clip = lora?.clipStrength;
  const strength = lora?.strength;

  if (clip === undefined || clip === null) {
    return Boolean(hadClipFromText);
  }

  const clipValue = Number(clip);
  const strengthValue = Number(strength);

  if (!Number.isFinite(clipValue) || !Number.isFinite(strengthValue)) {
    return Boolean(hadClipFromText);
  }

  if (Math.abs(clipValue - strengthValue) > EPSILON) {
    return true;
  }

  return Boolean(lora?.expanded || hadClipFromText);
}

function cleanupLoraSyntax(text: string): string {
  if (!text) {
    return '';
  }

  let cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/,\s*,+/g, ',')
    .replace(/\s*,\s*/g, ',')
    .trim();

  if (cleaned === ',') {
    return '';
  }

  cleaned = cleaned.replace(/(^,)|(,$)/g, '');
  cleaned = cleaned.replace(/,\s*/g, ', ');

  return cleaned.trim();
}

export function applyLoraValuesToText(
  originalText: string,
  loras: LoraManagerEntry[]
): string {
  const baseText = typeof originalText === 'string' ? originalText : '';
  const loraArray = Array.isArray(loras) ? loras : [];
  const loraMap = new Map<string, LoraManagerEntry>();

  loraArray.forEach((lora) => {
    if (!lora || !lora.name) return;
    loraMap.set(lora.name, lora);
  });

  LORA_PATTERN.lastIndex = 0;
  const retainedNames = new Set<string>();

  const updated = baseText.replace(
    LORA_PATTERN,
    (match, name, strength, clipStrength) => {
      const lora = loraMap.get(name);
      if (!lora) {
        return '';
      }

      retainedNames.add(name);

      const formattedStrength = normalizeStrengthValue(
        lora.strength ?? strength
      );
      const formattedClip = normalizeStrengthValue(
        lora.clipStrength ?? lora.strength ?? clipStrength
      );

      const includeClip = shouldIncludeClipStrength(lora, clipStrength);

      if (includeClip) {
        return `<lora:${name}:${formattedStrength}:${formattedClip}>`;
      }

      return `<lora:${name}:${formattedStrength}>`;
    }
  );

  const cleaned = cleanupLoraSyntax(updated);

  if (loraMap.size === retainedNames.size) {
    return cleaned;
  }

  const missingEntries: string[] = [];
  loraMap.forEach((lora, name) => {
    if (retainedNames.has(name)) return;
    const formattedStrength = normalizeStrengthValue(lora.strength);
    const formattedClip = normalizeStrengthValue(
      lora.clipStrength ?? lora.strength
    );
    const includeClip = shouldIncludeClipStrength(lora, null);

    const syntax = includeClip
      ? `<lora:${name}:${formattedStrength}:${formattedClip}>`
      : `<lora:${name}:${formattedStrength}>`;

    missingEntries.push(syntax);
  });

  if (missingEntries.length === 0) {
    return cleaned;
  }

  const separator = cleaned ? ' ' : '';
  return `${cleaned}${separator}${missingEntries.join(' ')}`.trim();
}
