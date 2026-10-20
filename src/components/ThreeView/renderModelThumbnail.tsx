import { createRoot } from 'react-dom/client';
import ModelViewer from './ModelViewer';

/**
 * Render a model once in a hidden viewer and resolve its snapshot. The host
 * stays inside the viewport because the renderer skips frames it cannot see.
 */
export function renderModelThumbnail(src: string, filename: string, timeoutMs = 20000): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:0;bottom:0;width:256px;height:256px;opacity:0;pointer-events:none;z-index:-1';
    document.body.append(host);
    const root = createRoot(host);
    let settled = false;
    const finish = (snapshot: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Unmount outside React's commit so the viewer's own teardown runs normally.
      setTimeout(() => { root.unmount(); host.remove(); });
      if (snapshot) resolve(snapshot);
      else reject(new Error(`No thumbnail for ${filename}`));
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    root.render(<ModelViewer src={src} filename={filename} onCapture={finish} onError={() => finish(null)} />);
  });
}
