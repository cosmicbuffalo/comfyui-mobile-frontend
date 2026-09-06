/**
 * Instance-number templating for shared subgraph ("subgraph type") labels.
 *
 * A definition's labels — boundary slot labels, proxy-widget labels, the
 * definition name — are shared by every placeholder instance. A token lets one
 * label render per-instance: "Prompt {n}" shows as "Prompt 1" on instance 1,
 * "Prompt 2" on instance 2. Instance numbers live on each placeholder node
 * (properties.mobileInstanceNumber, see canonicalWorkflowOps) and are stable —
 * never renumbered, gaps allowed.
 *
 * Two tokens: `{n}` is the instance number and `{n+1}` is the one after it, for
 * a label that counts from something other than one. Whitespace inside the
 * braces is ignored, so `{ n + 1 }` is the same token — nobody should have to
 * remember which spacing the app wanted. Anything else between braces is left
 * as written, so a name that happens to contain them is not mangled by this.
 */

/** Braces and their contents, with one adjacent space on either side. */
const TEMPLATE = /( ?)\{([^{}]*)\}( ?)/g;

export function interpolateInstanceLabel(
  template: string,
  instanceNumber: number | undefined,
): string {
  if (!template.includes('{')) return template;

  const rendered = template.replace(
    TEMPLATE,
    (match: string, before: string, body: string, after: string) => {
      const token = body.replace(/\s+/g, '');
      // Braces around something else: they were meant literally, so they stay
      // literally, spacing and all.
      if (token !== 'n' && token !== 'n+1') return match;
      // No instance number to render. Dropping the token takes one adjacent
      // space with it, so "Prompt {n}" degrades to "Prompt" rather than
      // "Prompt " — unless it was separating two words, which still need one.
      if (instanceNumber == null) return before && after ? ' ' : '';
      const value = token === 'n' ? instanceNumber : instanceNumber + 1;
      return `${before}${value}${after}`;
    },
  );
  return rendered.trim();
}
