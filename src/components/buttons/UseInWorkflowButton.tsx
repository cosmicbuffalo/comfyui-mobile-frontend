import { ThickArrowRightIcon } from '@/components/icons';
import { useT } from '@/i18n';
import { OverlayCircleButton } from './OverlayCircleButton';

interface UseInWorkflowButtonProps {
  onClick: () => void;
}

export function UseInWorkflowButton({ onClick }: UseInWorkflowButtonProps) {
  const t = useT();
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel={t('Use in workflow')}
      className="text-white"
      icon={<ThickArrowRightIcon className="w-5 h-5" />}
    />
  );
}
