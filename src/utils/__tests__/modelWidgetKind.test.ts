import { describe, expect, it } from "vitest";
import { modelWidgetKind } from "../modelWidgetKind";

describe("modelWidgetKind", () => {
  it("maps lora widgets to loras", () => {
    expect(modelWidgetKind("lora_name")).toBe("loras");
    expect(modelWidgetKind("lora_name_1")).toBe("loras");
    expect(modelWidgetKind("lora_2")).toBe("loras");
  });

  it("maps checkpoint and unet widgets to checkpoints", () => {
    expect(modelWidgetKind("ckpt_name")).toBe("checkpoints");
    expect(modelWidgetKind("unet_name")).toBe("checkpoints");
  });

  it("maps embedding widgets to embeddings", () => {
    expect(modelWidgetKind("embedding_name")).toBe("embeddings");
  });

  it("is case-insensitive", () => {
    expect(modelWidgetKind("CKPT_NAME")).toBe("checkpoints");
  });

  it("returns null for unmapped widgets (e.g. VAE, sampler)", () => {
    expect(modelWidgetKind("vae_name")).toBeNull();
    expect(modelWidgetKind("sampler_name")).toBeNull();
    expect(modelWidgetKind("")).toBeNull();
    expect(modelWidgetKind(null)).toBeNull();
    expect(modelWidgetKind(undefined)).toBeNull();
  });
});
