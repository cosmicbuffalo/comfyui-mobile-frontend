interface MediaViewerHeaderProps {
  index: number;
  total: number;
  displayName: string;
  resolution?: { width: number; height: number } | null;
}

export function MediaViewerHeader({ index, total, displayName, resolution }: MediaViewerHeaderProps) {
  return (
    <div
      id="media-viewer-header"
      className="absolute top-0 inset-x-0 px-3 pt-3 pb-8 bg-gradient-to-b from-black/85 via-black/45 to-transparent"
    >
      <div className="grid grid-cols-3 items-start">
        <div className="flex items-center gap-3 text-white text-sm">
          {index + 1} / {total}
        </div>
        <div className="justify-self-center text-center max-w-[70vw] min-w-0">
          <div className="text-white/90 text-sm font-medium truncate">
            {displayName}
          </div>
          {resolution && (
            <div className="media-viewer-resolution text-white/55 text-xs mt-0.5">
              {resolution.width} × {resolution.height}
            </div>
          )}
        </div>
        <div />
      </div>
    </div>
  );
}
