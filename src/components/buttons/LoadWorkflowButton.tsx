import { ProgressRingWithTrack, WorkflowIcon } from '@/components/icons';
import { useT } from '@/i18n';
import { OverlayCircleButton } from './OverlayCircleButton';

interface LoadWorkflowButtonProps {
  onClick: () => void;
  progress?: number | null;
}

export function LoadWorkflowButton({ onClick, progress }: LoadWorkflowButtonProps) {
  const t = useT();
  const isLoading = progress != null;
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel={t('Load workflow')}
      disabled={isLoading}
      className="relative text-white"
      icon={(
        <>
          <WorkflowIcon className="w-5 h-5" />
          {isLoading && (
            <ProgressRingWithTrack
              progress={progress}
              className="absolute inset-0 w-full h-full -rotate-90"
              trackColor="rgb(255 255 255 / 0.22)"
              progressColor="rgb(103 232 249)"
            />
          )}
        </>
      )}
    />
  );
}
