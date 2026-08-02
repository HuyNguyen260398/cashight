export const CHART_COLORS = {
  brand: '#465fff',
  brandLight: '#9cb9ff',
  blueLight: '#0ba5ec',
  success: '#12b76a',
  successDark: '#039855',
  warning: '#f79009',
  orange: '#fb6514',
  pink: '#ee46bc',
  purple: '#7a5af8',
  error: '#f04438',
  errorDark: '#d92d20',
  gray: '#98a2b3',
} as const;

export const CHART_AXIS_COLOR = '#667085';

// ── Brand ramp ────────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Linear interpolation between two hex colours. `t` is clamped to 0..1. */
export function mixColors(from: string, to: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const a = toRgb(from);
  const b = toRgb(to);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * clamped) as Rgb);
}

/** How far a bar's gradient fades toward white from left to right. */
const GRADIENT_HIGHLIGHT = 0.32;

/**
 * Turn a flat colour into the left-to-right gradient pair the bars use.
 *
 * The hue is fixed by the caller (a category colour); this only supplies the
 * lightening that gives each bar the same sheen the chart had when every bar
 * shared one brand gradient.
 */
export function gradientPair(color: string): { from: string; to: string } {
  return { from: color, to: mixColors(color, '#ffffff', GRADIENT_HIGHLIGHT) };
}

