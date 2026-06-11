import { describe, expect, it } from "vitest";
import {
  getBaseModelAbbreviation,
  getSubTypeAbbreviation,
} from "../modelBadges";

describe("getSubTypeAbbreviation", () => {
  it("maps known sub-types to compact labels", () => {
    expect(getSubTypeAbbreviation("checkpoint")).toBe("CKPT");
    expect(getSubTypeAbbreviation("lora")).toBe("LoRA");
    expect(getSubTypeAbbreviation("diffusion_model")).toBe("DM");
    expect(getSubTypeAbbreviation("embedding")).toBe("EMB");
  });

  it("is case-insensitive", () => {
    expect(getSubTypeAbbreviation("CHECKPOINT")).toBe("CKPT");
  });

  it("falls back to upper-cased first 4 chars for unknown sub-types", () => {
    expect(getSubTypeAbbreviation("widget")).toBe("WIDG");
  });

  it("returns empty string for missing input", () => {
    expect(getSubTypeAbbreviation("")).toBe("");
    expect(getSubTypeAbbreviation(null)).toBe("");
    expect(getSubTypeAbbreviation(undefined)).toBe("");
  });
});

describe("getBaseModelAbbreviation", () => {
  it("matches Lora Manager's direct abbreviations", () => {
    expect(getBaseModelAbbreviation("Illustrious")).toBe("IL");
    expect(getBaseModelAbbreviation("SDXL 1.0")).toBe("XL");
    expect(getBaseModelAbbreviation("Flux.1 D")).toBe("F1D");
    expect(getBaseModelAbbreviation("Pony")).toBe("PONY");
    expect(getBaseModelAbbreviation("SD 1.5")).toBe("SD1");
  });

  it("is case-insensitive", () => {
    expect(getBaseModelAbbreviation("illustrious")).toBe("IL");
  });

  it("collapses all Wan Video variants to WAN", () => {
    expect(getBaseModelAbbreviation("Wan Video 14B i2v 720p")).toBe("WAN");
  });

  it("falls back to OTH for empty/missing input", () => {
    expect(getBaseModelAbbreviation("")).toBe("OTH");
    expect(getBaseModelAbbreviation(null)).toBe("OTH");
    expect(getBaseModelAbbreviation(undefined)).toBe("OTH");
  });

  it("builds an initialism for unknown multi-word base models", () => {
    expect(getBaseModelAbbreviation("Some New Model")).toBe("SNM");
  });
});
