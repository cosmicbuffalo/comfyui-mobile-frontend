import { TrashIcon } from '@/components/icons';
import { useT } from '@/i18n';
import { OverlayCircleButton } from './OverlayCircleButton';

interface DeleteButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function DeleteButton({ onClick, disabled }: DeleteButtonProps) {
  const t = useT();
  return (
    <OverlayCircleButton
      onClick={onClick}
      disabled={disabled}
      title={disabled ? t("Favorited items can't be deleted") : undefined}
      ariaLabel={t('Delete output')}
      className="text-red-500"
      icon={<TrashIcon className="w-5 h-5 translate-x-[1px] -translate-y-[1px]" />}
    />
  );
}
