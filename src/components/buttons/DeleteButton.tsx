import { TrashIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface DeleteButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function DeleteButton({ onClick, disabled }: DeleteButtonProps) {
  return (
    <OverlayCircleButton
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Favorited items can't be deleted" : undefined}
      ariaLabel="Delete output"
      className="text-red-500"
      icon={<TrashIcon className="w-5 h-5 translate-x-[1px] -translate-y-[1px]" />}
    />
  );
}
