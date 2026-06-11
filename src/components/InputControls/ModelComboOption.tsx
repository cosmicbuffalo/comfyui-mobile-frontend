import { components } from "react-select";
import type { OptionProps, SingleValueProps } from "react-select";
import { getBaseModelAbbreviation, getSubTypeAbbreviation } from "@/utils/modelBadges";
import type { LoraManagerModel } from "@/api/loraManagerClient";

// A combo option enriched with optional Lora Manager model metadata. Plain
// (non-model) combos leave `model` undefined and render as a simple label.
export interface ComboSelectOption {
  value: string;
  label: string;
  isMissing?: boolean;
  model?: LoraManagerModel | null;
}

function ModelThumb({
  model,
  compact = false,
}: {
  model: LoraManagerModel | null;
  compact?: boolean;
}) {
  const rawUrl = model?.preview_url || "";
  const isVideo = /\.(mp4|webm)$/i.test(rawUrl);
  // These thumbnails render at ~28–44px, so ask our standalone preview route for
  // a small downscaled image instead of the full-res file. Videos and Lora
  // Manager-served URLs (a different route) are used as-is.
  const url =
    !isVideo && rawUrl.includes("/api/models/previews")
      ? `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}w=88`
      : rawUrl;
  const mediaClass = "absolute inset-0 w-full h-full object-cover";
  return (
    <div
      // Compact: fixed square. Full: fixed width, height stretches to the cell
      // (2-line name + version) via the row's items-stretch.
      className={`relative shrink-0 rounded-sm overflow-hidden bg-slate-800 ${compact ? "" : "self-stretch"}`}
      style={compact ? { width: 28, height: 28 } : { width: 44 }}
    >
      {url ? (
        isVideo ? (
          <video src={url} muted playsInline preload="metadata" className={mediaClass} />
        ) : (
          <img src={url} alt="" loading="lazy" decoding="async" className={mediaClass} />
        )
      ) : null}
    </div>
  );
}

export function ModelRowContent({
  option,
  compact = false,
}: {
  option: ComboSelectOption;
  compact?: boolean;
}) {
  const model = option.model;
  const version = model?.civitai?.name?.trim();
  const subAbbr = model ? getSubTypeAbbreviation(model.sub_type) : "";
  const baseAbbr = model ? getBaseModelAbbreviation(model.base_model) : "";
  const badge = [subAbbr, baseAbbr].filter(Boolean).join(" · ");

  // Compact rich value (desktop inline single-value): single-line-ish. With no
  // Lora Manager metadata, fall back to a plain label (no thumbnail).
  if (compact) {
    if (!model) {
      return (
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{option.label}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 min-w-0">
        <ModelThumb model={model} compact />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate">{option.label}</span>
          {version ? (
            <span className="truncate text-xs text-slate-400">{version}</span>
          ) : null}
        </div>
        {badge ? (
          <span className="shrink-0 ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-slate-800 text-slate-200">
            {badge}
          </span>
        ) : null}
      </div>
    );
  }

  // Full row: fixed height so every row is uniform (even ones with no preview or
  // no Lora Manager metadata — they still get a placeholder thumbnail). The
  // name+version block is vertically centered, so the version hugs under the
  // name when the name is a single line; with two lines it fills the cell. The
  // thumbnail stretches to the row height; the badge is vertically centered.
  return (
    <div className="flex items-stretch gap-2 min-w-0 h-[3.75em]">
      <ModelThumb model={model ?? null} />
      <div className="flex flex-col min-w-0 flex-1 justify-center">
        <span className="leading-snug line-clamp-2">{option.label}</span>
        {version ? (
          <span className="truncate text-xs leading-snug text-slate-400">
            {version}
          </span>
        ) : null}
      </div>
      {badge ? (
        <span className="shrink-0 self-center ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-slate-800 text-slate-200">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

export function ModelOption(props: OptionProps<ComboSelectOption, false>) {
  return (
    <components.Option {...props}>
      <ModelRowContent option={props.data} />
    </components.Option>
  );
}

export function ModelSingleValue(props: SingleValueProps<ComboSelectOption, false>) {
  return (
    <components.SingleValue {...props}>
      <ModelRowContent option={props.data} compact />
    </components.SingleValue>
  );
}
