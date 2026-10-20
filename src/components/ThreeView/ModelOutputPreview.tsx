import { Suspense, useEffect, useRef, useState } from 'react';
import { lazyPanel } from '@/components/lazyPanel';
import type { HistoryOutputImage } from '@/api/types';
import { getImageUrl } from '@/api/client';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useI18n } from '@/i18n';
import { shareOrDownloadFile } from '@/utils/downloads';
import { canSaveFile } from '@/utils/nativeSave';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import { DownloadIcon, FullscreenIcon } from '@/components/icons';

const overlayButton = 'grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-slate-950/80 text-slate-100 shadow-lg backdrop-blur-sm hover:text-cyan-300';

const ModelViewer = lazyPanel(() => import('./ModelViewer'), { prefetch: false });
export function ModelOutputPreview({ output, onReady, onError, onExpand, className = 'my-2 rounded-lg border border-white/10' }: {
  output: HistoryOutputImage; onReady?: () => void; onError?: () => void; onExpand: () => void;
  /** Frame and spacing; a queue card draws its outputs edge to edge. */
  className?: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const lowResourceMode = useGenerationSettingsStore(s => s.lowResourceMode);
  // The full-screen viewer renders its own copy; don't keep a second WebGL view alive underneath it.
  const viewerOpen = useImageViewerStore(s => s.viewerOpen);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const src = getImageUrl(output.filename, output.subfolder, output.type, output.cacheToken);
  const ready = useRef(onReady);
  useEffect(() => { ready.current = onReady; }, [onReady]);
  useEffect(() => {
    if (lowResourceMode) ready.current?.();
  }, [lowResourceMode, src]);
  return <section ref={container} className={`relative overflow-hidden ${className}`} aria-label={t('3D output {name}', { name: output.filename })}>
    <div className="h-80">{lowResourceMode
      ? <div className="h-full grid place-items-center text-slate-400">3D</div>
      // The viewer's own controls keep the left; the round buttons take the bottom right.
      : visible && !viewerOpen && <Suspense fallback={<div className="h-72">{t('Loading 3D viewer…')}</div>}><ModelViewer src={src} filename={output.filename} metadata={output.model3d} onReady={onReady} onError={onError} pageScroll toolbarClassName="bottom-2 left-2 right-28" /></Suspense>}</div>
    <div className="absolute bottom-2 right-2 flex gap-2">
      {canSaveFile(output.filename) && <button type="button" aria-label={t('Download')} className={overlayButton}
        onClick={() => void shareOrDownloadFile(src, output.filename)}><DownloadIcon className="h-5 w-5" /></button>}
      <button type="button" aria-label={t('Expand')} className={overlayButton} onClick={onExpand}><FullscreenIcon className="h-5 w-5" /></button>
    </div>
  </section>;
}
