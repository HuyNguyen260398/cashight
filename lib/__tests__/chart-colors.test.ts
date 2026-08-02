import { describe, expect, it } from 'vitest';

import { gradientPair, mixColors } from '@/lib/chart-colors';
import { categoryColor } from '@/lib/category-colors';

describe('mixColors', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixColors('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('interpolates each channel independently', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColors('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });

  it('clamps out-of-range values rather than extrapolating past the endpoint', () => {
    expect(mixColors('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mixColors('#000000', '#ffffff', 2)).toBe('#ffffff');
  });

  it('always emits six-digit hex, zero-padding low channels', () => {
    expect(mixColors('#000000', '#ffffff', 0.02)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('gradientPair', () => {
  it('starts at the given colour and fades lighter', () => {
    const brightness = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) +
      parseInt(hex.slice(3, 5), 16) +
      parseInt(hex.slice(5, 7), 16);

    const pair = gradientPair('#465fff');
    expect(pair.from).toBe('#465fff');
    expect(brightness(pair.to)).toBeGreaterThan(brightness(pair.from));
  });

  it('keeps every category visually distinct rather than collapsing to one hue', () => {
    const categories = [
      'E-commerce',
      'Food & Dining',
      'Groceries',
      'Shopping',
      'Software & Subscriptions',
      'Entertainment',
      'Travel',
      'Installments',
    ];
    const starts = categories.map((c) => gradientPair(categoryColor(c)).from);
    expect(new Set(starts).size).toBe(categories.length);
  });

  it('falls back to the neutral grey for a merchant with no category', () => {
    // `category` is optional on the view, so the chart must not produce
    // "#undefined" or throw when an older payload omits it.
    expect(gradientPair(categoryColor('')).from).toBe(categoryColor('Unknown'));
    expect(gradientPair(categoryColor('')).to).toMatch(/^#[0-9a-f]{6}$/);
  });
});
