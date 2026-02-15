interface MediaViewerHeaderProps {
  index: number;
  total: number;
  displayName: string;
}

export function MediaViewerHeader({ index, total, displayName }: MediaViewerHeaderProps) {
  return (
    <div
      id="media-viewer-header"
      className="absolute top-0 inset-x-0 px-3 pt-3 pb-4 bg-gradient-to-b from-black/50 to-transparent"
    >
      <div className="grid grid-cols-3 items-center">
        <div className="flex items-center gap-3 text-white text-sm">
          {index + 1} / {total}
        </div>
        <div className="justify-self-center text-white/90 text-sm font-medium max-w-[70vw] truncate">
          {displayName}
        </div>
        <div />
      </div>
    </div>
  );
}
