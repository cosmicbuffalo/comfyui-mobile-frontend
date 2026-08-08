import { getImagePreviewUrl } from '@/api/client';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';

interface NodeCardOutputPreviewProps {
  show: boolean;
  previewImage: { filename: string; subfolder: string; type: string } | null;
  // When the node produced more than one output (a batch), these thumbnails are
  // tiled into two columns so the whole batch is visible at once. null/empty
  // falls back to the single-image preview below.
  previewImages?: Array<{ displaySrc: string; alt: string }> | null;
  latentPreviewUrl?: string | null;
  previewText?: string | null;
  displayName: string;
  onImageClick?: () => void;
  onPreviewImageClick?: (index: number) => void;
  isExecuting: boolean;
  overallProgress: number | null;
  displayNodeProgress: number;
}

export function NodeCardOutputPreview({
  show,
  previewImage,
  previewImages = null,
  latentPreviewUrl = null,
  previewText = null,
  displayName,
  onImageClick,
  onPreviewImageClick,
  isExecuting,
  overallProgress,
  displayNodeProgress
}: NodeCardOutputPreviewProps) {
  // Subscribe so the preview refreshes immediately when the WebP preference is
  // toggled (must run before the early return to satisfy the rules of hooks).
  useGenerationSettingsStore((s) => s.webpPreviewEnabled);
  const isTiled = Boolean(previewImages && previewImages.length > 1);
  if (!show || (!previewImage && !previewText && !latentPreviewUrl && !isTiled)) return null;

  const displaySrc = previewImage
    ? getImagePreviewUrl(previewImage.filename, previewImage.subfolder, previewImage.type)
    : latentPreviewUrl;

  return (
    <div className="mb-3">
      <div className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">
        Output Preview
      </div>
      {isTiled ? (
        <div className="output-batch-grid grid grid-cols-2 gap-2">
          {previewImages!.map((img, i) => (
            <img
              key={img.displaySrc}
              src={img.displaySrc}
              alt={img.alt}
              className="w-full h-auto rounded-lg border border-white/10"
              loading="lazy"
              onClick={() => onPreviewImageClick?.(i)}
            />
          ))}
        </div>
      ) : displaySrc && (
        <div className="relative">
          <img
            key={previewImage ? 'preview' : 'latent'}
            src={displaySrc}
            alt={`${displayName} output`}
            className="w-full h-auto rounded-lg border border-white/10"
            loading="lazy"
            onClick={onImageClick}
          />
          {isExecuting && overallProgress !== null && (
            <div className="absolute inset-0 bg-black/40 rounded-lg flex items-end p-3">
              <div className="w-full">
                <div className="flex items-center justify-between text-xs text-white/90 mb-1">
                  <span>Progress</span>
                  <span>{displayNodeProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/30 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-none"
                    style={{ width: `${Math.min(100, Math.max(0, displayNodeProgress))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-white/90 mt-2 mb-1">
                  <span>Overall</span>
                  <span>{overallProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/30 overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 transition-none"
                    style={{ width: `${Math.min(100, Math.max(0, overallProgress))}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {previewText && (
        <div className={`${previewImage ? "mt-3" : ""}`}>
          <pre
            className="w-full p-3 comfy-input text-base text-slate-300 opacity-60 whitespace-pre-wrap break-words font-sans"
            style={{ overflowAnchor: "none" }}
          >
            {previewText}
          </pre>
        </div>
      )}
    </div>
  );
}
