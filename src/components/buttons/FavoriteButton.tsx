import { HeartIcon, HeartOutlineIcon } from '@/components/icons';

interface FavoriteButtonProps {
  onClick: () => void;
  isFavorited: boolean;
}

export function FavoriteButton({ onClick, isFavorited }: FavoriteButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isFavorited ? 'Unfavorite' : 'Favorite'}
      aria-pressed={isFavorited}
      className="pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
    >
      {isFavorited ? (
        <HeartIcon className="w-5 h-5 text-red-500" />
      ) : (
        <HeartOutlineIcon className="w-5 h-5" />
      )}
    </button>
  );
}
