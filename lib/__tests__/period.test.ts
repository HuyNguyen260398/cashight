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
 *  - Out-of-range month/quarter fall back to current-date defaults
 *  - Valid boundary values (month=1/12, quarter=1/4) are accepted as-is
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parsePeriodFromSearch } from '@/lib/period';

/** Build a URLSearchParams from a plain object for convenience. */
function params(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

// ---------------------------------------------------------------------------
// parsePeriodFromSearch
// ---------------------------------------------------------------------------

describe('parsePeriodFromSearch', () => {
  // Pin the clock so "current date" assertions are deterministic.
  // 2026-05-15T12:00:00Z is midday UTC — month/quarter/year are stable
  // across all common timezones at this time.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Default / empty params
  // -------------------------------------------------------------------------

  it('empty params → current month spec', () => {
    const result = parsePeriodFromSearch(new URLSearchParams());
    expect(result.type).toBe('month');
    expect(result.year).toBe(2026);
    expect((result as { type: 'month'; year: number; month: number }).month).toBe(5);
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
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: 'abc', month: '5' }),
    );
    expect(result.type).toBe('month');
    expect(result.year).toBe(2026);
    expect(Number.isNaN(result.year)).toBe(false);
  });

  it('month=xyz → falls back to current month (no NaN)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: '2026', month: 'xyz' }),
    );
    expect(result.type).toBe('month');
    const r = result as { type: 'month'; year: number; month: number };
    expect(r.month).toBe(5);
    expect(Number.isNaN(r.month)).toBe(false);
  });

  it('quarter=foo → falls back to current quarter (no NaN)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'quarter', year: '2026', quarter: 'foo' }),
    );
    expect(result.type).toBe('quarter');
    const r = result as { type: 'quarter'; year: number; quarter: number };
    expect(r.quarter).toBe(2);
    expect(Number.isNaN(r.quarter)).toBe(false);
  });

  it('period=year with year=abc → falls back to current year (no NaN)', () => {
    const result = parsePeriodFromSearch(params({ period: 'year', year: 'abc' }));
    expect(result.type).toBe('year');
    expect(result.year).toBe(2026);
    expect(Number.isNaN(result.year)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Quarter default with no quarter param
  // -------------------------------------------------------------------------

  it('period=quarter with no quarter param → uses current quarter', () => {
    const result = parsePeriodFromSearch(params({ period: 'quarter', year: '2026' }));
    expect(result.type).toBe('quarter');
    const r = result as { type: 'quarter'; year: number; quarter: number };
    expect(r.quarter).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Out-of-range values fall back to current-date defaults
  // -------------------------------------------------------------------------

  it('month=0 → falls back to current month (5)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: '2026', month: '0' }),
    );
    expect(result.type).toBe('month');
    const r = result as { type: 'month'; year: number; month: number };
    expect(r.month).toBe(5);
  });

  it('month=13 → falls back to current month (5)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: '2026', month: '13' }),
    );
    expect(result.type).toBe('month');
    const r = result as { type: 'month'; year: number; month: number };
    expect(r.month).toBe(5);
  });

  it('quarter=0 → falls back to current quarter (2)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'quarter', year: '2026', quarter: '0' }),
    );
    expect(result.type).toBe('quarter');
    const r = result as { type: 'quarter'; year: number; quarter: number };
    expect(r.quarter).toBe(2);
  });

  it('quarter=5 → falls back to current quarter (2)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'quarter', year: '2026', quarter: '5' }),
    );
    expect(result.type).toBe('quarter');
    const r = result as { type: 'quarter'; year: number; quarter: number };
    expect(r.quarter).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Valid boundary values are accepted as-is
  // -------------------------------------------------------------------------

  it('month=1 → 1 (valid lower boundary)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: '2026', month: '1' }),
    );
    expect(result).toEqual({ type: 'month', year: 2026, month: 1 });
  });

  it('month=12 → 12 (valid upper boundary)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'month', year: '2026', month: '12' }),
    );
    expect(result).toEqual({ type: 'month', year: 2026, month: 12 });
  });

  it('quarter=1 → 1 (valid lower boundary)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'quarter', year: '2026', quarter: '1' }),
    );
    expect(result).toEqual({ type: 'quarter', year: 2026, quarter: 1 });
  });

  it('quarter=4 → 4 (valid upper boundary)', () => {
    const result = parsePeriodFromSearch(
      params({ period: 'quarter', year: '2026', quarter: '4' }),
    );
    expect(result).toEqual({ type: 'quarter', year: 2026, quarter: 4 });
  });
});
