import { ThickArrowRightIcon } from '@/components/icons';

interface UseInWorkflowButtonProps {
  onClick: () => void;
}

export function UseInWorkflowButton({ onClick }: UseInWorkflowButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Use in workflow"
      className="pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
    >
      <ThickArrowRightIcon className="w-5 h-5" />
    </button>
  );
}
