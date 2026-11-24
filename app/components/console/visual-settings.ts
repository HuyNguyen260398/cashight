import { Density, Mode, applyDensity, applyMode } from '@cloudscape-design/global-styles';

export type ModePreference = 'light' | 'dark' | 'system';
export type DensityPreference = 'comfortable' | 'compact';

export interface VisualSettings {
  mode: ModePreference;
  density: DensityPreference;
}

export const VISUAL_SETTINGS_KEY = 'cashight.visual-settings';

const DEFAULT_SETTINGS: VisualSettings = { mode: 'system', density: 'comfortable' };
const MODES: readonly ModePreference[] = ['light', 'dark', 'system'];
const DENSITIES: readonly DensityPreference[] = ['comfortable', 'compact'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadVisualSettings(
  storage: Pick<Storage, 'getItem'> | undefined = browserStorage(),
): VisualSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(VISUAL_SETTINGS_KEY) ?? 'null');
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const value = (raw ?? {}) as Partial<Record<keyof VisualSettings, unknown>>;
  return {
    mode: MODES.includes(value.mode as ModePreference) ? (value.mode as ModePreference) : DEFAULT_SETTINGS.mode,
    density: DENSITIES.includes(value.density as DensityPreference)
      ? (value.density as DensityPreference)
      : DEFAULT_SETTINGS.density,
  };
}

export function saveVisualSettings(
  settings: VisualSettings,
  storage: Pick<Storage, 'setItem'> | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(VISUAL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be full or blocked; the choice then lasts for this page only.
  }
}

export function resolveMode(mode: ModePreference, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/**
 * Applies mode and density to <body>, where Cloudscape defines its theme
 * tokens (a class on <html> would be overridden). Returns an unsubscribe that stops
 * following the OS colour scheme when the mode is 'system'.
 */
export function applyVisualSettings(settings: VisualSettings): () => void {
  const target = document.body;
  const toMode = (dark: boolean) => (resolveMode(settings.mode, dark) === 'dark' ? Mode.Dark : Mode.Light);

  applyDensity(settings.density === 'compact' ? Density.Compact : Density.Comfortable, target);

  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  applyMode(toMode(media?.matches ?? false), target);

  if (settings.mode !== 'system' || !media) return () => {};
  const onChange = (event: { matches: boolean }) => applyMode(toMode(event.matches), target);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
