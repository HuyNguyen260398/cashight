import { describe, expect, it } from 'vitest';

import {
  PIE_PLOT_HEIGHT,
  servicePanelHeight,
  servicePieHeight,
  servicePieLegendHeight,
  servicePiePlotHeight,
  topServicesHeight,
} from '@/app/components/aws-invoices/invoice-chart-size';

describe('service breakdown sizing', () => {
  it('reserves legend rows below the donut instead of overlapping it', () => {
    // A real invoice has 17 billed services; at two legend columns that is
    // nine rows which must not eat into the donut's plot band.
    const height = servicePieHeight(17);
    expect(servicePieLegendHeight(17)).toBeGreaterThan(0);
    expect(height).toBe(PIE_PLOT_HEIGHT + servicePieLegendHeight(17));
    expect(height).toBeGreaterThan(PIE_PLOT_HEIGHT);
  });

  it('grows with the number of services', () => {
    expect(servicePieHeight(17)).toBeGreaterThan(servicePieHeight(4));
  });

  it('keeps a stable floor for a small or empty breakdown', () => {
    expect(servicePieHeight(0)).toBeGreaterThanOrEqual(PIE_PLOT_HEIGHT);
    expect(servicePieHeight(1)).toBeGreaterThanOrEqual(PIE_PLOT_HEIGHT);
  });
});

describe('top services sizing', () => {
  it('gives every bar room to breathe at the ten-service cap', () => {
    // Ten bars in the old fixed 300px left ~26px per band, which collided
    // with the 11px category labels.
    const height = topServicesHeight(10);
    expect(height / 10).toBeGreaterThanOrEqual(32);
  });

  it('grows with the number of bars', () => {
    expect(topServicesHeight(10)).toBeGreaterThan(topServicesHeight(3));
  });

  it('does not collapse below the shared chart floor', () => {
    expect(topServicesHeight(0)).toBeGreaterThanOrEqual(300);
    expect(topServicesHeight(2)).toBeGreaterThanOrEqual(300);
  });
});

describe('shared service panel height', () => {
  // The two panels sit side by side in one grid row, so they must agree on a
  // height. Each derives it from the same dashboard counts.
  it('matches the taller of the two panels when the donut leads', () => {
    // 17 services -> 498px donut panel vs 388px for ten bars.
    expect(servicePanelHeight(17, 10)).toBe(servicePieHeight(17));
    expect(servicePanelHeight(17, 10)).toBeGreaterThan(topServicesHeight(10));
  });

  it('matches the taller of the two panels when the bars lead', () => {
    // A short breakdown must not squash the bar panel.
    expect(servicePanelHeight(3, 10)).toBe(topServicesHeight(10));
    expect(servicePanelHeight(3, 10)).toBeGreaterThan(servicePieHeight(3));
  });

  it('is identical whichever panel asks for it', () => {
    for (const [breakdown, top] of [[17, 10], [3, 10], [8, 4], [0, 0]]) {
      expect(servicePanelHeight(breakdown, top)).toBe(
        servicePanelHeight(breakdown, top),
      );
    }
  });

  it('gives the donut whatever plot space the legend does not use', () => {
    const height = servicePanelHeight(3, 10);
    expect(servicePiePlotHeight(height, 3)).toBe(
      height - servicePieLegendHeight(3),
    );
    // Growing to match the bars gives the donut more room, not the legend.
    expect(servicePiePlotHeight(height, 3)).toBeGreaterThan(PIE_PLOT_HEIGHT);
  });

  it('keeps the donut plot band positive at the busiest legend', () => {
    const height = servicePanelHeight(17, 10);
    expect(servicePiePlotHeight(height, 17)).toBe(PIE_PLOT_HEIGHT);
  });
});
