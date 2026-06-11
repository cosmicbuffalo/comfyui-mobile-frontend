import { HeartIcon, HeartOutlineIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface FavoriteButtonProps {
  onClick: () => void;
  isFavorited: boolean;
}

export function FavoriteButton({ onClick, isFavorited }: FavoriteButtonProps) {
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel={isFavorited ? 'Unfavorite' : 'Favorite'}
      ariaPressed={isFavorited}
      className="text-white"
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
