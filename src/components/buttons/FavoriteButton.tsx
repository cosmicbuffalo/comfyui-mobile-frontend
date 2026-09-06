import { HeartIcon, HeartOutlineIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';
import { useI18n } from '@/i18n';

interface FavoriteButtonProps {
  onClick: () => void;
  isFavorited: boolean;
  /** Let an active button remove the favorite instead of acting as a status-only control. */
  toggleable?: boolean;
  /** Render as a bare icon (no disc) — used for the persistent state indicator. */
  bare?: boolean;
}

export function FavoriteButton({ onClick, isFavorited, toggleable = false, bare }: FavoriteButtonProps) {
  const { t } = useI18n();
  return (
    <OverlayCircleButton
      onClick={onClick}
      // Viewer favorites are sticky (its reject/x affordance removes them),
      // while card controls opt into direct toggle behavior.
      ariaLabel={isFavorited && toggleable ? t('Unfavorite') : isFavorited ? t('Favorited') : t('Favorite')}
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
