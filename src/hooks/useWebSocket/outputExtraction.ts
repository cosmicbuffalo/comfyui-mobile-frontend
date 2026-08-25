import type { HistoryOutputImage } from '@/api/types';
import type {
  DenoVideoCompareAudio,
  DenoVideoCompareMetadata,
  NodeComparerOutput,
} from '../useWorkflow';

export function extractTextPreviewFromOutput(output: Record<string, unknown>): string | null {
  const preferredKeys = ['text', 'string', 'strings', 'result', 'value', '__value__', 'ui'];
  const mediaContainerKeys = new Set([
    'images',
    'image',
    'videos',
    'video',
    'gifs',
    'audio',
    'filename',
    'filenames',
    'subfolder',
    'type',
  ]);

  const findString = (
    value: unknown,
    depth: number,
    contextKey?: string
  ): string | null => {
    if (depth > 5 || value == null) return null;
    if (contextKey && mediaContainerKeys.has(contextKey)) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findString(entry, depth + 1, contextKey);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of preferredKeys) {
        if (!(key in record)) continue;
        const found = findString(record[key], depth + 1, key);
        if (found) return found;
      }
    }
    return null;
  };

  return findString(output, 0);
}

/**
 * Standard ComfyUI video producers are not consistent about the UI bucket they
 * use: core SaveVideo currently publishes MP4 under `images`, VideoHelperSuite
 * uses `gifs`, and other nodes use `videos`. Normalize all three in their wire
 * order and de-duplicate descriptors before the workflow/queue consumers see
 * them. Filename classification happens at render time, where the actual media
 * extension is more reliable than the bucket name.
 */
export function collectExecutedMediaOutputs(
  output: Record<string, unknown>,
  executionCacheToken?: string | number,
): HistoryOutputImage[] {
  const media: HistoryOutputImage[] = [];
  const seen = new Set<string>();
  for (const key of ['images', 'gifs', 'videos', 'deno_video_preview'] as const) {
    const candidates = output[key];
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const descriptor = candidate as Partial<HistoryOutputImage>;
      if (
        typeof descriptor.filename !== 'string' ||
        typeof descriptor.subfolder !== 'string' ||
        typeof descriptor.type !== 'string'
      ) continue;
      const normalized: HistoryOutputImage = {
        ...(candidate as HistoryOutputImage),
        // Every execution gets its own browser-cache identity. This matters for
        // ordinary outputs too: ComfyUI may reuse a path whose previous file
        // was moved outside the app, where our delete invalidation cannot run.
        ...(executionCacheToken !== undefined && descriptor.cacheToken === undefined
          ? { cacheToken: executionCacheToken }
          : {}),
      };
      const identity = `${descriptor.type}/${descriptor.subfolder}/${descriptor.filename}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      media.push(normalized);
    }
  }
  return media;
}

export function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function denoAudio(value: unknown): DenoVideoCompareAudio | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const audio = value as Record<string, unknown>;
  if (typeof audio.filename !== 'string' || !audio.filename) return null;
  return {
    filename: audio.filename,
    channels: Math.max(1, Math.trunc(finiteNumber(audio.channels, 1))),
    samples: Math.max(0, Math.trunc(finiteNumber(audio.samples))),
    sample_rate: Math.max(1, Math.trunc(finiteNumber(audio.sample_rate, 44100))),
    dtype: typeof audio.dtype === 'string' ? audio.dtype : undefined,
    layout: typeof audio.layout === 'string' ? audio.layout : undefined,
  };
}

/** Normalize Deno's encoder-free frame-sequence comparison payload into the
 * existing node comparer store, retaining its virtual-clock/audio metadata for
 * the dedicated workflow-card player. */
export function collectDenoVideoCompareOutput(
  output: Record<string, unknown>,
): NodeComparerOutput | null {
  const list = output.deno_video_compare;
  if (!Array.isArray(list) || !list[0] || typeof list[0] !== 'object') return null;
  const meta = list[0] as Record<string, unknown>;
  const subfolder = typeof meta.subfolder === 'string' ? meta.subfolder : '';
  const descriptors = (value: unknown): HistoryOutputImage[] => (
    Array.isArray(value)
      ? value.filter((filename): filename is string => typeof filename === 'string' && !!filename)
        .map((filename) => ({ filename, subfolder, type: 'temp' }))
      : []
  );
  const a = descriptors(meta.files_a);
  const b = descriptors(meta.files_b);
  const allowedModes = new Set(['Slider', 'Side by Side', 'Difference', 'Toggle']);
  const mode = allowedModes.has(String(meta.mode))
    ? String(meta.mode) as DenoVideoCompareMetadata['mode']
    : 'Slider';
  const video: DenoVideoCompareMetadata = {
    mode,
    splitPosition: Math.max(0.02, Math.min(0.98, finiteNumber(meta.split_position, 0.5))),
    toggleImage: meta.toggle_image === 'A' ? 'A' : 'B',
    swapped: Boolean(meta.swap),
    fps: Math.max(0.01, finiteNumber(meta.fps, 24)),
    sourceFps: Math.max(0.01, finiteNumber(meta.source_fps, finiteNumber(meta.fps, 24))),
    duration: Math.max(0, finiteNumber(meta.duration)),
    frameCount: Math.max(0, Math.trunc(finiteNumber(meta.frame_count, Math.max(a.length, b.length)))),
    subfolder,
    haveA: Boolean(meta.have_a) && a.length > 0,
    haveB: Boolean(meta.have_b) && b.length > 0,
    aSourceWidth: Math.max(0, Math.trunc(finiteNumber(meta.a_src_w))),
    aSourceHeight: Math.max(0, Math.trunc(finiteNumber(meta.a_src_h))),
    bSourceWidth: Math.max(0, Math.trunc(finiteNumber(meta.b_src_w))),
    bSourceHeight: Math.max(0, Math.trunc(finiteNumber(meta.b_src_h))),
    aSourceCount: Math.max(0, Math.trunc(finiteNumber(meta.a_count))),
    bSourceCount: Math.max(0, Math.trunc(finiteNumber(meta.b_count))),
    audioA: denoAudio(meta.audio_a),
    audioB: denoAudio(meta.audio_b),
    error: typeof meta.error === 'string' ? meta.error : undefined,
  };
  return { a, b, video };
}
