import { getImageUrl } from '@/api/client';

interface NodeCardOutputPreviewProps {
  show: boolean;
  previewImage: { filename: string; subfolder: string; type: string } | null;
  previewText?: string | null;
  displayName: string;
  onImageClick?: () => void;
  isExecuting: boolean;
  overallProgress: number | null;
  displayNodeProgress: number;
}

export function NodeCardOutputPreview({
  show,
  previewImage,
  previewText = null,
  displayName,
  onImageClick,
  isExecuting,
  overallProgress,
  displayNodeProgress
}: NodeCardOutputPreviewProps) {
  if (!show || (!previewImage && !previewText)) return null;

  return (
    <div className="mb-3">
      <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">
        Output Preview
      </div>
      {previewImage && (
        <div className="relative">
          <img
            key={`preview`}
            src={getImageUrl(previewImage.filename, previewImage.subfolder, previewImage.type)}
            alt={`${displayName} output`}
            className="w-full h-auto rounded-lg border border-gray-100"
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
                    className="h-full bg-green-500 transition-none"
                    style={{ width: `${Math.min(100, Math.max(0, displayNodeProgress))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-white/90 mt-2 mb-1">
                  <span>Overall</span>
                  <span>{overallProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/30 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-none"
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
            className="w-full p-3 comfy-input text-base text-gray-600 opacity-60 whitespace-pre-wrap break-words font-sans"
            style={{ overflowAnchor: "none" }}
          >
            {previewText}
          </pre>
        </div>
      )}
    </div>
  );
}
