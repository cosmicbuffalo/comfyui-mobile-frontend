import type { LoraManagerPrefix } from "@/api/loraManagerClient";

// Map a ComfyUI combo-widget name to the Lora Manager model type whose metadata
// describes its options, or null when LM has no matching catalog (the widget then
// keeps its plain-text rendering).
//
// VAE is intentionally null: LM has no dedicated VAE prefix, so VAE combos fall back.
export function modelWidgetKind(
  widgetName: string | null | undefined,
): LoraManagerPrefix | null {
  if (!widgetName || typeof widgetName !== "string") return null;
  const name = widgetName.toLowerCase();

  // Loras: `lora_name`, `lora_name_1`, `lora_0`, etc.
  if (name === "lora_name" || name.startsWith("lora_name") || /^lora(_|$)/.test(name)) {
    return "loras";
  }

  // Checkpoints, including unet/diffusion models which LM catalogs under `checkpoints`.
  if (name === "ckpt_name" || name === "unet_name") return "checkpoints";

  // Embeddings (rare as a combo widget, but mapped for completeness).
  if (name === "embedding_name" || name.startsWith("embedding")) return "embeddings";

  return null;
}
