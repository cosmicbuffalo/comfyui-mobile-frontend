import { t } from '@/i18n';

export function getQueueCardHeaderLabel({
  isGenerating,
  isCompleting,
  isPending,
  isStopped,
  isErrored,
  preferredOutputFilename,
}: {
  isGenerating: boolean;
  isCompleting: boolean;
  isPending: boolean;
  // A run the user interrupted / that otherwise didn't finish without erroring.
  isStopped: boolean;
  // A run that ended on an execution error.
  isErrored: boolean;
  preferredOutputFilename: string | null;
}): string | null {
  if (isGenerating) return t('GENERATING');
  if (isCompleting) return preferredOutputFilename ?? t('LOADING...');
  if (isPending) return t('PENDING');
  if (isStopped) return t('STOPPED');
  if (isErrored) return t('ERROR');
  return preferredOutputFilename;
}

export function getQueueCardHeaderGridClass(isDone: boolean): string {
  return isDone
    ? 'grid-cols-[2rem_minmax(0,1fr)_2rem]'
    : 'grid-cols-[minmax(4.5rem,1fr)_minmax(0,12rem)_minmax(4.5rem,1fr)]';
}
