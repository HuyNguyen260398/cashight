/**
 * Vitest suite for parsePeriodFromSearch in lib/period.ts.
 *
 * Tests cover:
 *  - Empty params → current month spec (derived from new Date() at call time)
 *  - Explicit year type
 *  - Explicit quarter type
 *  - Explicit month type
 *  - Invalid period value falls back to month
 *  - Non-numeric year/month/quarter fall back to current-date defaults (no NaN)
 */

import { describe, it, expect } from 'vitest';
import { parsePeriodFromSearch, quarterOf } from '@/lib/period';

/** Build a URLSearchParams from a plain object for convenience. */
function params(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

// ---------------------------------------------------------------------------
// parsePeriodFromSearch
// ---------------------------------------------------------------------------

describe('parsePeriodFromSearch', () => {
  // -------------------------------------------------------------------------
  // Default / empty params
  // -------------------------------------------------------------------------

  it('empty params → current month spec', () => {
    const now = new Date();
    const result = parsePeriodFromSearch(new URLSearchParams());
    expect(result.type).toBe('month');
    expect(result.year).toBe(now.getFullYear());
    if (result.type === 'month') {
      expect(result.month).toBe(now.getMonth() + 1);
    }
  });

  // -------------------------------------------------------------------------
  // Explicit valid period types
  // -------------------------------------------------------------------------

  it('period=year&year=2025 → { type: "year", year: 2025 }', () => {
    const result = parsePeriodFromSearch(params({ period: 'year', year: '2025' }));
    expect(result).toEqual({ type: 'year', year: 2025 });
  });

  it('period=quarter&year=2026&quarter=2 → { type: "quarter", year: 2026, quarter: 2 }', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'quarter', year: '2026', quarter: '2' }),
    );
    expect(result).toEqual({ type: 'quarter', year: 2026, quarter: 2 });
  });

  it('period=month&year=2026&month=5 → { type: "month", year: 2026, month: 5 }', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: '2026', month: '5' }),
    );
    expect(result).toEqual({ type: 'month', year: 2026, month: 5 });
  });

  // -------------------------------------------------------------------------
  // Invalid period type falls back to month
  // -------------------------------------------------------------------------

  it('period=decade → falls back to type "month"', () => {
    const result = parsePeriodFromSearch(params({ period: 'decade' }));
    expect(result.type).toBe('month');
  });

  it('period= (empty string) → falls back to type "month"', () => {
    const result = parsePeriodFromSearch(params({ period: '' }));
    expect(result.type).toBe('month');
  });

  // -------------------------------------------------------------------------
  // Non-numeric values fall back to current-date defaults (no NaN in output)
  // -------------------------------------------------------------------------

  it('year=abc → falls back to current year (no NaN)', () => {
    const now = new Date();
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: 'abc', month: '5' }),
    );
    expect(result.type).toBe('month');
    expect(result.year).toBe(now.getFullYear());
    expect(Number.isNaN(result.year)).toBe(false);
  });

  it('month=xyz → falls back to current month (no NaN)', () => {
    const now = new Date();
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: '2026', month: 'xyz' }),
    );
    expect(result.type).toBe('month');
    if (result.type === 'month') {
      expect(result.month).toBe(now.getMonth() + 1);
      expect(Number.isNaN(result.month)).toBe(false);
    }
  });

  it('quarter=foo → falls back to current quarter (no NaN)', () => {
    const now = new Date();
    const result = parsePeriodFromSearch(
      params({ period: 'quarter', year: '2026', quarter: 'foo' }),
    );
    expect(result.type).toBe('quarter');
    if (result.type === 'quarter') {
      expect(result.quarter).toBe(quarterOf(now.getMonth() + 1));
      expect(Number.isNaN(result.quarter)).toBe(false);
    }
  });

  it('period=year with year=abc → falls back to current year (no NaN)', () => {
    const now = new Date();
    const result = parsePeriodFromSearch(params({ period: 'year', year: 'abc' }));
    expect(result.type).toBe('year');
    expect(result.year).toBe(now.getFullYear());
    expect(Number.isNaN(result.year)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Quarter default with no quarter param
  // -------------------------------------------------------------------------

  it('period=quarter with no quarter param → uses current quarter', () => {
    const now = new Date();
    const expectedQuarter = quarterOf(now.getMonth() + 1);
    const result = parsePeriodFromSearch(params({ period: 'quarter', year: '2026' }));
    expect(result.type).toBe('quarter');
    if (result.type === 'quarter') {
      expect(result.quarter).toBe(expectedQuarter);
    }
  });
});
