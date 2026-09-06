import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeTypes, Workflow } from "@/api/types";
import {
  createFilePrefixAliases,
  createInputAliases,
  resolveFilePrefixAliases,
  resolveInputAliases,
} from "@/api/client";
import {
  hasRecognizedFilePrefixAliasShape,
  hasRecognizedInputAliasShape,
  hasRecognizedPathAliasShape,
  obfuscateQueuedInputPaths,
  obfuscateWorkflowInputPaths,
  restoreWorkflowFilePrefixes,
  restoreWorkflowInputPaths,
  restoreWorkflowPathAliases,
} from "@/utils/inputPathAliases";

vi.mock("@/api/client", () => ({
  createInputAliases: vi.fn(),
  createFilePrefixAliases: vi.fn(),
  resolveInputAliases: vi.fn(),
  resolveFilePrefixAliases: vi.fn(),
}));

const nodeTypes: NodeTypes = {
  LoadImage: {
    input: { required: { image: [["private/photo.png"]] } },
    input_order: { required: ["image"] },
    output: ["IMAGE", "MASK"],
    name: "LoadImage",
    display_name: "Load Image",
    description: "",
    python_module: "nodes",
    category: "image",
  },
  SaveImage: {
    input: { required: { images: ["IMAGE"], filename_prefix: ["STRING", {}] } },
    input_order: { required: ["images", "filename_prefix"] },
    output: [],
    name: "SaveImage",
    display_name: "Save Image",
    description: "",
    python_module: "nodes",
    category: "image",
  },
};

const workflow: Workflow = {
  last_node_id: 2,
  last_link_id: 0,
  nodes: [{
    id: 1,
    type: "LoadImage",
    pos: [0, 0],
    size: [100, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: ["private/photo.png", "image"],
  }, {
    id: 2,
    type: "SaveImage",
    pos: [0, 0],
    size: [100, 100],
    flags: {},
    order: 1,
    mode: 0,
    inputs: [{ name: "images", type: "IMAGE", link: null }],
    outputs: [],
    properties: {},
    widgets_values: ["private/client/portrait"],
  }],
  links: [],
  groups: [],
  config: {},
  version: 0.4,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createInputAliases).mockResolvedValue({
    "private/photo.png": ".mi-deadbeef.png",
  });
  vi.mocked(createFilePrefixAliases).mockResolvedValue({
    "private/client/portrait": "mp-deadbeef",
  });
  vi.mocked(resolveInputAliases).mockResolvedValue({
    ".mi-deadbeef.png": "private/photo.png",
  });
  vi.mocked(resolveFilePrefixAliases).mockResolvedValue({
    "mp-deadbeef": "private/client/portrait",
  });
});


/**
 * A mask-editor save writes ComfyUI's annotated-filepath form into the widget:
 * `clipspace/<file>.png [input]`. The bracketed part names the base directory
 * and is not on disk, so handing the whole string to the alias endpoint asks
 * for a file that cannot exist -- it raises "Input file not found" and takes
 * the entire queue submission down.
 */
