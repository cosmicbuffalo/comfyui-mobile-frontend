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
