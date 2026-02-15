import { WorkflowIcon } from '@/components/icons';

interface LoadWorkflowButtonProps {
  onClick: () => void;
}

export function LoadWorkflowButton({ onClick }: LoadWorkflowButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Load workflow"
      className="pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
    >
      <WorkflowIcon className="w-5 h-5" />
    </button>
  );
}
