import { ChevronLeftBoldIcon, ChevronRightIcon } from "@/components/icons";

interface MediaViewerNavigationProps {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function MediaViewerNavigation({
  index,
  total,
  onPrev,
  onNext,
}: MediaViewerNavigationProps) {
  return (
    <div id="media-viewer-navigation" className="hidden sm:block">
      <button
        onClick={onPrev}
        disabled={index === 0}
        className="absolute left-3 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white disabled:opacity-0 transition-all pointer-events-auto"
      >
        <ChevronLeftBoldIcon className="w-8 h-8" />
      </button>
      <button
        onClick={onNext}
        disabled={index === total - 1}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white disabled:opacity-0 transition-all pointer-events-auto"
      >
        <ChevronRightIcon className="w-8 h-8" />
      </button>
    </div>
  );
}
