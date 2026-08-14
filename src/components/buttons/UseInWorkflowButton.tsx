import { ThickArrowRightIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';
import { useI18n } from '@/i18n';

interface UseInWorkflowButtonProps {
  onClick: () => void;
}

export function UseInWorkflowButton({ onClick }: UseInWorkflowButtonProps) {
  const { t } = useI18n();
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel={t('Use in workflow')}
      className="text-white"
      icon={<ThickArrowRightIcon className="w-5 h-5" />}
    />
  );
}
