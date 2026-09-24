import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useOutputsStore } from '@/hooks/useOutputs';

/**
 * Whether a full-screen media viewer is on top of the app right now.
 *
 * There are two of them and they do not share a flag: the app-level
 * `ImageViewer` drives `useImageViewerStore`, while the outputs panel mounts
 * its own `MediaViewer` from local state and mirrors that into the outputs
 * store as `outputsViewerOpen`. Anything that has to paint *above* the viewer —
 * or decide whether it is covered — has to ask about both, and asking about
 * only the first is how a confirmation ends up rendered underneath the outputs
 * viewer's overlay.
 */
export function useAnyMediaViewerOpen(): boolean {
  const appViewerOpen = useImageViewerStore((state) => state.viewerOpen);
  const outputsViewerOpen = useOutputsStore((state) => state.outputsViewerOpen);
  return appViewerOpen || outputsViewerOpen;
}

/** The same question outside of render. */
export function isAnyMediaViewerOpen(): boolean {
  return useImageViewerStore.getState().viewerOpen
    || useOutputsStore.getState().outputsViewerOpen;
}
