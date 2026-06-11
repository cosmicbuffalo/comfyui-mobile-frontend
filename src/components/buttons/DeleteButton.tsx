import { TrashIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface DeleteButtonProps {
  onClick: () => void;
}

export function DeleteButton({ onClick }: DeleteButtonProps) {
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel="Delete output"
      className="text-red-500"
      icon={<TrashIcon className="w-5 h-5 translate-x-[1px] -translate-y-[1px]" />}
    />
  );
}
