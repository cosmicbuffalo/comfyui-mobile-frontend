/**
 * Upstream parity manifests.
 *
 * This frontend reimplements behaviour that lives in other people's custom-node
 * packs: their nodes are often pure client-side JavaScript, so the only way for
 * a second frontend to support them is to port the logic. That port is a copy of
 * someone else's moving target — when they change it, we silently diverge and
 * workflows quietly render or execute wrong.
 *
 * Each manifest records, in machine-checkable form, exactly what our
 * implementation assumes about a pack. `scripts/check-node-parity.mjs` clones
 * each pack fresh at its latest revision and re-verifies every assumption, so
 * drift shows up as a named failure ("we assume X, upstream no longer does")
 * rather than as a bug report months later.
 *
 * Adding a pack: list only assumptions our code actually depends on, and give
 * every one a `why` naming the file that would break. An assumption nobody
 * relies on is noise; a dependency nobody recorded is the thing this exists to
 * prevent.
 */

/**
 * @typedef {object} Assumption
 * @property {string}  id       Stable slug, referenced in failure output.
 * @property {string}  why      What breaks here if upstream changes it.
 * @property {string}  ours     The file in this repo that depends on it.
 * @property {string}  file     Path within the upstream repo.
 * @property {string}  [since]  Upstream version this behaviour first appeared in.
 *   Checking a copy older than this reports "not yet present" rather than drift,
 *   so `--local` against an older installed pack stays readable.
 * @property {RegExp[]} [contains]  Patterns that must all still be present.
 * @property {RegExp[]} [absent]    Patterns that must NOT appear.
 */

/**
 * @typedef {object} Manifest
 * @property {string} pack
 * @property {string} repo             Clone URL.
 * @property {string} verifiedVersion  Upstream version this port was written against.
 * @property {string} [versionFile]    File to read the current upstream version from.
 * @property {RegExp} [versionPattern] Capture group 1 is the version string.
 * @property {Assumption[]} assumptions
 */

