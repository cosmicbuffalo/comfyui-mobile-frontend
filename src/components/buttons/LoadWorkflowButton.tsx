import { ProgressRingWithTrack, WorkflowIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface LoadWorkflowButtonProps {
  onClick: () => void;
  progress?: number | null;
}

export function LoadWorkflowButton({ onClick, progress }: LoadWorkflowButtonProps) {
  const isLoading = progress != null;
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel="Load workflow"
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
