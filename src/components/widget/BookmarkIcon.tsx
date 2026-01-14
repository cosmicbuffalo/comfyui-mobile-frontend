import { BookmarkIconSvg } from '@/components/icons';

interface BookmarkIconProps {
  isBookmarked: boolean;
  onToggle?: () => void;
}

export function BookmarkIcon({ isBookmarked, onToggle }: BookmarkIconProps) {
  if (!isBookmarked || !onToggle) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="flex items-center justify-center transition-colors text-yellow-500 hover:text-yellow-600"
      aria-label="Remove bookmark"
    >
      <BookmarkIconSvg className="w-5 h-5" />
    </button>
  );
}
