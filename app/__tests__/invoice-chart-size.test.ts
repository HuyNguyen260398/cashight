import { describe, expect, it } from 'vitest';

import {
  PIE_PLOT_HEIGHT,
  servicePieHeight,
  servicePieLegendHeight,
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
