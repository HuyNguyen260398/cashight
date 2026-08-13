import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CHART_CURSOR_FILL } from '@/lib/chart-colors';

const COMPONENT_DIR = fileURLToPath(
  new URL('../components/aws-invoices/', import.meta.url),
);

function barChartComponents(): string[] {
  return readdirSync(COMPONENT_DIR)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) =>
      readFileSync(`${COMPONENT_DIR}${file}`, 'utf8').includes('<BarChart'),
    );
}

describe('invoice bar chart hover cursor', () => {
  it('uses a subtle translucent fill, not an opaque block', () => {
    // Recharts defaults a BarChart tooltip cursor to solid light grey, which
    // reads as a white slab behind the hovered bar on the dark theme.
    const alpha = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(
      CHART_CURSOR_FILL,
    );
    expect(alpha).not.toBeNull();
    expect(Number(alpha![1])).toBeLessThanOrEqual(0.2);
    expect(Number(alpha![1])).toBeGreaterThan(0);
  });

  it('covers every bar chart in the invoice dashboard', () => {
    const components = barChartComponents();
    expect(components.length).toBeGreaterThanOrEqual(3);
    for (const file of components) {
      const source = readFileSync(`${COMPONENT_DIR}${file}`, 'utf8');
      expect(
        source,
        `${file} must set a subtle tooltip cursor`,
      ).toContain('cursor={{ fill: CHART_CURSOR_FILL }}');
    }
  });
});
