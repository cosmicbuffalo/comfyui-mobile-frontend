// Compact model badge labels, ported verbatim from ComfyUI Lora Manager's
// `static/js/utils/constants.js` so our dropdown badges match LM's own UI exactly.
//
// `base_model` on an LM model is one of the display strings below (e.g. "Illustrious",
// "SDXL 1.0", "Flux.1 D"); `sub_type` is one of the keys in MODEL_SUBTYPE_ABBREVIATIONS.

// Sub-type → compact label (e.g. checkpoint → "CKPT").
export const MODEL_SUBTYPE_ABBREVIATIONS: Record<string, string> = {
  lora: "LoRA",
  locon: "LyCO",
  dora: "DoRA",
  checkpoint: "CKPT",
  diffusion_model: "DM",
  embedding: "EMB",
};

const UNKNOWN_BASE_MODEL = "Other";
const ABBREVIATION_MAX_LENGTH = 4;

export function getSubTypeAbbreviation(subType: string | null | undefined): string {
  if (!subType || typeof subType !== "string") return "";
  const normalized = subType.toLowerCase();
  return (
    MODEL_SUBTYPE_ABBREVIATIONS[normalized] ??
    subType.toUpperCase().slice(0, ABBREVIATION_MAX_LENGTH)
  );
}

// Base-model display name → compact badge label. Keyed by the exact display strings
// that LM stores in the `base_model` field.
export const BASE_MODEL_ABBREVIATIONS: Record<string, string> = {
  // Stable Diffusion 1.x
  "SD 1.4": "SD1",
  "SD 1.5": "SD1",
  "SD 1.5 LCM": "SD1",
  "SD 1.5 Hyper": "SD1",
  // Stable Diffusion 2.x
  "SD 2.0": "SD2",
  "SD 2.1": "SD2",
  // Stable Diffusion 3.x
  "SD 3": "SD3",
  "SD 3.5": "SD3",
  "SD 3.5 Medium": "SD3",
  "SD 3.5 Large": "SD3",
  "SD 3.5 Large Turbo": "SD3",
  // SDXL
  "SDXL 1.0": "XL",
  "SDXL Lightning": "XL",
  "SDXL Hyper": "XL",
  // Flux
  "Flux.1 D": "F1D",
  "Flux.1 S": "F1S",
  "Flux.1 Krea": "F1KR",
  "Flux.1 Kontext": "F1KX",
  "Flux.2 D": "F2D",
  "Flux.2 Klein 9B": "FK9",
  "Flux.2 Klein 9B-base": "FK9B",
  "Flux.2 Klein 4B": "FK4",
  "Flux.2 Klein 4B-base": "FK4B",
  // Other diffusion models
  AuraFlow: "AF",
  Chroma: "CHR",
  "PixArt a": "PXA",
  "PixArt E": "PXE",
  "Hunyuan 1": "HY",
  Lumina: "L",
  Kolors: "KLR",
  NoobAI: "NAI",
  Illustrious: "IL",
  Pony: "PONY",
  HiDream: "HID",
  Qwen: "QWEN",
  ZImageTurbo: "ZIT",
  ZImageBase: "ZIB",
  // Video models
  SVD: "SVD",
  LTXV: "LTXV",
  LTXV2: "LTV2",
  "Wan Video": "WAN",
  "Wan Video 1.3B t2v": "WAN",
  "Wan Video 14B t2v": "WAN",
  "Wan Video 14B i2v 480p": "WAN",
  "Wan Video 14B i2v 720p": "WAN",
  "Wan Video 2.2 TI2V-5B": "WAN",
  "Wan Video 2.2 T2V-A14B": "WAN",
  "Wan Video 2.2 I2V-A14B": "WAN",
  "Hunyuan Video": "HYV",
  // Default
  [UNKNOWN_BASE_MODEL]: "OTH",
};

const NORMALIZED_BASE_MODEL_ABBREVIATIONS: Record<string, string> = Object.entries(
  BASE_MODEL_ABBREVIATIONS,
).reduce<Record<string, string>>((acc, [name, abbreviation]) => {
  acc[name.toLowerCase()] = abbreviation;
  return acc;
}, {});

function buildFallbackAbbreviation(baseModel: string): string {
  const tokens = baseModel.split(/[\s_-]+/).filter(Boolean);
  const initialism = tokens
    .map((token) => token[0])
    .join("")
    .slice(0, ABBREVIATION_MAX_LENGTH);
  if (initialism.length >= 2) return initialism.toUpperCase();

  const alphanumeric = baseModel.replace(/[^A-Za-z0-9]/g, "");
  if (!alphanumeric) return BASE_MODEL_ABBREVIATIONS[UNKNOWN_BASE_MODEL];
  return alphanumeric.slice(0, ABBREVIATION_MAX_LENGTH).toUpperCase();
}

export function getBaseModelAbbreviation(baseModel: string | null | undefined): string {
  if (!baseModel || typeof baseModel !== "string") {
    return BASE_MODEL_ABBREVIATIONS[UNKNOWN_BASE_MODEL];
  }
  const normalized = baseModel.trim().toLowerCase();
  if (!normalized) return BASE_MODEL_ABBREVIATIONS[UNKNOWN_BASE_MODEL];
  if (normalized.includes("wan video")) return "WAN";
  const directMatch = NORMALIZED_BASE_MODEL_ABBREVIATIONS[normalized];
  if (directMatch) return directMatch;
  return buildFallbackAbbreviation(baseModel);
}
