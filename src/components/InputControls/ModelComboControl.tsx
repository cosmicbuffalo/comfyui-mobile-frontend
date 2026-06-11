import type { ComponentProps } from "react";
import { ComboControl } from "./ComboControl";
import type { LoraManagerPrefix } from "@/api/loraManagerClient";
import { useModelMetadataLookup } from "@/hooks/useLoraManagerMetadata";

type ModelComboControlProps = ComponentProps<typeof ComboControl> & {
  /**
   * Which Lora Manager catalog backs this combo (loras/checkpoints/embeddings),
   * or null for a plain combo. When set and LM is available, options render as
   * rich model rows (preview + name + version + badge); otherwise plain labels.
   */
  modelKind: LoraManagerPrefix | null;
};

/**
 * ComboControl wrapper that wires Lora Manager metadata in for model widgets.
 * Reusable across any model/lora/checkpoint picker — pass the appropriate
 * modelKind. Falls back to a plain ComboControl when LM isn't installed or the
 * widget isn't a model picker.
 */
export function ModelComboControl({
  modelKind,
  options,
  ...rest
}: ModelComboControlProps) {
  const modelLookup = useModelMetadataLookup(modelKind);
  const comboOptions = !modelLookup
    ? options
    : Array.isArray(options)
      ? { options, modelLookup }
      : { ...((options as Record<string, unknown>) ?? {}), modelLookup };
  return <ComboControl {...rest} options={comboOptions} />;
}
