// Recognizing the "insert a wildcard" dropdown that Impact Pack and friends
// ship, and working out where a picked wildcard should be written.
//
// Desktop's Impact Pack extension hardcodes a widget index per node class. We
// match on the placeholder option instead, which is the one thing every such
// node has in common — so Inspire Pack and Easy-Use nodes work without being
// enumerated, and a node that renames its widgets doesn't silently break.

/** The sole declared option on an unpopulated wildcard dropdown. */
export const WILDCARD_SELECT_SENTINEL = 'Select the Wildcard to add to the text';

type WidgetOptions = Record<string, unknown> | unknown[] | undefined;

interface WildcardWidgetLike {
  type: string;
  options?: WidgetOptions;
}

/** Combo options arrive either as a bare array or wrapped in `{ options }`. */
export function comboOptionList(options: WidgetOptions): unknown[] {
  if (Array.isArray(options)) return options;
  if (options && Array.isArray((options as Record<string, unknown>).options)) {
    return (options as { options: unknown[] }).options;
  }
  return [];
}

/** Whether this descriptor is a wildcard picker awaiting its run-time list. */
export function isWildcardSelectWidget(options: WidgetOptions): boolean {
  return comboOptionList(options).includes(WILDCARD_SELECT_SENTINEL);
}

/**
 * Options to actually render: the placeholder stays first so the widget's
 * saved value (which is the placeholder — see below) remains a valid choice
 * and doesn't render as a missing value.
 */
export function buildWildcardOptions(wildcards: string[]): string[] {
  return [WILDCARD_SELECT_SENTINEL, ...wildcards];
}

/**
 * Whether a picked wildcard should be appended to this widget. Callers take the
 * FIRST match on the node, which matches desktop: it writes to widget 0 on
 * every node it handles, and on all of them the leading widget is the prompt
 * box, since any model/clip inputs are links rather than widgets.
 *
 * Nodes with more than one prompt box (Inspire's MakeBasicPipe has a positive
 * and a negative, chosen by its own "Add selection to" widget) get the first,
 * which is the positive one.
 *
 * A predicate over one widget rather than a search over the list, so callers
 * can pass it straight to `.find` — handing the array to an imported function
 * defeats the React Compiler's memoization analysis.
 */
export function isWildcardTargetWidget(widget: WildcardWidgetLike): boolean {
  return widget.type.toUpperCase() === 'STRING'
    && !Array.isArray(widget.options)
    && (widget.options as Record<string, unknown> | undefined)?.multiline === true;
}

/** Append a wildcard to prompt text the way desktop does: comma-separated. */
export function appendWildcard(current: unknown, wildcard: string): string {
  const text = typeof current === 'string' ? current : '';
  if (!text) return wildcard;
  return `${text}, ${wildcard}`;
}

// Impact Pack's JS gives the wildcard nodes' two prompt boxes placeholders and
// disables the populated one. We reproduce both, verbatim, so the node reads
// the same on either frontend.
export const WILDCARD_TEXT_PLACEHOLDER = 'Wildcard Prompt (User input)';
export const POPULATED_TEXT_PLACEHOLDER = 'Populated Prompt (Will be generated automatically)';

interface PromptWidgetLike {
  name: string;
  type: string;
  value?: unknown;
  options?: WidgetOptions;
  disabled?: boolean;
}

/**
 * `populated_text` is server-owned while mode is `populate` — the wildcards are
 * expanded at queue time and fed back, so anything typed there is overwritten.
 * Desktop disables the box for exactly that mode and leaves it editable under
 * `fixed`/`reproduce`, where the stored text is what actually runs.
 *
 * Detected by widget shape (a `wildcard_text`/`populated_text` pair) rather
 * than a node-type list: that covers Impact's two nodes plus Inspire Pack's
 * WildcardEncode, which is built the same way.
 */
export function decorateWildcardPromptWidgets<T extends PromptWidgetLike>(
  widgets: T[],
  // `mode` is a combo, so it arrives in the node's input-widget list rather
  // than alongside the two text boxes.
  inputWidgets: PromptWidgetLike[] = [],
): Array<T & { disabled?: boolean }> {
  const hasPair = widgets.some((widget) => widget.name === 'wildcard_text')
    && widgets.some((widget) => widget.name === 'populated_text');
  if (!hasPair) return widgets;

  const mode = [...widgets, ...inputWidgets].find((widget) => widget.name === 'mode')?.value;
  // Default to server-owned: an absent mode means the node is mid-load, and
  // `populate` is the node's own default.
  const populatedIsServerOwned = mode === undefined || mode === 'populate';

  return widgets.map((widget) => {
    if (widget.name === 'wildcard_text') {
      return { ...widget, options: withPlaceholder(widget.options, WILDCARD_TEXT_PLACEHOLDER) };
    }
    if (widget.name === 'populated_text') {
      return {
        ...widget,
        options: withPlaceholder(widget.options, POPULATED_TEXT_PLACEHOLDER),
        disabled: populatedIsServerOwned,
      };
    }
    return widget;
  });
}

function withPlaceholder(options: WidgetOptions, placeholder: string): WidgetOptions {
  // An array here would be a combo's option list, which these never are.
  if (Array.isArray(options)) return options;
  return { ...(options ?? {}), placeholder };
}
