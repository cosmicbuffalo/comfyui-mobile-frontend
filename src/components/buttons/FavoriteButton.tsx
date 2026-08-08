import { HeartIcon, HeartOutlineIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface FavoriteButtonProps {
  onClick: () => void;
  isFavorited: boolean;
  /** Render as a bare icon (no disc) — used for the persistent state indicator. */
  bare?: boolean;
}

export function FavoriteButton({ onClick, isFavorited, bare }: FavoriteButtonProps) {
  return (
    <OverlayCircleButton
      onClick={onClick}
      // Favoriting is sticky — this button enters the favorited state but never
      // leaves it (use the reject/x affordance to unfavorite).
      ariaLabel={isFavorited ? 'Favorited' : 'Favorite'}
      ariaPressed={isFavorited}
      bare={bare}
      className={`text-white${bare ? ' drop-shadow' : ''}`}
      icon={
        isFavorited ? (
          <HeartIcon className="w-5 h-5 text-red-500" />
        ) : (
          <HeartOutlineIcon className="w-5 h-5" />
        )
      }
    />
  );
}
