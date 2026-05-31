/**
 * Vitest suite for formatting utilities in lib/format.ts.
 *
 * Tests cover:
 *  - formatVNDCompact: millions, exact million boundary, thousands, exact
 *    thousand boundary, sub-thousand, zero
 *  - formatDate: ICU-robust assertions (non-empty, contains year)
 */

import { describe, it, expect } from 'vitest';
import { formatVNDCompact, formatDate } from '@/lib/format';

// ---------------------------------------------------------------------------
// formatVNDCompact
// ---------------------------------------------------------------------------

describe('formatVNDCompact', () => {
  it('26_986_712 → "27.0M ₫"', () => {
    expect(formatVNDCompact(26_986_712)).toBe('27.0M ₫');
  });

  it('1_000_000 → "1.0M ₫"', () => {
    expect(formatVNDCompact(1_000_000)).toBe('1.0M ₫');
  });

  it('500_000 → "500K ₫"', () => {
    expect(formatVNDCompact(500_000)).toBe('500K ₫');
  });

  it('1_000 → "1K ₫"', () => {
    expect(formatVNDCompact(1_000)).toBe('1K ₫');
  });

  it('999 → "999 ₫"', () => {
    expect(formatVNDCompact(999)).toBe('999 ₫');
  });

  it('999_800 → "1.0M ₫" (K→M boundary does not produce "1000K")', () => {
    expect(formatVNDCompact(999_800)).toBe('1.0M ₫');
  });

  it('0 → "0 ₫"', () => {
    expect(formatVNDCompact(0)).toBe('0 ₫');
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('returns a non-empty string for a valid ISO date', () => {
    const result = formatDate('2026-05-15');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('contains the year in the formatted output', () => {
    expect(formatDate('2026-05-15')).toContain('2026');
  });

  it('contains the year for a different date', () => {
    expect(formatDate('2024-01-01')).toContain('2024');
  });
});
