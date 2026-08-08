const reportedIssues = new WeakMap<HTMLVideoElement, Set<string>>();

// The reasons a completed generation's video was or wasn't allowed to
// auto-play, captured at the moment the item finished.
export interface QueueAutoplayEligibility {
  panelActive: boolean;
  hasVideoOutput: boolean;
  onScreen: boolean;
  userCollapsed: boolean;
  pinnedToNonVideoTab: boolean;
  ownerId: string | null;
}

// One structured line per queue-card autoplay decision. Eligibility is decided
// exactly once per arriving generation, so when a video unexpectedly did or
// didn't start on its own, this is the single log line to look for.
export function reportQueueAutoplayDecision(
  promptId: string,
  eligible: boolean,
  detail: QueueAutoplayEligibility,
): void {
  console.info('[video] Queue autoplay decision', { promptId, eligible, ...detail });
}

// video.play() rejections were previously swallowed, leaving no trace when a
// browser refused autoplay (power saving, data saver, missing user gesture).
export function reportVideoAutoplayRejection(
  context: string,
  src: string,
  error: unknown,
): void {
  console.warn('[video] Autoplay rejected', {
    context,
    src,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
}

// Keep video failure reports structured and consistent. In particular,
// readyState/networkState distinguish a codec failure from an interrupted or
// stalled range request when inspecting an affected device's console.
export function reportVideoPlaybackIssue(
  context: string,
  kind: 'error' | 'stalled',
  video: HTMLVideoElement,
): void {
  const reportedForElement = reportedIssues.get(video) ?? new Set<string>();
  if (reportedForElement.has(kind)) return;
  reportedForElement.add(kind);
  reportedIssues.set(video, reportedForElement);
  console.warn('[video] Playback issue', {
    context,
    kind,
    src: video.currentSrc || video.src,
    readyState: video.readyState,
    networkState: video.networkState,
    errorCode: video.error?.code ?? null,
    errorMessage: video.error?.message ?? null,
  });
}