describe("annotated filepaths (mask editor output)", () => {
  const MASKED = "clipspace/clipspace-painted-masked-1787873188151.png";
  const ANNOTATED = `${MASKED} [input]`;

  function maskedWorkflow(value: string): Workflow {
    return {
      ...workflow,
      nodes: [{ ...workflow.nodes[0], widgets_values: [value, "image"] }],
    };
  }

  function maskedPrompt(value: string) {
    return { "1": { class_type: "LoadImage", inputs: { image: value } } };
  }

  beforeEach(() => {
    vi.mocked(createInputAliases).mockResolvedValue({ [MASKED]: ".mi-cafe.png" });
    vi.mocked(resolveInputAliases).mockResolvedValue({ ".mi-cafe.png": MASKED });
  });

  it("asks the server to alias the path WITHOUT the annotation", async () => {
    await obfuscateQueuedInputPaths(maskedPrompt(ANNOTATED), maskedWorkflow(ANNOTATED), nodeTypes);
    // The bug: passing ANNOTATED here made the backend raise.
    expect(vi.mocked(createInputAliases).mock.calls[0][0]).toEqual([MASKED]);
  });

  it("re-attaches the annotation to the aliased value", async () => {
    const result = await obfuscateQueuedInputPaths(
      maskedPrompt(ANNOTATED), maskedWorkflow(ANNOTATED), nodeTypes,
    );
    // Keeping the suffix means the value has the same shape whether or not
    // obfuscation is enabled, and still resolves against input/.
    expect((result.prompt["1"] as { inputs: { image: string } }).inputs.image)
      .toBe(".mi-cafe.png [input]");
    expect(result.workflow.nodes[0].widgets_values).toEqual([".mi-cafe.png [input]", "image"]);
  });

  it("round-trips back to the annotated path on restore", async () => {
    const obfuscated = await obfuscateQueuedInputPaths(
      maskedPrompt(ANNOTATED), maskedWorkflow(ANNOTATED), nodeTypes,
    );
    const restored = await restoreWorkflowInputPaths(obfuscated.workflow, nodeTypes);
    expect(restored.nodes[0].widgets_values).toEqual([ANNOTATED, "image"]);
  });

  it("recognises an annotated alias as aliased", () => {
    const wf = maskedWorkflow(".mi-cafe.png [input]");
    expect(hasRecognizedInputAliasShape(wf, nodeTypes)).toBe(true);
  });

  it("leaves an [output]-annotated value alone", async () => {
    // Output-resident files are not managed by this mechanism; aliasing them
    // against input/ is what the LoadImageOutput guard already avoids.
    const value = "run_00012_.png [output]";
    const result = await obfuscateQueuedInputPaths(
      maskedPrompt(value), maskedWorkflow(value), nodeTypes,
    );
    expect(vi.mocked(createInputAliases)).not.toHaveBeenCalled();
    expect((result.prompt["1"] as { inputs: { image: string } }).inputs.image).toBe(value);
  });

  it("still aliases a plain unannotated path", async () => {
    vi.mocked(createInputAliases).mockResolvedValue({ "private/photo.png": ".mi-deadbeef.png" });
    const result = await obfuscateQueuedInputPaths(
      maskedPrompt("private/photo.png"), workflow, nodeTypes,
    );
    expect((result.prompt["1"] as { inputs: { image: string } }).inputs.image)
      .toBe(".mi-deadbeef.png");
  });
});

