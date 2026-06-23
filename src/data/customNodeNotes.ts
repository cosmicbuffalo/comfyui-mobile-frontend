// Maintained, hand-curated notes about how specific custom nodes integrate with
// the mobile frontend. These surface on the matching list item in the Custom
// Nodes Manager search so users know what is and isn't supported on mobile
// before they install/rely on a node.
//
// This is the single source of truth — edit the entries below to keep the
// in-app notes accurate. Keep bullets short and user-facing.

export interface CustomNodeNote {
  /**
   * Lowercase identifiers matched (as substrings) against the node's title, id,
   * key and repository URL. Use the registry name and/or repo slug so the note
   * binds to the right package. The first matching entry wins.
   */
  match: string[];
  /** Optional one-line context shown above the bullets. */
  summary?: string;
  /** Features the mobile frontend supports for this node. */
  supported?: string[];
  /** Features the desktop extension has that the mobile frontend does not (yet). */
  unsupported?: string[];
}

export const CUSTOM_NODE_NOTES: CustomNodeNote[] = [
  {
    match: ['comfyui-autocomplete-plus', 'autocomplete-plus', 'newtextdoc1111/comfyui-autocomplete-plus'],
    summary: 'Tag autocomplete integrates with the mobile frontend (opt-in under Settings → Generation).',
    supported: [
      'Real-time tag, LoRA & embedding suggestions while typing prompts',
      'Alias matching, with each tag’s alias list shown per suggestion',
      'Suggestions ranked by post count',
      'Cursor-aware insertion with desktop-style formatting (underscores → spaces, escaped parentheses, default LoRA weights, wildcards preserved)',
      'Per-suggestion Danbooru wiki links',
    ],
    unsupported: [
      'Related Tags panel (co-occurrence suggestions)',
      'Auto-formatter that reflows the whole prompt on blur',
      'Alternate tag sources (e621) and user / extra CSVs',
      'Bulk tag insertion ("chants")',
    ],
  },
];

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * Find the maintained note for a custom node, matching its identity strings
 * (title, id, key, repository) against each entry's `match` substrings.
 */
export function getCustomNodeNote(
  identifiers: Array<string | number | undefined>,
): CustomNodeNote | undefined {
  const haystacks = identifiers.map(normalize).filter(Boolean);
  if (haystacks.length === 0) return undefined;
  return CUSTOM_NODE_NOTES.find((note) =>
    note.match.some((token) => {
      const needle = token.toLowerCase();
      return haystacks.some((hay) => hay.includes(needle));
    }),
  );
}
