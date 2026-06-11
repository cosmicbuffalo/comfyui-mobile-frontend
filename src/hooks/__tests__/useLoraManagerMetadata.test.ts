import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoraManagerModel } from "@/api/loraManagerClient";

const SAMPLE: LoraManagerModel[] = [
  {
    model_name: "My Model",
    file_name: "My_Model",
    preview_url: "/api/lm/previews?path=a.png",
    base_model: "Illustrious",
    folder: "subdir",
    sha256: "abc",
    // LM returns an absolute file_path; folder is relative to the model root.
    file_path: "/home/user/ComfyUI/models/checkpoints/subdir/My_Model.safetensors",
    file_size: 1,
    sub_type: "checkpoint",
  },
  {
    model_name: "Root Model",
    file_name: "root_model",
    preview_url: "",
    base_model: "SDXL 1.0",
    folder: "",
    sha256: "def",
    file_path: "/home/user/ComfyUI/models/checkpoints/root_model.safetensors",
    file_size: 1,
    sub_type: "checkpoint",
  },
  // Two models that share a filename stem in different folders — the bare
  // filename is ambiguous and must not resolve to a wrong guess.
  {
    model_name: "Dup A",
    file_name: "dup_model",
    preview_url: "",
    base_model: "SDXL 1.0",
    folder: "folderA",
    sha256: "d1",
    file_path: "/home/user/ComfyUI/models/checkpoints/folderA/dup_model.safetensors",
    file_size: 1,
    sub_type: "checkpoint",
  },
  {
    model_name: "Dup B",
    file_name: "dup_model",
    preview_url: "",
    base_model: "SDXL 1.0",
    folder: "folderB",
    sha256: "d2",
    file_path: "/home/user/ComfyUI/models/checkpoints/folderB/dup_model.safetensors",
    file_size: 1,
    sub_type: "checkpoint",
  },
];

vi.mock("@/api/loraManagerClient", () => ({
  resolveModelProvider: vi.fn(async () => ({
    base: "/api/lm",
    standalone: false,
  })),
  fetchAllModels: vi.fn(async () => SAMPLE),
  fetchStandaloneModels: vi.fn(async () => SAMPLE),
  triggerPopulate: vi.fn(async () => null),
  getPopulateStatus: vi.fn(async () => null),
}));

import { useLoraManagerMetadataStore } from "../useLoraManagerMetadata";
import { resolveModelProvider } from "@/api/loraManagerClient";

// Reset shared store + mock state between every test so describe blocks (and any
// future ones) don't leak provider/availability state into each other.
beforeEach(() => {
  useLoraManagerMetadataStore.setState({ available: null, standalone: false });
  vi.mocked(resolveModelProvider).mockReset();
  vi.mocked(resolveModelProvider).mockResolvedValue({ base: "/api/lm", standalone: false });
});

async function loadCheckpoints() {
  const store = useLoraManagerMetadataStore;
  store.getState().ensureAvailable();
  await vi.waitFor(() => expect(store.getState().available).toBe(true));
  store.getState().ensurePrefixLoaded("checkpoints");
  await vi.waitFor(() =>
    expect(store.getState().prefixes.checkpoints.status).toBe("ready"),
  );
}

describe("useLoraManagerMetadata lookup", () => {
  beforeEach(async () => {
    await loadCheckpoints();
  });

  it("matches by relative path (case/slash-insensitive)", () => {
    const { lookup } = useLoraManagerMetadataStore.getState();
    expect(lookup("checkpoints", "subdir/My_Model.safetensors")?.model_name).toBe(
      "My Model",
    );
    expect(lookup("checkpoints", "subdir\\My_Model.safetensors")?.model_name).toBe(
      "My Model",
    );
  });

  it("matches a root-level model by filename", () => {
    const { lookup } = useLoraManagerMetadataStore.getState();
    expect(lookup("checkpoints", "root_model.safetensors")?.model_name).toBe(
      "Root Model",
    );
  });

  it("falls back to filename stem when path does not match", () => {
    const { lookup } = useLoraManagerMetadataStore.getState();
    expect(lookup("checkpoints", "My_Model.safetensors")?.model_name).toBe(
      "My Model",
    );
  });

  it("does not guess metadata for a bare filename shared across folders", () => {
    const { lookup } = useLoraManagerMetadataStore.getState();
    // Exact relative paths still resolve to the right model...
    expect(lookup("checkpoints", "folderA/dup_model.safetensors")?.model_name).toBe("Dup A");
    expect(lookup("checkpoints", "folderB/dup_model.safetensors")?.model_name).toBe("Dup B");
    // ...but the ambiguous bare filename must not resolve to a wrong guess.
    expect(lookup("checkpoints", "dup_model.safetensors")).toBeNull();
  });

  it("returns null for unknown models and empty values", () => {
    const { lookup } = useLoraManagerMetadataStore.getState();
    expect(lookup("checkpoints", "nope.safetensors")).toBeNull();
    expect(lookup("checkpoints", "")).toBeNull();
    expect(lookup("checkpoints", null)).toBeNull();
  });
});

describe("useLoraManagerMetadata availability", () => {
  it("re-probes after a failed/empty first probe instead of staying disabled", async () => {
    const store = useLoraManagerMetadataStore;
    const mockResolve = vi.mocked(resolveModelProvider);
    store.setState({ available: null, standalone: false });
    mockResolve.mockReset();
    mockResolve.mockRejectedValueOnce(new Error("backend not ready"));
    mockResolve.mockResolvedValue({ base: "/api/lm", standalone: false });

    store.getState().ensureAvailable();
    await vi.waitFor(() => expect(store.getState().available).toBe(false));

    // A subsequent call must genuinely retry (the old guard blocked forever).
    store.getState().ensureAvailable();
    await vi.waitFor(() => expect(store.getState().available).toBe(true));
  });
});
