export interface HslColor {
  h: number;
  s: number;
  l: number;
}

export function normalizeHexColor(value: string): string | null {
  const cleaned = value.replace('#', '').trim();
  if (/^[0-9a-f]{3}$/i.test(cleaned)) {
    return `#${cleaned.replace(/(.)/g, '$1$1').toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  return null;
}

export function cssColorToHex(value: string): string | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const target = document.createElement('span');
  target.style.color = value;
  document.body.appendChild(target);
  const computed = getComputedStyle(target).color;
  document.body.removeChild(target);
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  const [, r, g, b] = match.map(Number);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function normalizeColorTokens(
  value: string,
  namedColorMap?: Record<string, string>
): string[] {
  const tokens = new Set<string>();
  const lowered = value.trim().toLowerCase();
  if (lowered) {
    tokens.add(lowered);
    if (namedColorMap) {
      const mapped = namedColorMap[lowered.replace(/\s+/g, '')] ?? namedColorMap[lowered];
      if (mapped) tokens.add(mapped);
    }
  }
  const normalizedHex = normalizeHexColor(value);
  if (normalizedHex) {
    tokens.add(normalizedHex);
    return [...tokens];
  }
  const cssHex = cssColorToHex(value);
  if (cssHex) tokens.add(cssHex);
  return [...tokens];
}

export function hexToHsl(hex: string): HslColor | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}
