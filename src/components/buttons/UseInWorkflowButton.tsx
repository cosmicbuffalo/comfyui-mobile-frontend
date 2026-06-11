import { ThickArrowRightIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface UseInWorkflowButtonProps {
  onClick: () => void;
}

export function UseInWorkflowButton({ onClick }: UseInWorkflowButtonProps) {
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel="Use in workflow"
      className="text-white"
      icon={<ThickArrowRightIcon className="w-5 h-5" />}
    />
  );
}