describe("input path aliases", () => {
  it("obfuscates workflow Load Image widget paths without mutating the source", async () => {
    const result = await obfuscateWorkflowInputPaths(workflow, nodeTypes);
    expect((result.nodes[0].widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
    expect((workflow.nodes[0].widgets_values as unknown[])[0]).toBe("private/photo.png");
    expect((result.nodes[1].widgets_values as unknown[])[0]).toBe("mp-deadbeef");
    expect((workflow.nodes[1].widgets_values as unknown[])[0]).toBe("private/client/portrait");
  });

  it("obfuscates both executable prompt and embedded workflow paths", async () => {
    const prompt = {
      "1": { class_type: "LoadImage", inputs: { image: "private/photo.png" } },
      "2": { class_type: "SaveImage", inputs: { filename_prefix: "private/client/portrait" } },
    };
    const result = await obfuscateQueuedInputPaths(prompt, workflow, nodeTypes);
    expect((result.prompt["1"] as { inputs: { image: string } }).inputs.image)
      .toBe(".mi-deadbeef.png");
    expect((result.workflow.nodes[0].widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
    expect((result.workflow.nodes[1].widgets_values as unknown[])[0]).toBe("mp-deadbeef");
    expect(prompt).toEqual({
      "1": { class_type: "LoadImage", inputs: { image: "private/photo.png" } },
      "2": { class_type: "SaveImage", inputs: { filename_prefix: "private/client/portrait" } },
    });
    expect((result.prompt["2"] as { inputs: { filename_prefix: string } }).inputs.filename_prefix)
      .toBe("private/client/portrait");
  });

  it("skips bypassed Load Image nodes so a missing input file can't block the queue", async () => {
    const bypassedWorkflow: Workflow = {
      ...workflow,
      nodes: [
        { ...workflow.nodes[0], mode: 4, widgets_values: ["missing/ghost.png", "image"] },
        workflow.nodes[1],
      ],
    };
    const prompt = {
      // The bypassed node is excluded from the executable prompt by the caller.
      "2": { class_type: "SaveImage", inputs: { filename_prefix: "private/client/portrait" } },
    };
    const result = await obfuscateQueuedInputPaths(prompt, bypassedWorkflow, nodeTypes);

    // The missing path must never reach the alias endpoint (it would throw
    // "Input file not found"). The bypassed node's value is left untouched.
    expect(createInputAliases).not.toHaveBeenCalledWith(
      expect.arrayContaining(["missing/ghost.png"]),
    );
    expect((result.workflow.nodes[0].widgets_values as unknown[])[0]).toBe("missing/ghost.png");
  });

  it("skips LoadImageOutput nodes whose files live in the output folder", async () => {
    // LoadImageOutput reads from output/, so its value must never be aliased
    // against input/ (which would raise "Input file not found" and block queue).
    const outputWorkflow: Workflow = {
      ...workflow,
      nodes: [
        { ...workflow.nodes[0], type: "LoadImageOutput", widgets_values: ["render.png [output]", "image"] },
        workflow.nodes[1],
      ],
    };
    const prompt = {
      "1": { class_type: "LoadImageOutput", inputs: { image: "render.png [output]" } },
      "2": { class_type: "SaveImage", inputs: { filename_prefix: "private/client/portrait" } },
    };
    const result = await obfuscateQueuedInputPaths(prompt, outputWorkflow, nodeTypes);

    expect(createInputAliases).not.toHaveBeenCalledWith(
      expect.arrayContaining(["render.png [output]"]),
    );
    expect((result.prompt["1"] as { inputs: { image: string } }).inputs.image)
      .toBe("render.png [output]");
    expect((result.workflow.nodes[0].widgets_values as unknown[])[0]).toBe("render.png [output]");
  });

  it("leaves loaded alias values directly usable", async () => {
    const loadedAliasWorkflow: Workflow = {
      ...workflow,
      nodes: [{
        ...workflow.nodes[0],
        widgets_values: [".mi-deadbeef.png", "image"],
      }],
    };
    const result = await obfuscateWorkflowInputPaths(loadedAliasWorkflow, nodeTypes);
    expect(result).toBe(loadedAliasWorkflow);
    expect(createInputAliases).not.toHaveBeenCalled();
  });

  it("restores recognized input aliases without mutating the loaded workflow", async () => {
    const aliased: Workflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === 1
        ? { ...node, widgets_values: [".mi-deadbeef.png", "image"] }
        : node),
    };

    expect(hasRecognizedInputAliasShape(aliased, nodeTypes)).toBe(true);
    const restored = await restoreWorkflowInputPaths(aliased, nodeTypes);

    expect((restored.nodes[0].widgets_values as unknown[])[0]).toBe("private/photo.png");
    expect((aliased.nodes[0].widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
  });

  it("restores record-shaped input widgets inside subgraphs", async () => {
    const aliasedNode = {
      ...workflow.nodes[0],
      widgets_values: { image: ".mi-deadbeef.png", upload: "image" },
    };
    const nested: Workflow = {
      ...workflow,
      nodes: [workflow.nodes[1]],
      definitions: {
        subgraphs: [{ id: "image-loader", nodes: [aliasedNode], links: [] }],
      },
    };

    const restored = await restoreWorkflowInputPaths(nested, nodeTypes);
    const values = restored.definitions?.subgraphs?.[0].nodes[0].widgets_values as Record<string, unknown>;

    expect(values.image).toBe("private/photo.png");
  });

  it("keeps unknown or stale input aliases usable", async () => {
    vi.mocked(resolveInputAliases).mockResolvedValueOnce({});
    const aliased: Workflow = {
      ...workflow,
      nodes: [{ ...workflow.nodes[0], widgets_values: [".mi-deadbeef.png", "image"] }],
    };

    const restored = await restoreWorkflowInputPaths(aliased, nodeTypes);

    expect(restored).toBe(aliased);
    expect((restored.nodes[0].widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
  });

  it("restores recognized filename prefix aliases for locally loaded workflows", async () => {
    const aliased: Workflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === 2
        ? { ...node, widgets_values: ["mp-deadbeef"] }
        : node),
    };
    expect(hasRecognizedFilePrefixAliasShape(aliased, nodeTypes)).toBe(true);
    const restored = await restoreWorkflowFilePrefixes(aliased, nodeTypes);
    expect((restored.nodes[1].widgets_values as unknown[])[0]).toBe("private/client/portrait");
  });

  it("restores input and filename-prefix aliases in one load preflight", async () => {
    const aliased: Workflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === 1
        ? { ...node, widgets_values: [".mi-deadbeef.png", "image"] }
        : { ...node, widgets_values: ["mp-deadbeef"] }),
    };

    expect(hasRecognizedPathAliasShape(aliased, nodeTypes)).toBe(true);
    const restored = await restoreWorkflowPathAliases(aliased, nodeTypes);

    expect((restored.nodes[0].widgets_values as unknown[])[0]).toBe("private/photo.png");
    expect((restored.nodes[1].widgets_values as unknown[])[0]).toBe("private/client/portrait");
  });
});

/**
 * Promoting a LoadImage's `image` widget to the subgraph boundary moves the
 * live value onto the PLACEHOLDER; the inner node keeps a copy that stops being
 * updated. Every walk here recurses into the definition's nodes but gated on
 * `isLoadImageType(node.type)`, and a placeholder's type is the definition id --
 * so the stale inner copy was aliased and the real value was skipped. With
 * obfuscation on, an alias left on a placeholder was never resolved back, and
 * mobile_object_info strips alias entries from the offered options: the card
 * showed an unofferable `.mi-<hash>` while the run worked off the hard link.
 */
describe("a LoadImage widget promoted to a subgraph boundary", () => {
  const SUBGRAPH_ID = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";

  /**
   * @param boundaryLabel a display label on the boundary slot, as a rename or a
   *   `{n}` template produces. The canonical widget name stays `image`.
   * @param liveValue what the placeholder holds for the promoted widget.
   */
  function makePromotedWorkflow(liveValue: string, boundaryLabel?: string): Workflow {
    return {
      last_node_id: 7,
      last_link_id: 1,
      nodes: [{
        id: 7,
        type: SUBGRAPH_ID,
        pos: [0, 0], size: [100, 100], flags: {}, order: 0, mode: 0,
        inputs: [{
          name: "image",
          type: "COMBO",
          link: null,
          widget: { name: "image" },
          ...(boundaryLabel ? { label: boundaryLabel } : {}),
        }],
        outputs: [],
        properties: {},
        // The live value for the promoted widget lives HERE.
        widgets_values: [liveValue],
      }],
      links: [],
      groups: [],
      config: {},
      version: 0.4,
      definitions: {
        subgraphs: [{
          id: SUBGRAPH_ID,
          name: "Loader",
          nodes: [{
            id: 3,
            type: "LoadImage",
            pos: [0, 0], size: [100, 100], flags: {}, order: 0, mode: 0,
            inputs: [{ name: "image", type: "COMBO", link: 1, widget: { name: "image" } }],
            outputs: [],
            properties: {},
            // Stale: promotion left this behind and it is no longer updated.
            widgets_values: ["private/OLD-stale.png", "image"],
          }],
          links: [
            { id: 1, origin_id: -10, origin_slot: 0, target_id: 3, target_slot: 0, type: "COMBO" },
          ],
          inputs: [{
            name: "image",
            type: "COMBO",
            linkIds: [1],
            ...(boundaryLabel ? { label: boundaryLabel } : {}),
          }],
          outputs: [],
        }],
      },
    } as unknown as Workflow;
  }

  const placeholderValue = (wf: Workflow) =>
    (wf.nodes[0].widgets_values as unknown[])[0];

  it("aliases the value on the placeholder, not just the stale inner copy", async () => {
    const result = await obfuscateWorkflowInputPaths(
      makePromotedWorkflow("private/photo.png"), nodeTypes,
    );

    expect(createInputAliases).toHaveBeenCalledWith(
      expect.arrayContaining(["private/photo.png"]),
    );
    expect(placeholderValue(result)).toBe(".mi-deadbeef.png");
  });

  it("resolves an alias sitting on the placeholder back to its real path", async () => {
    const aliased = makePromotedWorkflow(".mi-deadbeef.png");

    expect(hasRecognizedInputAliasShape(aliased, nodeTypes)).toBe(true);
    const restored = await restoreWorkflowInputPaths(aliased, nodeTypes);

    expect(placeholderValue(restored)).toBe("private/photo.png");
  });

  it("keeps working when the boundary slot has been relabelled", async () => {
    // The promoted def's `name` is the display label, so matching on it took a
    // renamed slot back out of scope. The canonical name is what decides.
    const result = await obfuscateWorkflowInputPaths(
      makePromotedWorkflow("private/photo.png", "Source image"), nodeTypes,
    );

    expect(placeholderValue(result)).toBe(".mi-deadbeef.png");
  });

  it("round-trips an annotated subfolder pick through the placeholder", async () => {
    const annotated = "private/photo.png [input]";
    const result = await obfuscateWorkflowInputPaths(
      makePromotedWorkflow(annotated), nodeTypes,
    );
    expect(placeholderValue(result)).toBe(".mi-deadbeef.png [input]");

    const restored = await restoreWorkflowInputPaths(result, nodeTypes);
    expect(placeholderValue(restored)).toBe(annotated);
  });

  it("leaves a bypassed placeholder alone", async () => {
    const bypassed = makePromotedWorkflow("private/photo.png");
    bypassed.nodes[0].mode = 4;

    const result = await obfuscateWorkflowInputPaths(bypassed, nodeTypes);

    expect(placeholderValue(result)).toBe("private/photo.png");
  });

  /**
   * "The placeholder wins" holds only where it actually HAS a value at that
   * index. Stock's _applyPromotedWidgetValues guards on `value !== undefined`,
   * so an index past the end of `widgets_values` is skipped and the inner
   * node's own value is the one that runs -- which is why instanceWidgetValues
   * truncates a trailing empty instead of padding it with null. Absent is not
   * empty, and the inner copy is then live rather than stale.
   */
  it("falls through to the inner node when the placeholder holds no value", async () => {
    const wf = makePromotedWorkflow("unused");
    wf.nodes[0].widgets_values = [];
    const inner = wf.definitions!.subgraphs![0].nodes[0];
    inner.widgets_values = ["private/photo.png", "image"];

    const result = await obfuscateWorkflowInputPaths(wf, nodeTypes);

    expect(createInputAliases).toHaveBeenCalledWith(
      expect.arrayContaining(["private/photo.png"]),
    );
    const restoredInner = result.definitions!.subgraphs![0].nodes[0];
    expect((restoredInner.widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
    expect((result.nodes[0].widgets_values as unknown[]).length).toBe(0);
  });

  /**
   * A widget can be promoted as an INPUT rather than as a widget: the
   * placeholder draws a plain socket, the value stays on the inner node and
   * every instance of the type shares it. The two forms are told apart by
   * whether the inner input slot carries `widget` -- with no widget there is no
   * per-instance value, so the placeholder has nothing to offer and the inner
   * node is authoritative.
   */
  it("leaves a socket-promoted input to the inner node", async () => {
    const wf = makePromotedWorkflow("private/DO-NOT-TOUCH.png");
    // Not widget-backed at either end: a plain socket promotion.
    delete (wf.nodes[0].inputs[0] as { widget?: unknown }).widget;
    const inner = wf.definitions!.subgraphs![0].nodes[0];
    delete (inner.inputs![0] as { widget?: unknown }).widget;
    inner.widgets_values = ["private/photo.png", "image"];

    const result = await obfuscateWorkflowInputPaths(wf, nodeTypes);

    // The placeholder's stray value is not a promoted widget value; untouched.
    expect(placeholderValue(result)).toBe("private/DO-NOT-TOUCH.png");
    const resultInner = result.definitions!.subgraphs![0].nodes[0];
    expect((resultInner.widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
  });

  /**
   * The stale inner copy is not just skipped for REPLACEMENT -- it must stay
   * out of the alias REQUEST too. Its path can name a file deleted since the
   * placeholder was repointed, and the alias endpoint raises "Input file not
   * found" for missing files, which takes the whole queue submission down over
   * a value nothing executes.
   */
  it("leaves the stale inner copy out of the alias request", async () => {
    await obfuscateWorkflowInputPaths(
      makePromotedWorkflow("private/photo.png"), nodeTypes,
    );

    expect(createInputAliases).toHaveBeenCalledWith(["private/photo.png"]);
  });

  /**
   * Not collecting the stale path is only half the job: with no alias minted
   * for it, an untouched replace walk would ship the literal pre-repoint
   * filename inside `definitions.subgraphs[*].nodes` -- the exact leak
   * "obfuscate shared input paths" exists to prevent. The dead slot is
   * overwritten with an instance's own (aliased) value instead: no live
   * instance reads it, and that value ships on the placeholder regardless.
   */
  it("overwrites the stale inner copy instead of shipping its filename", async () => {
    const result = await obfuscateWorkflowInputPaths(
      makePromotedWorkflow("private/photo.png"), nodeTypes,
    );

    const inner = result.definitions!.subgraphs![0].nodes[0];
    expect((inner.widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
    expect(JSON.stringify(result)).not.toContain("OLD-stale");
  });

  it("still aliases the inner value while any instance falls through to it", async () => {
    const wf = makePromotedWorkflow("private/photo.png");
    // A second instance with no stored value: it runs off the inner copy.
    wf.nodes.push({
      ...wf.nodes[0],
      id: 8,
      widgets_values: [],
    });
    const inner = wf.definitions!.subgraphs![0].nodes[0];
    inner.widgets_values = ["private/fallthrough.png", "image"];

    await obfuscateWorkflowInputPaths(wf, nodeTypes);

    expect(createInputAliases).toHaveBeenCalledWith(
      expect.arrayContaining(["private/photo.png", "private/fallthrough.png"]),
    );
  });

  it("skips the inner copy when every instance of the type is bypassed", async () => {
    const wf = makePromotedWorkflow("private/photo.png");
    wf.nodes[0].mode = 4;

    const result = await obfuscateWorkflowInputPaths(wf, nodeTypes);

    // The bypassed placeholder contributes nothing, and the inner copy never
    // executes, so no alias request should go out at all.
    expect(createInputAliases).not.toHaveBeenCalled();
    // The dead inner slot still must not ship the old filename: it takes the
    // bypassed placeholder's value (already shipping there, unaliased).
    const inner = result.definitions!.subgraphs![0].nodes[0];
    expect((inner.widgets_values as unknown[])[0]).toBe("private/photo.png");
    expect(JSON.stringify(result)).not.toContain("OLD-stale");
  });

  it("writes only within the placeholder's real widget values", async () => {
    // Proxy defs carry PROXY_INDEX_OFFSET-shifted indices; one reaching this
    // positional write would put a filename at index 10000 and pad 10k nulls.
    const result = await obfuscateWorkflowInputPaths(
      makePromotedWorkflow("private/photo.png"), nodeTypes,
    );

    expect((result.nodes[0].widgets_values as unknown[]).length).toBe(1);
  });
});

describe("chained promotion (a promoted widget promoted again one level up)", () => {
  const INNER_ID = "11111111-2222-3333-4444-555555555555";
  const OUTER_ID = "66666666-7777-8888-9999-aaaaaaaaaaaa";

  /**
   * Root instance of OUTER holds the live value. OUTER contains a placeholder
   * of INNER whose slot is link-driven from OUTER's boundary, and INNER holds
   * the LoadImage. Both nested levels keep a leftover value that nothing reads.
   */
  function makeChainedWorkflow(liveValue: string): Workflow {
    return {
      last_node_id: 7,
      last_link_id: 2,
      nodes: [{
        id: 7,
        type: OUTER_ID,
        pos: [0, 0], size: [100, 100], flags: {}, order: 0, mode: 0,
        inputs: [{ name: "image", type: "COMBO", link: null, widget: { name: "image" } }],
        outputs: [],
        properties: {},
        widgets_values: [liveValue],
      }],
      links: [],
      groups: [],
      config: {},
      version: 0.4,
      definitions: {
        subgraphs: [
          {
            id: OUTER_ID,
            name: "Outer",
            nodes: [{
              id: 5,
              type: INNER_ID,
              pos: [0, 0], size: [100, 100], flags: {}, order: 0, mode: 0,
              // Link-driven from OUTER's boundary, so this stored value is the
              // leftover of the second promotion and never executes.
              inputs: [{ name: "image", type: "COMBO", link: 2, widget: { name: "image" } }],
              outputs: [],
              properties: {},
              widgets_values: ["private/MID-stale.png"],
            }],
            links: [
              { id: 2, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: "COMBO" },
            ],
            inputs: [{ name: "image", type: "COMBO", linkIds: [2] }],
            outputs: [],
          },
          {
            id: INNER_ID,
            name: "Loader",
            nodes: [{
              id: 3,
              type: "LoadImage",
              pos: [0, 0], size: [100, 100], flags: {}, order: 0, mode: 0,
              inputs: [{ name: "image", type: "COMBO", link: 1, widget: { name: "image" } }],
              outputs: [],
              properties: {},
              widgets_values: ["private/INNER-stale.png", "image"],
            }],
            links: [
              { id: 1, origin_id: -10, origin_slot: 0, target_id: 3, target_slot: 0, type: "COMBO" },
            ],
            inputs: [{ name: "image", type: "COMBO", linkIds: [1] }],
            outputs: [],
          },
        ],
      },
    } as unknown as Workflow;
  }

  const subgraph = (wf: Workflow, id: string) =>
    wf.definitions!.subgraphs!.find((sg) => sg.id === id)!;

  it("does not ship either nested leftover filename", async () => {
    const result = await obfuscateWorkflowInputPaths(
      makeChainedWorkflow("private/photo.png"), nodeTypes,
    );

    // The whole point: neither leftover reaches the embedded copy, at any depth.
    expect(JSON.stringify(result)).not.toContain("MID-stale");
    expect(JSON.stringify(result)).not.toContain("INNER-stale");
    expect((result.nodes[0].widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
  });

  it("gives the mid-level slot the live value's alias", async () => {
    const result = await obfuscateWorkflowInputPaths(
      makeChainedWorkflow("private/photo.png"), nodeTypes,
    );

    const mid = subgraph(result, OUTER_ID).nodes[0];
    expect((mid.widgets_values as unknown[])[0]).toBe(".mi-deadbeef.png");
  });

  it("blanks the innermost slot rather than adopting the mid-level leftover", async () => {
    // The only instance of INNER is the mid-level placeholder, whose own stored
    // value is itself dead and scrubbed above. Copying it down would just move
    // the leftover, so there is no honest value to inherit.
    const result = await obfuscateWorkflowInputPaths(
      makeChainedWorkflow("private/photo.png"), nodeTypes,
    );

    const inner = subgraph(result, INNER_ID).nodes[0];
    expect((inner.widgets_values as unknown[])[0]).toBe("");
  });

  it("asks the server to alias only the one value that executes", async () => {
    await obfuscateWorkflowInputPaths(
      makeChainedWorkflow("private/photo.png"), nodeTypes,
    );

    expect(createInputAliases).toHaveBeenCalledWith(["private/photo.png"]);
  });

  it("leaves a loaded workflow's values alone on restore", async () => {
    // Restore must never "heal" a stale slot: the overwrite is obfuscate-only.
    const loaded = makeChainedWorkflow(".mi-deadbeef.png");
    vi.mocked(resolveInputAliases).mockResolvedValue({
      ".mi-deadbeef.png": "private/photo.png",
    });

    const result = await restoreWorkflowInputPaths(loaded, nodeTypes);

    expect((subgraph(result, OUTER_ID).nodes[0].widgets_values as unknown[])[0])
      .toBe("private/MID-stale.png");
    expect((subgraph(result, INNER_ID).nodes[0].widgets_values as unknown[])[0])
      .toBe("private/INNER-stale.png");
  });
});
