import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getImageUrl } from '@/api/client';
import type {
  DenoVideoCompareAudio,
  DenoVideoCompareMetadata,
  NodeComparerOutput,
} from '@/hooks/useWorkflow';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useI18n } from '@/i18n';

interface DenoVideoCompareProps {
  output: NodeComparerOutput;
  displayName: string;
  onWidgetChange?: (
    widgetName: 'mode' | 'split_position' | 'toggle_image' | 'swap',
    value: string | number | boolean,
  ) => void;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const hundredths = Math.floor((safe * 100) % 100);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function audioUrl(audio: DenoVideoCompareAudio, subfolder: string): string {
  return getImageUrl(audio.filename, subfolder, 'temp');
}

/** Mobile implementation of DenoVideoCompare's encoder-free frame player.
 * Both WebP sequences share one virtual clock, so slider/SxS/difference/toggle
 * remain frame-locked without creating a lossy intermediary video. */
export function DenoVideoCompare({
  output,
  displayName,
  onWidgetChange,
}: DenoVideoCompareProps) {
  const { t } = useI18n();
  const metadata = output.video as DenoVideoCompareMetadata;
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState(metadata.mode);
  const [split, setSplit] = useState(metadata.splitPosition * 100);
  const [toggleSide, setToggleSide] = useState<'A' | 'B'>(metadata.toggleImage);
  const [swapped, setSwapped] = useState(metadata.swapped);
  const [playing, setPlaying] = useState(metadata.mode !== 'Toggle');
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [visible, setVisible] = useState(true);
  const [audioSide, setAudioSide] = useState<'off' | 'A' | 'B'>('off');
  const viewerOpen = useImageViewerStore((state) => state.viewerOpen);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBuffersRef = useRef<Partial<Record<'A' | 'B', AudioBuffer>>>({});
  const audioGenerationRef = useRef(0);
  const audioFetchControllersRef = useRef<Set<AbortController>>(new Set());
  const audioPlaybackAllowedRef = useRef(false);

  const duration = metadata.duration > 0
    ? metadata.duration
    : metadata.frameCount / Math.max(0.01, metadata.fps);
  const frameCount = Math.max(metadata.frameCount, output.a.length, output.b.length, 1);
  const frameIndex = Math.min(
    frameCount - 1,
    Math.max(0, Math.floor((time / Math.max(duration, 1 / metadata.fps)) * frameCount)),
  );
  const identity = [
    metadata.subfolder,
    output.a.length,
    output.a[0]?.filename ?? '',
    output.a.at(-1)?.filename ?? '',
    output.b.length,
    output.b[0]?.filename ?? '',
    output.b.at(-1)?.filename ?? '',
    metadata.audioA?.filename ?? '',
    metadata.audioB?.filename ?? '',
  ].join('|');

  useEffect(() => {
    setMode(metadata.mode);
    setSplit(metadata.splitPosition * 100);
    setToggleSide(metadata.toggleImage);
    setSwapped(metadata.swapped);
    setPlaying(metadata.mode !== 'Toggle');
    setTime(0);
  }, [identity, metadata.mode, metadata.splitPosition, metadata.swapped, metadata.toggleImage]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio > 0));
    }, { threshold: 0.01 });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible || viewerOpen || duration <= 0) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.min(0.25, Math.max(0, (now - previous) / 1000));
      previous = now;
      setTime((current) => {
        const next = current + delta * speed;
        if (next < duration) return next;
        if (loop) return next % duration;
        setPlaying(false);
        return duration;
      });
    }, 33);
    return () => window.clearInterval(timer);
  }, [duration, loop, playing, speed, viewerOpen, visible]);

  const stopAudio = useCallback(() => {
    try { audioSourceRef.current?.stop(); } catch { /* source already stopped */ }
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
  }, []);

  const cancelPendingAudio = useCallback(() => {
    audioGenerationRef.current += 1;
    for (const controller of audioFetchControllersRef.current) controller.abort();
    audioFetchControllersRef.current.clear();
  }, []);

  useEffect(() => {
    // Deno creates a fresh temp subfolder for every execution. A buffer from
    // the preceding output must never be reused merely because it is on the
    // same logical A/B side, and an older in-flight fetch must not populate the
    // cache after the replacement has rendered.
    audioPlaybackAllowedRef.current = false;
    cancelPendingAudio();
    stopAudio();
    audioBuffersRef.current = {};
  }, [cancelPendingAudio, identity, stopAudio]);

  const loadAudioBuffer = useCallback(async (
    side: 'A' | 'B',
    audio: DenoVideoCompareAudio,
    generation: number,
  ): Promise<AudioBuffer | null> => {
    if (audioBuffersRef.current[side]) return audioBuffersRef.current[side] ?? null;
    const AudioContextCtor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;
    const controller = new AbortController();
    audioFetchControllersRef.current.add(controller);
    try {
      const response = await fetch(audioUrl(audio, metadata.subfolder), {
        signal: controller.signal,
      });
      if (
        !response.ok ||
        controller.signal.aborted ||
        generation !== audioGenerationRef.current
      ) return null;
      const raw = await response.arrayBuffer();
      if (controller.signal.aborted || generation !== audioGenerationRef.current) return null;
      const floats = new Float32Array(raw);
      const samples = Math.min(audio.samples, Math.floor(floats.length / audio.channels));
      if (samples <= 0) return null;
      const buffer = context.createBuffer(audio.channels, samples, audio.sample_rate);
      for (let channel = 0; channel < audio.channels; channel += 1) {
        buffer.copyToChannel(
          floats.subarray(channel * samples, (channel + 1) * samples),
          channel,
        );
      }
      if (controller.signal.aborted || generation !== audioGenerationRef.current) return null;
      audioBuffersRef.current[side] = buffer;
      return buffer;
    } catch (error) {
      if (controller.signal.aborted || generation !== audioGenerationRef.current) return null;
      console.warn('[Deno Video Compare] Audio preview failed to load:', error);
      return null;
    } finally {
      audioFetchControllersRef.current.delete(controller);
    }
  }, [metadata.subfolder]);

  const startAudio = useCallback(async (side: 'A' | 'B', offset: number) => {
    cancelPendingAudio();
    stopAudio();
    const generation = audioGenerationRef.current;
    const sourceSide = swapped ? (side === 'A' ? 'B' : 'A') : side;
    const audio = sourceSide === 'A' ? metadata.audioA : metadata.audioB;
    if (!audio) return;
    const buffer = await loadAudioBuffer(sourceSide, audio, generation);
    const context = audioContextRef.current;
    if (
      !buffer ||
      !context ||
      generation !== audioGenerationRef.current ||
      !audioPlaybackAllowedRef.current
    ) return;
    try {
      await context.resume();
    } catch {
      return;
    }
    if (generation !== audioGenerationRef.current || !audioPlaybackAllowedRef.current) return;
    stopAudio();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    source.loop = loop;
    source.connect(context.destination);
    source.start(0, Math.min(offset, Math.max(0, buffer.duration - 0.001)));
    audioSourceRef.current = source;
  }, [cancelPendingAudio, loadAudioBuffer, loop, metadata.audioA, metadata.audioB, speed, stopAudio, swapped]);

  useEffect(() => {
    const allowed = audioSide !== 'off' && playing && visible && !viewerOpen;
    audioPlaybackAllowedRef.current = allowed;
    if (!allowed) {
      cancelPendingAudio();
      stopAudio();
      return;
    }
    void startAudio(audioSide, time);
    return () => {
      audioPlaybackAllowedRef.current = false;
      cancelPendingAudio();
      stopAudio();
    };
    // Restart only on explicit transport/audio changes, not every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSide, cancelPendingAudio, identity, loop, playing, speed, stopAudio, swapped, viewerOpen, visible]);

  useEffect(() => () => {
    audioPlaybackAllowedRef.current = false;
    cancelPendingAudio();
    stopAudio();
    void audioContextRef.current?.close();
  }, [cancelPendingAudio, stopAudio]);

  const sideA = swapped ? output.b : output.a;
  const sideB = swapped ? output.a : output.b;
  const a = sideA[Math.min(frameIndex, Math.max(0, sideA.length - 1))] ?? null;
  const b = sideB[Math.min(frameIndex, Math.max(0, sideB.length - 1))] ?? null;
  const aSrc = a ? getImageUrl(a.filename, a.subfolder, a.type) : null;
  const bSrc = b ? getImageUrl(b.filename, b.subfolder, b.type) : null;
  const displayedToggle = toggleSide === 'A' ? aSrc : bSrc;

  const stage = useMemo(() => {
    const common = 'block h-auto w-full select-none object-contain';
    if (mode === 'Side by Side') {
      return (
        <div className="deno-compare-side-by-side grid grid-cols-2 gap-1 bg-black">
          {aSrc && <img src={aSrc} alt={`${displayName} A`} className={common} draggable={false} />}
          {bSrc && <img src={bSrc} alt={`${displayName} B`} className={common} draggable={false} />}
        </div>
      );
    }
    if (mode === 'Toggle') {
      return displayedToggle ? (
        <button
          type="button"
          className="block w-full bg-black"
          onClick={() => {
            const next = toggleSide === 'A' ? 'B' : 'A';
            setToggleSide(next);
            onWidgetChange?.('toggle_image', next);
          }}
          aria-label={t('Showing video {side}; tap to toggle', { side: toggleSide })}
        >
          <img src={displayedToggle} alt={`${displayName} ${toggleSide}`} className={common} draggable={false} />
        </button>
      ) : null;
    }
    if (!aSrc && !bSrc) return null;
    const base = bSrc ?? aSrc!;
    return (
      <div className="relative overflow-hidden bg-black">
        <img src={base} alt={`${displayName} B`} className={common} draggable={false} />
        {aSrc && bSrc && (
          <img
            src={aSrc}
            alt={`${displayName} A`}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            draggable={false}
            style={mode === 'Difference'
              ? { mixBlendMode: 'difference' }
              : { clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
        )}
        {mode === 'Slider' && aSrc && bSrc && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-emerald-300"
            style={{ left: `${split}%` }}
          />
        )}
      </div>
    );
  }, [aSrc, bSrc, displayName, displayedToggle, mode, onWidgetChange, split, toggleSide, t]);

  const stepFrame = (amount: number) => {
    setPlaying(false);
    setTime((current) => Math.max(0, Math.min(duration, current + amount / metadata.fps)));
  };

  return (
    <div ref={rootRef} className="mb-3 overflow-hidden rounded-lg border border-emerald-400/30 bg-slate-950" data-deno-video-compare>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-emerald-400/20 p-2">
        {(['Slider', 'Side by Side', 'Difference', 'Toggle'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`rounded-full border px-2 py-1 text-[11px] ${mode === value ? 'border-emerald-300 bg-emerald-500/25 text-emerald-100' : 'border-white/15 text-slate-300'}`}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              onWidgetChange?.('mode', value);
              if (value === 'Toggle') setPlaying(false);
            }}
          >
            {t(value)}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto rounded border border-white/15 px-2 py-1 text-xs"
          onClick={() => {
            const next = !swapped;
            setSwapped(next);
            onWidgetChange?.('swap', next);
          }}
        >
          {t('Swap A/B')}
        </button>
        <button type="button" className="rounded border border-white/15 px-2 py-1 text-xs" onClick={() => void rootRef.current?.requestFullscreen?.()}>
          Fullscreen
        </button>
      </div>
      <div className="relative">
        {stage}
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-0.5 text-[10px] text-white">{swapped ? 'B' : 'A'}</span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/65 px-2 py-0.5 text-[10px] text-white">{swapped ? 'A' : 'B'}</span>
        {metadata.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center text-sm text-red-200">{metadata.error}</div>
        )}
      </div>
      {mode === 'Slider' && (
        <input
          type="range"
          min={2}
          max={98}
          step={1}
          value={split}
          aria-label={t('Comparison split')}
          onChange={(event) => {
            const next = Number(event.target.value);
            setSplit(next);
            onWidgetChange?.('split_position', next / 100);
          }}
          className="mx-2 mt-2 w-[calc(100%-1rem)] accent-emerald-400"
        />
      )}
      <div className="space-y-2 border-t border-emerald-400/20 p-2">
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={1 / Math.max(metadata.fps, 1)}
          value={Math.min(time, duration)}
          aria-label={t('Video comparison timeline')}
          onChange={(event) => {
            setTime(Number(event.target.value));
            if (audioSide !== 'off' && playing && visible && !viewerOpen) {
              audioPlaybackAllowedRef.current = true;
              void startAudio(audioSide, Number(event.target.value));
            }
          }}
          className="w-full accent-emerald-400"
        />
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-200">
          <button type="button" className="rounded border border-white/15 px-2 py-1" onClick={() => stepFrame(-1)} aria-label={t('Previous frame')}>−1f</button>
          <button type="button" className="rounded border border-white/15 px-3 py-1" onClick={() => setPlaying((value) => !value)}>{playing ? t('Pause') : t('Play')}</button>
          <button type="button" className="rounded border border-white/15 px-2 py-1" onClick={() => stepFrame(1)} aria-label={t('Next frame')}>+1f</button>
          <select value={speed} aria-label={t('Playback speed')} className="rounded border border-white/15 bg-slate-900 px-1 py-1" onChange={(event) => setSpeed(Number(event.target.value))}>
            {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
          <button type="button" className={`rounded border px-2 py-1 ${loop ? 'border-emerald-300 text-emerald-200' : 'border-white/15'}`} aria-pressed={loop} onClick={() => setLoop((value) => !value)}>{t('Loop')}</button>
          {(metadata.audioA || metadata.audioB) && (
            <select value={audioSide} aria-label={t('Comparison audio')} className="rounded border border-white/15 bg-slate-900 px-1 py-1" onChange={(event) => setAudioSide(event.target.value as 'off' | 'A' | 'B')}>
              <option value="off">{t('Muted')}</option>
              {metadata.audioA && <option value="A">{t('Audio A')}</option>}
              {metadata.audioB && <option value="B">{t('Audio B')}</option>}
            </select>
          )}
          <span className="ml-auto tabular-nums text-slate-400">{formatTime(time)} / {formatTime(duration)}</span>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
          <span>{t('{count} frames', { count: metadata.frameCount })}</span>
          <span>{Math.round(metadata.sourceFps * 100) / 100} fps</span>
          {metadata.aSourceWidth > 0 && <span>A {metadata.aSourceWidth}×{metadata.aSourceHeight} · {metadata.aSourceCount}f</span>}
          {metadata.bSourceWidth > 0 && <span>B {metadata.bSourceWidth}×{metadata.bSourceHeight} · {metadata.bSourceCount}f</span>}
        </div>
      </div>
    </div>
  );
}
