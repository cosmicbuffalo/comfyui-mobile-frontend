import type { extractMetadata } from "@/utils/metadata";

interface MediaViewerMetadataProps {
  isVideo: boolean;
  showMetadataToggle?: boolean;
  showMetadataOverlay: boolean;
  metadataIsLoading: boolean;
  metadata: ReturnType<typeof extractMetadata> | null | undefined;
  durationLabel: string;
}

export function MediaViewerMetadata({
  isVideo,
  showMetadataToggle,
  showMetadataOverlay,
  metadataIsLoading,
  metadata,
  durationLabel,
}: MediaViewerMetadataProps) {
  if (!showMetadataToggle) return null;

  return (
    <div
      className={`absolute right-3 flex flex-col items-end gap-1 pointer-events-none transition-opacity duration-300 ${
        showMetadataOverlay ? "opacity-100" : "opacity-0"
      }`}
      style={{
        bottom: isVideo
          ? "calc(var(--bottom-bar-offset, 0px) + 120px)"
          : "calc(var(--bottom-bar-offset, 0px) + 64px)",
      }}
    >
      {metadataIsLoading ? (
        <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">
          Loading metadata...
        </div>
      ) : metadata ? (
        <>
          {metadata.model && (
            <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">
              model: {metadata.model}
            </div>
          )}
          {metadata.sampler && (
            <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">
              sampler: {metadata.sampler}
            </div>
          )}
          {metadata.steps && (
            <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">
              steps: {metadata.steps}
            </div>
          )}
          {metadata.cfg && (
            <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">
              cfg: {metadata.cfg}
            </div>
          )}
          {durationLabel && (
            <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">
              time: {durationLabel}
            </div>
          )}
        </>
      ) : (
        <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">
          No metadata found
        </div>
      )}
    </div>
  );
}
