import { useEffect, useRef, useState } from 'react';
import { getImagePreviewUrl, uploadImageFile } from '@/api/client';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { registerWebcam } from '@/utils/webcamCapture';
import { splitPathAnnotation } from '@/utils/annotatedPath';
import { useI18n } from '@/i18n';
import { controlInlineButtonClassName as button } from './controlStyles';

export default function WebcamControl({ value, onChange, disabled, nodeKey, width = 0, height = 0 }: {
  value: unknown; onChange: (value: string) => void; disabled?: boolean; nodeKey?: string; width?: number; height?: number;
}) {
  const { t } = useI18n();
  const sessionId = useWorkflowStore(s => s.activeSessionId);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const unregister = useRef<(() => void) | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef({ width, height });
  useEffect(() => { latest.current = { width, height }; }, [width, height]);
  const stop = () => {
    generation.current++;
    unregister.current?.(); unregister.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  useEffect(() => () => stop(), []);
  useEffect(() => {
    const hidden = () => { if (document.hidden) { stop(); setActive(false); } };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  useEffect(() => { if (disabled) { stop(); setActive(false); } }, [disabled]);
  const capture = async (): Promise<string> => {
    const element = video.current;
    if (!element || !stream.current || !element.videoWidth || !element.videoHeight) throw new Error(t('Camera is not ready.'));
    const canvas = document.createElement('canvas');
    canvas.width = latest.current.width > 0 ? latest.current.width : element.videoWidth;
    canvas.height = latest.current.height > 0 ? latest.current.height : element.videoHeight;
    canvas.getContext('2d')!.drawImage(element, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(t('Unable to capture camera image.'))), 'image/png'));
    canvas.width = canvas.height = 1;
    const result = await uploadImageFile(new File([blob], `webcam-${crypto.randomUUID()}.png`, { type: 'image/png' }), { type: 'input', subfolder: 'webcam' });
    return [result.subfolder, result.name].filter(Boolean).join('/');
  };
  const start = async () => {
    const epoch = ++generation.current; setBusy(true); setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('Camera access requires HTTPS or localhost.'));
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (generation.current !== epoch) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream.current = acquired;
      if (video.current) { video.current.srcObject = acquired; await video.current.play(); }
      if (generation.current !== epoch) { acquired.getTracks().forEach(track => track.stop()); return; }
      setActive(true);
      if (nodeKey) unregister.current = registerWebcam(nodeKey, capture, sessionId);
    } catch (cause) { stop(); setActive(false); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  let image: string | undefined;
  if (typeof value === 'string' && value) { const parsed = splitPathAnnotation(value); const slash = parsed.path.lastIndexOf('/'); image = getImagePreviewUrl(parsed.path.slice(slash + 1), slash < 0 ? '' : parsed.path.slice(0, slash), parsed.type ?? 'input'); }
  return <section aria-label={t('Webcam capture')} className="my-3 space-y-2">
    {/* The node's full width at the feed's own shape: a height cap shrank a portrait feed sideways. */}
    <video ref={video} muted playsInline className={active ? 'block h-auto w-full rounded-lg' : 'hidden'} />
    {!active && image && <img src={image} alt={t('Captured camera image')} loading="lazy" className="block h-auto w-full rounded-lg" />}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled || busy} onClick={() => { if (active) { stop(); setActive(false); } else void start(); }}>{active ? t('Stop camera') : t('Start camera')}</button>
      <button type="button" className={button} disabled={disabled || busy || !active} onClick={async () => { const epoch = generation.current; setBusy(true); setError(''); try { const path = await capture(); if (generation.current === epoch) onChange(path); } catch (cause) { if (generation.current === epoch) setError(String(cause)); } finally { setBusy(false); } }}>{t('Capture image')}</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </section>;
}
