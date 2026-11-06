import type { WorkflowNode } from '@/api/types';

// Text-display nodes that keep the last text they showed in widgets_values and
// put it back on load (pysssss showText.js onConfigure, rgthree's Display Any
// output widget, easy-use's showAnything), so a card shows it before any run.
const SAVED_TEXT_NODES = new Set(['ShowText|pysssss', 'easy showAnything', 'Display Any (rgthree)']);

export function savedTextPreview(node: WorkflowNode): string | null {
  if (!SAVED_TEXT_NODES.has(node.type) || !Array.isArray(node.widgets_values)) return null;
  const texts = node.widgets_values.flat().filter((value): value is string => typeof value === 'string');
  // populate drops an empty first entry (the converted-widget slot).
  if (texts.length > 1 && !texts[0]) texts.shift();
  const text = texts.join('\n\n');
  return text ? text : null;
}
