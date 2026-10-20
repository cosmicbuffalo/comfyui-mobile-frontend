import { Suspense, useEffect, useRef, useState } from 'react';
import { lazyPanel } from '@/components/lazyPanel';
import type { HistoryOutputImage } from '@/api/types';
import { getImageUrl } from '@/api/client';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useI18n } from '@/i18n';
import { shareOrDownloadFile } from '@/utils/downloads';
import { canSaveFile } from '@/utils/nativeSave';

const ModelViewer = lazyPanel(() => import('./ModelViewer'), { prefetch: false });
export function ModelOutputPreview({ output, onReady, onError, onExpand }: { output: HistoryOutputImage; onReady?: () => void; onError?: () => void; onExpand: () => void }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
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
  return <section ref={container} className="my-2 rounded-lg border border-white/10 overflow-hidden" aria-label={t('3D output {name}', { name: output.filename })}>
    <div className="h-80">{visible && !viewerOpen && <Suspense fallback={<div className="h-72">{t('Loading 3D viewer…')}</div>}><ModelViewer src={src} filename={output.filename} metadata={output.model3d} onReady={onReady} onError={onError} pageScroll /></Suspense>}</div>
    <div className="flex items-center gap-3 bg-slate-900 p-2 text-xs">
      <span className="mr-auto truncate">{output.filename}</span>
      {canSaveFile(output.filename) && <button type="button" onClick={() => void shareOrDownloadFile(src, output.filename)}>{t('Download')}</button>}
      <button type="button" onClick={onExpand}>{t('Expand')}</button>
    </div>
  </section>;
}
