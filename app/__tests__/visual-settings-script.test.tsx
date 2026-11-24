// @vitest-environment jsdom

import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VISUAL_SETTINGS_KEY } from '@/app/components/console/visual-settings';
import { VISUAL_SETTINGS_SCRIPT, VisualSettingsScript } from '@/app/components/console/visual-settings-script';
import { useHighcharts } from '@/app/components/charts/use-highcharts';

const loaded: string[] = [];
vi.mock('highcharts', () => {
  loaded.push('highcharts');
  return { default: { product: 'Highcharts' } };
});
vi.mock('highcharts/modules/accessibility', () => {
  loaded.push('accessibility');
  return {};
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
  };
}
vi.stubGlobal('localStorage', memoryStorage());

function runScript(stored: string | null, prefersDark = false) {
  const body = document.body;
  body.className = '';
  localStorage.clear();
  if (stored !== null) localStorage.setItem(VISUAL_SETTINGS_KEY, stored);
  window.matchMedia = vi.fn(() => ({ matches: prefersDark })) as unknown as typeof window.matchMedia;
  new Function(VISUAL_SETTINGS_SCRIPT)();
  return body.classList;
}

afterEach(() => {
  document.body.className = '';
  localStorage.clear();
});

describe('pre-paint visual settings script', () => {
  it('adds the dark class for a saved dark mode', () => {
    expect(runScript('{"mode":"dark","density":"comfortable"}').contains('awsui-dark-mode')).toBe(true);
  });

  it('follows the OS for system mode', () => {
    expect(runScript('{"mode":"system","density":"comfortable"}', true).contains('awsui-dark-mode')).toBe(true);
    expect(runScript(null, false).contains('awsui-dark-mode')).toBe(false);
  });

  it('adds the compact class for compact density', () => {
    const classes = runScript('{"mode":"light","density":"compact"}', true);
    expect(classes.contains('awsui-compact-mode')).toBe(true);
    expect(classes.contains('awsui-dark-mode')).toBe(false);
  });

  it('survives corrupt storage', () => {
    expect(() => runScript('{bad')).not.toThrow();
  });

  it('renders the script inline', () => {
    const { container } = render(<VisualSettingsScript />);
    expect(container.querySelector('script')?.innerHTML).toBe(VISUAL_SETTINGS_SCRIPT);
  });
});

describe('useHighcharts', () => {
  it('starts null and resolves to the Highcharts module', async () => {
    const { result } = renderHook(() => useHighcharts());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual({ product: 'Highcharts' }));
    // The accessibility module must be registered before charts render, or
    // charts are unlabelled images to screen readers.
    expect(loaded).toEqual(['highcharts', 'accessibility']);
    await act(async () => {});
  });
});
