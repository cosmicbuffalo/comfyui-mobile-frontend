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
  if (isGenerating) return 'GENERATING';
  if (isCompleting) return preferredOutputFilename ?? 'LOADING...';
  if (isPending) return 'PENDING';
  if (isStopped) return 'STOPPED';
  if (isErrored) return 'ERROR';
  return preferredOutputFilename;
}

export function getQueueCardHeaderGridClass(isDone: boolean): string {
  return isDone
    ? 'grid-cols-[2rem_minmax(0,1fr)_2rem]'
    : 'grid-cols-[minmax(4.5rem,1fr)_minmax(0,12rem)_minmax(4.5rem,1fr)]';
}
