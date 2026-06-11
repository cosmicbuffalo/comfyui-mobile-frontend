import { useWorkflowStore } from '@/hooks/useWorkflow';
import { InfiniteLoopIcon } from '@/components/icons';
import { appChromeIconButtonActiveClassName, appChromeIconButtonClassName, chromeBarButtonClassName } from '@/components/chromeStyles';

export function InfiniteLoopToggle() {
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const setInfiniteLoop = useWorkflowStore((s) => s.setInfiniteLoop);

  return (
    <button
      onClick={() => setInfiniteLoop(!infiniteLoop)}
      title={infiniteLoop ? 'Disable infinite loop' : 'Enable infinite loop'}
      className={
        `${chromeBarButtonClassName} `
        + (infiniteLoop
          ? appChromeIconButtonActiveClassName
          : appChromeIconButtonClassName)
      }
      aria-label={infiniteLoop ? 'Disable infinite loop' : 'Enable infinite loop'}
    >
      <InfiniteLoopIcon className="w-7 h-7" />
    </button>
  );
}
