import { describe, expect, it } from 'vitest';

import { dominantCategory } from '@cashight/domain/dashboard-aggregations';

describe('dominantCategory', () => {
  it('returns the category holding the most VND', () => {
    expect(
      dominantCategory(
        new Map([
          ['Groceries', 300_000],
          ['Food & Dining', 900_000],
          ['Shopping', 100_000],
        ]),
      ),
    ).toBe('Food & Dining');
  });

  it('breaks ties on name, so a merchant keeps the same colour every render', () => {
    const forward = new Map([
      ['Shopping', 500_000],
      ['Groceries', 500_000],
    ]);
    const reversed = new Map([
      ['Groceries', 500_000],
      ['Shopping', 500_000],
    ]);
    // Map iteration follows insertion order; without the tie-break these two
    // would disagree and the bar would change hue on re-aggregation.
    expect(dominantCategory(forward)).toBe(dominantCategory(reversed));
    expect(dominantCategory(forward)).toBe('Groceries');
  });

  it('returns an empty string for an empty split', () => {
    // The chart maps this through categoryColor(), which falls back to grey.
    expect(dominantCategory(new Map())).toBe('');
  });

  it('handles a single category', () => {
    expect(dominantCategory(new Map([['Travel', 1]]))).toBe('Travel');
  });
});
