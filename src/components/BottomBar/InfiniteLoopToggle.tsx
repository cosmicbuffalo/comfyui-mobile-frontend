import { useWorkflowStore } from '@/hooks/useWorkflow';
import { InfiniteLoopIcon } from '@/components/icons';
import { appChromeIconButtonActiveClassName, appChromeIconButtonClassName, chromeBarButtonClassName } from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

export function InfiniteLoopToggle() {
  const { t } = useI18n();
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const setInfiniteLoop = useWorkflowStore((s) => s.setInfiniteLoop);

  return (
    <button
      onClick={() => setInfiniteLoop(!infiniteLoop)}
      title={infiniteLoop ? t('Disable infinite loop') : t('Enable infinite loop')}
      className={
        `${chromeBarButtonClassName} `
        + (infiniteLoop
          ? appChromeIconButtonActiveClassName
          : appChromeIconButtonClassName)
      }
      aria-label={infiniteLoop ? t('Disable infinite loop') : t('Enable infinite loop')}
    >
      <InfiniteLoopIcon className="w-7 h-7" />
    </button>
  );
}