/** @type {Manifest[]} */
export const MANIFESTS = [
  // ---------------------------------------------------------------------
  // cg-use-everywhere — "Anything Everywhere" broadcast nodes.
  // Ported in src/utils/useEverywhere.ts. The Python nodes are no-ops; every
  // behaviour we reproduce lives in the pack's js/ directory.
  // ---------------------------------------------------------------------
  {
    pack: 'cg-use-everywhere',
    repo: 'https://github.com/chrisgoringe/cg-use-everywhere',
    verifiedVersion: '7.8',
    versionFile: 'pyproject.toml',
    versionPattern: /^version\s*=\s*"([^"]+)"/m,
    assumptions: [
      {
        id: 'node-classes',
        why: 'isUseEverywhereNode() matches these class names. A new broadcast node class would be missed, so its inputs would render as unconnected and drop out of the prompt.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'use_everywhere.py',
        contains: [
          /node_id\s*=\s*"Anything Everywhere"/,
          /node_id\s*=\s*"Anything Everywhere3"/,
          /node_id\s*=\s*"Anything Everywhere\?"/,
          /node_id\s*=\s*"Prompts Everywhere"/,
          /node_id\s*=\s*"Seed Everywhere"/,
        ],
      },
      {
        id: 'nodes-are-noops',
        why: 'We drop Anything Everywhere nodes from the prompt entirely, which is only safe while they execute to nothing and declare no outputs.',
        ours: 'src/utils/buildPromptFromWorkflow.ts',
        file: 'use_everywhere.py',
        contains: [/class AnythingEverywhere\b[\s\S]*?outputs\s*=\s*\[\s*\][\s\S]*?return io\.NodeOutput\(\)/],
      },
      {
        id: 'is-uenode-predicate',
        why: 'Our class test mirrors is_UEnode: prefix match on "Anything Everywhere" plus the two named legacy types.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/use_everywhere_utilities.js',
        contains: [
          /export function is_UEnode\(node\)/,
          /startsWith\(["']Anything Everywhere["']\)/,
          /type\s*===?\s*["']Seed Everywhere["']/,
          /type\s*===?\s*["']Prompts Everywhere["']/,
        ],
      },
      {
        id: 'ue-convert-broadcasters',
        why: 'canBroadcast() also honours properties.ue_convert, which marks a real executing node that broadcasts its outputs. We must keep such nodes in the prompt.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/use_everywhere_utilities.js',
        contains: [/export function node_can_broadcast\(node\)[\s\S]{0,120}ue_convert/],
      },
      {
        id: 'analysis-shape',
        why: 'resolveUseEverywhereLinks() is a port of analyse_graph: broadcasters must be strictly live, sinks are unconnected connectable inputs, and the result is written to graph.extra.ue_links.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/use_everywhere_graph_analysis.js',
        contains: [
          /node_can_broadcast\(node\)\)\.filter\(\(node\)=>node_is_live\(node,\s*false\)\)/,
          /is_connected\(input,\s*treat_bypassed_as_live,\s*node\.graph\)/,
          /is_connectable\(node,\s*input\.name\)/,
          /graph\.extra\['ue_links'\]\s*=/,
          /connect_to_bypassed/,
        ],
      },
      {
        id: 'match-rules',
        why: 'broadcastMatches() reproduces UseEverywhere.matches: self-exclusion, restrict_to, title regex, exact type equality with the string_to_combo escape, then input regex.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/use_everywhere_classes.js',
        contains: [
          /matches\(node,\s*input\)\s*\{/,
          /if\s*\(this\.output\[0\]\s*==\s*node\.id\)\s*return false/,
          /if\s*\(this\.restrict_to\s*&&\s*!this\.restrict_to\.includes\(node\.id\)\)/,
          // Type equality is an exact `!=` on the raw strings, which is why our
          // typesEqual() is stricter than the app's usual token-overlap test.
          /if\s*\(this\.type\s*!=\s*input\.type\)/,
          /this\.type\s*==\s*["']STRING["'][\s\S]{0,80}input\.type\s*==\s*["']COMBO["']/,
          // The input label resolution moved into an `input_name` helper in 7.8;
          // both spellings mean label -> localized_name -> name.
          /input\.label\s*\|\|\s*input\.localized_name\s*\|\|\s*input\.name|input_name\(input\)/,
        ],
      },
      {
        id: 'send-to-any',
        why: 'Pack 7.8 added send_to_any, letting a broadcast of any type feed a wildcard "*" input. We implement it; if it were removed we would over-connect.',
        ours: 'src/utils/useEverywhere.ts',
        since: '7.8',
        file: 'js/use_everywhere_classes.js',
        contains: [/input\.type\s*==\s*["']\*["']\s*&&\s*this\.send_to_any/],
      },
      {
        id: 'priority-and-ambiguity',
        why: 'Highest priority wins and an exact tie is left unresolved. If upstream started breaking ties, inputs we leave empty would silently gain a source.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/use_everywhere_classes.js',
        contains: [
          /matches\.sort\(\(a,b\)\s*=>\s*b\.priority-a\.priority\)/,
          /if\s*\(matches\[0\]\.priority\s*==\s*matches\[1\]\.priority\)/,
          /_ambiguities\.push\(msg\)[\s\S]{0,80}return undefined/,
        ],
      },
      {
        id: 'default-priority',
        why: 'defaultPriority() copies these weights; wrong weights would resolve ambiguous graphs differently from desktop.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/ue_properties.js',
        contains: [
          /export function default_priority\(node\)/,
          /var p = 10/,
          /Seed Everywhere["']\s*\|\|\s*node\.type === ["']Prompts Everywhere["']\)\s*p \+= 10/,
          /p \+= 20/,
          /group_restricted > 0\)\s*p \+= 3/,
          /color_restricted > 0\)\s*p \+= 6/,
        ],
      },
      {
        id: 'connectable-opt-in',
        why: 'isConnectable() copies is_connectable: widget-backed inputs are opt-in via widget_ue_connectable, plain slots opt out via input_ue_unconnectable, and rejects_ue_links refuses everything.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/use_everywhere_settings.js',
        contains: [
          /export function is_connectable\(node, input_name\)/,
          /node\.properties\.rejects_ue_links/,
          /widget_ue_connectable\?\.\[input_name\]/,
          /input_ue_unconnectable\?\.\[input_name\]/,
        ],
      },
      {
        id: 'bypass-resolution',
        why: 'resolveThroughBypass() copies handle_bypass: prefer the same-index input when its type matches, else the first input of that type.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/use_everywhere_utilities.js',
        contains: [
          /function handle_bypass\(original_link, type, graph\)/,
          /parent\?\.inputs\[link\.origin_slot\]\?\.type == type/,
          /parent\.inputs\.find\(\(input\)=>input\.type==type\)\?\.link/,
        ],
      },
      {
        id: 'repeated-type-rules',
        why: 'makeRepeatedTypeRule() implements rules 0-3 for a controller broadcasting one type twice.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/use_everywhere_classes.js',
        contains: [
          /repeated_type_rule/,
          /if \(rule == 0\)/,
          /if \(rule == 1\)/,
          /if \(rule == 2\)/,
          /if \(rule == 3\)/,
        ],
      },
      {
        id: 'legacy-type-migration',
        why: 'Saved files still carry the pre-migration types while the desktop rewrites them on load, so we must handle both spellings. Seed Everywhere becoming a real PrimitiveInt is why isUseEverywhereNode and canBroadcast differ.',
        ours: 'src/utils/useEverywhere.ts',
        file: 'js/ue_properties.js',
        contains: [
          /function convert_node_types\(node\)/,
          /node\.type=="Anything Everywhere3"[\s\S]{0,200}node\.type = "Anything Everywhere"/,
          /node\.type=="Seed Everywhere"[\s\S]{0,240}ue_convert = true/,
        ],
      },
      {
        id: 'ue-links-persisted-shape',
        why: 'The saved graph.extra.ue_links map is our cross-check oracle in tests; its field names are asserted there.',
        ours: 'src/utils/__tests__/useEverywhere.test.ts',
        file: 'js/use_everywhere_graph_analysis.js',
        contains: [
          /"downstream":node\.id,\s*"downstream_slot":index/,
          /"upstream":ue\.output\[0\],\s*"upstream_slot":ue\.output\[1\]/,
          /"controller":ue\.controller\.id/,
        ],
      },
      {
        id: 'links-are-temporary',
        why: 'We resolve broadcasts at read time and never write links into the graph, because upstream only materialises them for the duration of graphToPrompt. Its cleanup leaking is what the validator garbage collector exists to undo.',
        ours: 'src/utils/workflowValidator.ts',
        file: 'js/use_everywhere_apply.js',
        contains: [/export function convert_to_links/, /restorer/, /removeLink/],
      },
    ],
  },

  // ---------------------------------------------------------------------
  // ComfyUI-KJNodes — SetNode/GetNode wireless relays.
  // Ported in src/utils/setGetNodes.ts + collapseSetGetNodes.ts.
  // ---------------------------------------------------------------------
  {
    pack: 'comfyui-kjnodes',
    repo: 'https://github.com/kijai/ComfyUI-KJNodes',
    verifiedVersion: '1.2.6',
    versionFile: 'pyproject.toml',
    versionPattern: /^version\s*=\s*"([^"]+)"/m,
    assumptions: [
      {
        id: 'relay-node-names',
        why: 'isSetNode/isGetNode match the literal type names "SetNode" and "GetNode"; a rename would strand every relay-based workflow.',
        ours: 'src/utils/setGetNodes.ts',
        file: 'web/js/setgetnodes.js',
        contains: [/["']SetNode["']/, /["']GetNode["']/],
      },
      {
        id: 'relay-name-is-first-widget',
        why: 'getSetGetName() reads widgets_values[0] as the shared relay name, and the pairing is by that name within a scope.',
        ours: 'src/utils/setGetNodes.ts',
        file: 'web/js/setgetnodes.js',
        contains: [/widgets\[0\]/, /Constant|previousName/],
      },
    ],
  },

  // ---------------------------------------------------------------------
  // rgthree-comfy — Fast Groups Bypasser and Image Comparer.
  // The bypasser's toggles are computed client-side from group titles/colours,
  // and the comparer stores its image pairs in widgets_values.
  // ---------------------------------------------------------------------
  {
    pack: 'rgthree-comfy',
    repo: 'https://github.com/rgthree/rgthree-comfy',
    verifiedVersion: '1.0.2606200020',
    versionFile: 'pyproject.toml',
    versionPattern: /^version\s*=\s*"([^"]+)"/m,
    assumptions: [
      {
        id: 'fast-groups-properties',
        why: 'The mobile Fast Groups Bypasser card reads these properties to decide which groups it controls and how they sort. They live on the shared base class, not on the bypasser subclass.',
        ours: 'src/components/WorkflowPanel/NodeCard.tsx',
        file: 'src_web/comfyui/fast_groups_muter.ts',
        contains: [
          /PROPERTY_MATCH_COLORS\s*=\s*["']matchColors["']/,
          /PROPERTY_MATCH_TITLE\s*=\s*["']matchTitle["']/,
          /PROPERTY_RESTRICTION\s*=\s*["']toggleRestriction["']/,
          /PROPERTY_SORT\s*=\s*["']sort["']/,
          /PROPERTY_SORT_CUSTOM_ALPHA\s*=\s*["']customSortAlphabet["']/,
        ],
      },
      {
        id: 'fast-groups-bypass-mode',
        why: 'Toggling a group off from mobile sets its nodes to mode 4; the bypasser must still mean "bypass" rather than "mute" (mode 2).',
        ours: 'src/components/WorkflowPanel/NodeCard.tsx',
        file: 'src_web/comfyui/fast_groups_bypasser.ts',
        contains: [/modeOff\s*=\s*4/],
      },
      {
        id: 'image-comparer-widget-shape',
        why: 'The comparer preview reads widgets_values[0] as a list of {name, selected, url} entries.',
        ours: 'src/utils/nodeFrontendPreviews.ts',
        file: 'src_web/comfyui/image_comparer.ts',
        contains: [/selected/, /\burl\b/],
      },
    ],
  },
];

/** Look up one manifest by pack name. */
export function getManifest(pack) {
  return MANIFESTS.find((m) => m.pack === pack) ?? null;
}
