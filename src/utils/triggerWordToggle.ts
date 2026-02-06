import type { WorkflowNode } from '@/api/types';

export interface TriggerWordEntry {
  text: string;
  active: boolean;
  strength?: number | null;
  highlighted?: boolean;
  [key: string]: unknown;
}

export interface TriggerWordEntryInput {
  text?: unknown;
  active?: unknown;
  strength?: unknown;
  highlighted?: unknown;
  [key: string]: unknown;
}

const TRIGGER_WORD_NODE_TYPES = new Set([
  'TriggerWord Toggle (LoraManager)'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function isTriggerWordToggleNodeType(nodeType: string): boolean {
  if (TRIGGER_WORD_NODE_TYPES.has(nodeType)) return true;
  const lowered = nodeType.toLowerCase();
  return lowered.includes('triggerword') && lowered.includes('(loramanager)');
}

function isTriggerWordEntryStrict(entry: unknown): entry is TriggerWordEntry {
  if (!isRecord(entry) || typeof entry.text !== 'string') return false;
  if ('active' in entry && typeof entry.active !== 'boolean') return false;
  return true;
}

function isTriggerWordEntryLoose(entry: unknown): entry is TriggerWordEntry {
  return isRecord(entry) && typeof entry.text === 'string';
}

export function isTriggerWordList(value: unknown, strict = true): value is TriggerWordEntry[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return value.every((entry) =>
    strict ? isTriggerWordEntryStrict(entry) : isTriggerWordEntryLoose(entry)
  );
}

export function extractTriggerWordList(value: unknown): TriggerWordEntry[] | null {
  if (isTriggerWordList(value, true)) return value;
  if (isRecord(value) && isTriggerWordList(value.__value__, true)) {
    return value.__value__ as TriggerWordEntry[];
  }
  return null;
}

export function extractTriggerWordListLoose(value: unknown): TriggerWordEntry[] | null {
  if (isTriggerWordList(value, false)) return value as TriggerWordEntry[];
  if (isRecord(value) && isTriggerWordList(value.__value__, false)) {
    return value.__value__ as TriggerWordEntry[];
  }
  return null;
}

export function findTriggerWordListIndex(node: WorkflowNode): number | null {
  if (!Array.isArray(node.widgets_values)) return null;
  const values = node.widgets_values;

  let looseCandidate: { index: number; score: number } | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (isTriggerWordList(value, true)) {
      return i;
    }
    if (isTriggerWordList(value, false)) {
      const score = Array.isArray(value) ? value.length : 0;
      if (!looseCandidate || score > looseCandidate.score) {
        looseCandidate = { index: i, score };
      }
    }
  }

  return looseCandidate ? looseCandidate.index : null;
}

export function findTriggerWordMessageIndex(
  node: WorkflowNode,
  listIndex?: number | null
): number | null {
  if (!Array.isArray(node.widgets_values)) return null;
  const values = node.widgets_values;
  const startIndex = listIndex !== null && listIndex !== undefined
    ? Math.min(listIndex + 1, values.length)
    : 0;

  for (let i = startIndex; i < values.length; i += 1) {
    if (typeof values[i] === 'string') {
      return i;
    }
  }

  for (let i = 0; i < startIndex; i += 1) {
    if (typeof values[i] === 'string') {
      return i;
    }
  }

  return null;
}

export function extractTriggerWordMessage(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.__value__ === 'string') {
    return value.__value__;
  }
  return null;
}

function coerceStrength(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeTriggerWordEntry(
  entry: TriggerWordEntryInput,
  options?: { defaultActive?: boolean; allowStrengthAdjustment?: boolean }
): TriggerWordEntry {
  const text = typeof entry.text === 'string' ? entry.text : '';
  const active = typeof entry.active === 'boolean'
    ? entry.active
    : (options?.defaultActive ?? true);
  const allowStrength = Boolean(options?.allowStrengthAdjustment);
  const strength = allowStrength ? coerceStrength(entry.strength) : null;
  const highlighted = typeof entry.highlighted === 'boolean' ? entry.highlighted : undefined;

  return {
    ...entry,
    text,
    active,
    strength,
    highlighted
  };
}

export function buildTriggerWordListFromMessage(
  message: string,
  options: {
    groupMode: boolean;
    defaultActive: boolean;
    allowStrengthAdjustment: boolean;
    existingList?: TriggerWordEntry[];
  }
): TriggerWordEntry[] {
  const existing = Array.isArray(options.existingList) ? options.existingList : [];
  const existingTagState: Record<string, Array<{ active: boolean; strength: number | null }>> = {};

  existing.forEach((tag) => {
    if (!tag || typeof tag.text !== 'string' || !tag.text) return;
    if (!existingTagState[tag.text]) {
      existingTagState[tag.text] = [];
    }
    existingTagState[tag.text].push({
      active: typeof tag.active === 'boolean' ? tag.active : options.defaultActive,
      strength: options.allowStrengthAdjustment ? coerceStrength(tag.strength) : null
    });
  });

  const consumeState = (text: string) => {
    const bucket = existingTagState[text];
    if (bucket && bucket.length > 0) {
      return bucket.shift() ?? null;
    }
    return null;
  };

  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed) return [];

  let rawTokens: string[] = [];
  if (options.groupMode) {
    if (/,{2,}/.test(trimmed)) {
      rawTokens = trimmed.split(/,{2,}/);
    } else {
      rawTokens = [trimmed];
    }
  } else {
    rawTokens = trimmed.split(',');
  }

  return rawTokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((text) => {
      const state = consumeState(text);
      return {
        text,
        active: state ? state.active : options.defaultActive,
        strength: options.allowStrengthAdjustment ? (state?.strength ?? null) : null
      };
    });
}
