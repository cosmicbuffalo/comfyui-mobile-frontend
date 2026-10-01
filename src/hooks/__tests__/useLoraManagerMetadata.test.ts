import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
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
  refreshLoraManagerModels: vi.fn(async () => true),
  triggerPopulate: vi.fn(async () => null),
  getPopulateStatus: vi.fn(async () => null),
  getCivitaiStatus: vi.fn(async () => ({ enabled: true, forcedByEnvironment: false })),
  scanLoraManagerModels: vi.fn(async () => true),
  scanStandaloneModels: vi.fn(async () => true),
  fetchLoraManagerModel: vi.fn(async () => true),
  fetchMissingStandalone: vi.fn(async () => true),
}));

import {
  needsMetadata,
  resetAutoFetchForTests,
  useAutoFetchModelMetadata,
  useLoraManagerMetadataStore,
} from "../useLoraManagerMetadata";
import {
  fetchAllModels,
  fetchLoraManagerModel,
  fetchMissingStandalone,
  getCivitaiStatus,
  getPopulateStatus,
  refreshLoraManagerModels,
  resolveModelProvider,
  scanLoraManagerModels,
  scanStandaloneModels,
  triggerPopulate,
} from "@/api/loraManagerClient";

// Reset shared store + mock state between every test so describe blocks (and any
// future ones) don't leak provider/availability state into each other.
beforeEach(() => {
  useLoraManagerMetadataStore.setState({
    available: null,
    standalone: false,
    refreshing: false,
    refreshDone: false,
    refreshLabel: null,
    refreshError: null,
    civitaiEnabled: null,
    prefixes: {
      loras: { status: "idle", byPath: new Map(), byFileName: new Map() },
      checkpoints: { status: "idle", byPath: new Map(), byFileName: new Map() },
      embeddings: { status: "idle", byPath: new Map(), byFileName: new Map() },
    },
  });
  resetAutoFetchForTests();
  vi.mocked(getCivitaiStatus).mockReset();
  vi.mocked(getCivitaiStatus).mockResolvedValue({ enabled: true, forcedByEnvironment: false });
  vi.mocked(scanLoraManagerModels).mockReset();
  vi.mocked(scanLoraManagerModels).mockResolvedValue(true);
  vi.mocked(scanStandaloneModels).mockReset();
  vi.mocked(scanStandaloneModels).mockResolvedValue(true);
  vi.mocked(fetchLoraManagerModel).mockReset();
  vi.mocked(fetchLoraManagerModel).mockResolvedValue(true);
  vi.mocked(fetchMissingStandalone).mockReset();
  vi.mocked(fetchMissingStandalone).mockResolvedValue(true);
  vi.mocked(resolveModelProvider).mockReset();
  vi.mocked(resolveModelProvider).mockResolvedValue({ base: "/api/lm", standalone: false });
  vi.mocked(fetchAllModels).mockReset();
  vi.mocked(fetchAllModels).mockResolvedValue(SAMPLE);
  vi.mocked(refreshLoraManagerModels).mockReset();
  vi.mocked(refreshLoraManagerModels).mockResolvedValue(true);
  vi.mocked(triggerPopulate).mockReset();
  vi.mocked(triggerPopulate).mockResolvedValue(null);
  vi.mocked(getPopulateStatus).mockReset();
  vi.mocked(getPopulateStatus).mockResolvedValue(null);
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

describe("useLoraManagerMetadata refresh", () => {
  it("prefers a LoRA Manager scan and metadata fetch for every model kind", async () => {
    const store = useLoraManagerMetadataStore;

    store.getState().refreshAllMetadata();
    expect(store.getState().refreshing).toBe(true);
    await vi.waitFor(() => expect(store.getState().refreshing).toBe(false));

    expect(refreshLoraManagerModels).toHaveBeenCalledTimes(3);
    expect(vi.mocked(refreshLoraManagerModels).mock.calls).toEqual([
      ["checkpoints"],
      ["loras"],
      ["embeddings"],
    ]);
    expect(triggerPopulate).not.toHaveBeenCalled();
    expect(store.getState().refreshDone).toBe(true);
    expect(store.getState().refreshError).toBeNull();
  });

  it("falls back to the built-in fetcher when LoRA Manager is absent", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(resolveModelProvider).mockResolvedValue({
        base: "/mobile/api/models",
        standalone: true,
      });
      vi.mocked(triggerPopulate).mockResolvedValue({
        running: true,
        total: 1,
        processed: 0,
        updated: 0,
      });
      vi.mocked(getPopulateStatus).mockResolvedValue({
        running: false,
        total: 1,
        processed: 1,
        updated: 1,
      });

      const store = useLoraManagerMetadataStore;
      store.getState().refreshAllMetadata();

      // Each category polls once after two seconds, then advances to the next.
      await vi.advanceTimersByTimeAsync(6_000);
      await Promise.resolve();

      expect(refreshLoraManagerModels).not.toHaveBeenCalled();
      expect(vi.mocked(triggerPopulate).mock.calls).toEqual([
        ["checkpoints", false],
        ["loras", false],
        ["embeddings", false],
      ]);
      expect(store.getState().refreshing).toBe(false);
      expect(store.getState().refreshDone).toBe(true);
      expect(store.getState().refreshError).toBeNull();

      await vi.advanceTimersByTimeAsync(4_999);
      expect(store.getState().refreshDone).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      expect(store.getState().refreshDone).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show completion when LoRA Manager refresh fails", async () => {
    vi.mocked(refreshLoraManagerModels).mockResolvedValue(false);
    const store = useLoraManagerMetadataStore;

    store.getState().refreshAllMetadata();
    await vi.waitFor(() => expect(store.getState().refreshing).toBe(false));

    expect(store.getState().refreshDone).toBe(false);
    expect(store.getState().refreshError).not.toBeNull();
  });
});

describe("useLoraManagerMetadata refresh with CivitAI lookups off", () => {
  beforeEach(() => {
    vi.mocked(getCivitaiStatus).mockResolvedValue({ enabled: false, forcedByEnvironment: false });
  });

  it("only rescans LoRA Manager, asking it to fetch nothing", async () => {
    const store = useLoraManagerMetadataStore;
    store.getState().refreshAllMetadata();
    await vi.waitFor(() => expect(store.getState().refreshing).toBe(false));

    expect(refreshLoraManagerModels).not.toHaveBeenCalled();
    expect(scanLoraManagerModels).toHaveBeenCalledTimes(3);
    expect(fetchLoraManagerModel).not.toHaveBeenCalled();
    expect(store.getState().refreshDone).toBe(true);
  });

  it("does not start the built-in fetcher", async () => {
    vi.mocked(resolveModelProvider).mockResolvedValue({
      base: "/mobile/api/models",
      standalone: true,
    });
    const store = useLoraManagerMetadataStore;
    store.getState().refreshAllMetadata();
    await vi.waitFor(() => expect(store.getState().refreshing).toBe(false));

    expect(triggerPopulate).not.toHaveBeenCalled();
    expect(vi.mocked(scanStandaloneModels).mock.calls).toEqual([
      ["checkpoints"], ["loras"], ["embeddings"],
    ]);
    expect(store.getState().refreshDone).toBe(true);
  });

  it("reports a failed local scan instead of showing refresh success", async () => {
    vi.mocked(resolveModelProvider).mockResolvedValue({ base: "/mobile/api/models", standalone: true });
    vi.mocked(scanStandaloneModels).mockResolvedValue(false);
    const store = useLoraManagerMetadataStore;
    store.getState().refreshAllMetadata();
    await vi.waitFor(() => expect(store.getState().refreshing).toBe(false));
    expect(store.getState().refreshDone).toBe(false);
    expect(store.getState().refreshError).not.toBeNull();
    expect(triggerPopulate).not.toHaveBeenCalled();
  });
});

describe("needsMetadata", () => {
  const base = SAMPLE[0];
  it("is true for a model missing from the catalog or not yet looked up", () => {
    expect(needsMetadata(null)).toBe(true);
    expect(needsMetadata({ ...base, civitai: null })).toBe(true);
    expect(needsMetadata({ ...base, civitai: {}, from_civitai: true })).toBe(true);
  });
  it("is false once CivitAI has answered either way", () => {
    expect(needsMetadata({ ...base, civitai: { id: 3 } })).toBe(false);
    expect(needsMetadata({ ...base, civitai: null, from_civitai: false })).toBe(false);
  });
});

describe("useLoraManagerMetadata automatic lookup", () => {
  const NEW_MODEL: LoraManagerModel = {
    model_name: "new_model",
    file_name: "new_model",
    preview_url: "",
    base_model: "",
    folder: "",
    sha256: "fff",
    file_path: "/home/user/ComfyUI/models/checkpoints/new_model.safetensors",
    file_size: 1,
    sub_type: "checkpoint",
    civitai: {},
    from_civitai: true,
  };

  async function ready() {
    await loadCheckpoints();
    await vi.waitFor(() =>
      expect(useLoraManagerMetadataStore.getState().civitaiEnabled).toBe(true),
    );
  }

  it("fetches a new path even when an older file with the same name is identified", async () => {
    const oldModel = { ...SAMPLE[1], civitai: { id: 42 } };
    vi.mocked(fetchAllModels).mockResolvedValue([oldModel]);
    await ready();
    const newModel = {
      ...oldModel, folder: "new", file_path: "/models/checkpoints/new/root_model.safetensors", civitai: {},
    };
    const store = useLoraManagerMetadataStore;
    expect(store.getState().lookup("checkpoints", "new/root_model.safetensors")).toBe(oldModel);
    expect(store.getState().lookupExact("checkpoints", "new/root_model.safetensors")).toBeNull();
    vi.mocked(fetchAllModels).mockResolvedValue([oldModel, newModel]);
    function Probe() {
      useAutoFetchModelMetadata("checkpoints", "new/root_model.safetensors");
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(createElement(Probe)));
      await act(async () => {
        await vi.waitFor(() => expect(fetchLoraManagerModel).toHaveBeenCalledWith("checkpoints", newModel.file_path), { timeout: 3000 });
      });
      expect(fetchLoraManagerModel).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("does not fetch a different same-named file if the requested path remains absent after scanning", async () => {
    await ready();
    const store = useLoraManagerMetadataStore;
    store.getState().requestMissingMetadata("checkpoints", "new/root_model.safetensors");
    await vi.waitFor(() => expect(scanLoraManagerModels).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchLoraManagerModel).not.toHaveBeenCalled();
  });

  it("rescans LoRA Manager and asks it about a model new since the catalog loaded", async () => {
    await ready();
    // After the scan, LM's catalog has the new file, not yet looked up.
    vi.mocked(fetchAllModels).mockResolvedValue([...SAMPLE, NEW_MODEL]);

    const store = useLoraManagerMetadataStore;
    store.getState().requestMissingMetadata("checkpoints", "new_model.safetensors");
    store.getState().requestMissingMetadata("checkpoints", "new_model.safetensors");

    await vi.waitFor(() => expect(fetchLoraManagerModel).toHaveBeenCalled(), { timeout: 3000 });
    expect(scanLoraManagerModels).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchLoraManagerModel).mock.calls).toEqual([
      ["checkpoints", NEW_MODEL.file_path],
    ]);
  });

  it("asks about each model once per session", async () => {
    await ready();
    const store = useLoraManagerMetadataStore;
    store.getState().requestMissingMetadata("checkpoints", "gone.safetensors");
    await vi.waitFor(() => expect(scanLoraManagerModels).toHaveBeenCalledTimes(1), { timeout: 3000 });

    store.getState().requestMissingMetadata("checkpoints", "GONE.safetensors");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(scanLoraManagerModels).toHaveBeenCalledTimes(1);
    // Not in LM's catalog even after a scan: nothing to ask about.
    expect(fetchLoraManagerModel).not.toHaveBeenCalled();
  });

  it("batches the built-in backend's lookups into one request", async () => {
    vi.mocked(resolveModelProvider).mockResolvedValue({
      base: "/mobile/api/models",
      standalone: true,
    });
    await ready();
    const store = useLoraManagerMetadataStore;
    store.getState().requestMissingMetadata("loras", "a.safetensors");
    store.getState().requestMissingMetadata("loras", "sub/b.safetensors");

    await vi.waitFor(() => expect(fetchMissingStandalone).toHaveBeenCalled(), { timeout: 3000 });
    expect(vi.mocked(fetchMissingStandalone).mock.calls).toEqual([
      ["loras", ["a.safetensors", "sub/b.safetensors"]],
    ]);
  });

  it("ignores values that are not model files", async () => {
    await ready();
    const store = useLoraManagerMetadataStore;
    store.getState().requestMissingMetadata("loras", "None");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(scanLoraManagerModels).not.toHaveBeenCalled();
  });

  it("does nothing while CivitAI lookups are off", async () => {
    vi.mocked(getCivitaiStatus).mockResolvedValue({ enabled: false, forcedByEnvironment: false });
    await loadCheckpoints();
    const store = useLoraManagerMetadataStore;
    await vi.waitFor(() => expect(store.getState().civitaiEnabled).toBe(false));

    store.getState().requestMissingMetadata("checkpoints", "new_model.safetensors");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(scanLoraManagerModels).not.toHaveBeenCalled();
    expect(fetchLoraManagerModel).not.toHaveBeenCalled();
  });

  it("asks LoRA Manager nothing once the server says lookups are off, whatever this page cached", async () => {
    await ready();
    vi.mocked(fetchAllModels).mockResolvedValue([...SAMPLE, NEW_MODEL]);
    // An admin turned lookups off from another client after this page loaded.
    vi.mocked(getCivitaiStatus).mockResolvedValue({ enabled: false, forcedByEnvironment: false });
    const store = useLoraManagerMetadataStore;

    store.getState().requestMissingMetadata("checkpoints", "new_model.safetensors");
    await vi.waitFor(() => expect(store.getState().civitaiEnabled).toBe(false), { timeout: 3000 });

    expect(scanLoraManagerModels).not.toHaveBeenCalled();
    expect(fetchLoraManagerModel).not.toHaveBeenCalled();
  });

  it("treats an unanswered switch check as off before asking LoRA Manager", async () => {
    await ready();
    vi.mocked(fetchAllModels).mockResolvedValue([...SAMPLE, NEW_MODEL]);
    vi.mocked(getCivitaiStatus).mockRejectedValue(new Error("offline"));

    useLoraManagerMetadataStore.getState().requestMissingMetadata("checkpoints", "new_model.safetensors");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(fetchLoraManagerModel).not.toHaveBeenCalled();
  });

  it("asks again about a model skipped while lookups were off once they are back on", async () => {
    await ready();
    vi.mocked(fetchAllModels).mockResolvedValue([...SAMPLE, NEW_MODEL]);
    const store = useLoraManagerMetadataStore;
    vi.mocked(getCivitaiStatus).mockResolvedValueOnce({ enabled: false, forcedByEnvironment: false });

    store.getState().requestMissingMetadata("checkpoints", "new_model.safetensors");
    await vi.waitFor(() => expect(store.getState().civitaiEnabled).toBe(false), { timeout: 3000 });
    expect(fetchLoraManagerModel).not.toHaveBeenCalled();

    // The mounted control's effect re-runs when the switch comes back on.
    store.getState().setCivitaiEnabled(true);
    store.getState().requestMissingMetadata("checkpoints", "new_model.safetensors");

    await vi.waitFor(() => expect(fetchLoraManagerModel).toHaveBeenCalled(), { timeout: 3000 });
    expect(vi.mocked(fetchLoraManagerModel).mock.calls).toEqual([
      ["checkpoints", NEW_MODEL.file_path],
    ]);
  });

  it("stops before asking LoRA Manager if the switch is turned off mid-batch", async () => {
    await ready();
    vi.mocked(fetchAllModels).mockResolvedValue([...SAMPLE, NEW_MODEL]);
    const store = useLoraManagerMetadataStore;
    vi.mocked(scanLoraManagerModels).mockImplementation(async () => {
      store.getState().setCivitaiEnabled(false);
      return true;
    });

    store.getState().requestMissingMetadata("checkpoints", "new_model.safetensors");
    await vi.waitFor(() => expect(scanLoraManagerModels).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchLoraManagerModel).not.toHaveBeenCalled();
  });
});
