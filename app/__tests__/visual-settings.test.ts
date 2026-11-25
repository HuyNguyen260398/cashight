// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cloudscape-design/global-styles', () => ({
  Mode: { Light: 'light', Dark: 'dark' },
  Density: { Comfortable: 'comfortable', Compact: 'compact' },
  applyMode: vi.fn(),
  applyDensity: vi.fn(),
}));

import { applyDensity, applyMode } from '@cloudscape-design/global-styles';
import {
  VISUAL_SETTINGS_KEY,
  applyVisualSettings,
  loadVisualSettings,
  resolveMode,
  saveVisualSettings,
} from '@/app/components/console/visual-settings';

const DEFAULTS = { mode: 'system', density: 'comfortable' };

function mockMatchMedia(initiallyDark: boolean) {
  let listener: ((e: { matches: boolean }) => void) | null = null;
  const mql = {
    matches: initiallyDark,
    addEventListener: vi.fn((_: string, fn: (e: { matches: boolean }) => void) => { listener = fn; }),
    removeEventListener: vi.fn(() => { listener = null; }),
  };
  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
  return {
    flip(dark: boolean) {
      mql.matches = dark;
      listener?.({ matches: dark });
    },
  };
}

afterEach(() => vi.clearAllMocks());

describe('visual settings', () => {
  it('defaults when storage is empty or corrupt', () => {
    expect(loadVisualSettings({ getItem: () => null })).toEqual(DEFAULTS);
    expect(loadVisualSettings({ getItem: () => '{bad' })).toEqual(DEFAULTS);
    expect(loadVisualSettings({ getItem: () => '{"mode":"neon","density":"compact"}' })).toEqual({
      mode: 'system',
      density: 'compact',
    });
  });

  it('round-trips through storage under the documented key', () => {
    const store = new Map<string, string>();
    saveVisualSettings({ mode: 'dark', density: 'compact' }, { setItem: (k, v) => store.set(k, v) });
    expect([...store.keys()]).toEqual([VISUAL_SETTINGS_KEY]);
    expect(loadVisualSettings({ getItem: (k) => store.get(k) ?? null })).toEqual({
      mode: 'dark',
      density: 'compact',
    });
  });

  it('resolves system mode from the media query', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });

  it('applies explicit settings to the document element', () => {
    mockMatchMedia(false);
    applyVisualSettings({ mode: 'dark', density: 'compact' });
    expect(applyMode).toHaveBeenLastCalledWith('dark', document.body);
    expect(applyDensity).toHaveBeenLastCalledWith('compact', document.body);
  });

  it('follows system changes until unsubscribed', () => {
    const media = mockMatchMedia(true);
    const stop = applyVisualSettings({ mode: 'system', density: 'comfortable' });
    expect(applyMode).toHaveBeenLastCalledWith('dark', document.body);

    media.flip(false);
    expect(applyMode).toHaveBeenLastCalledWith('light', document.body);

    stop();
    vi.mocked(applyMode).mockClear();
    media.flip(true);
    expect(applyMode).not.toHaveBeenCalled();
  });

  it('does not follow the system when the mode is explicit', () => {
    const media = mockMatchMedia(false);
    applyVisualSettings({ mode: 'light', density: 'comfortable' });
    vi.mocked(applyMode).mockClear();
    media.flip(true);
    expect(applyMode).not.toHaveBeenCalled();
  });
});
