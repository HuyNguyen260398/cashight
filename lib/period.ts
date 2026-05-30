/**
 * Period utilities for the aggregation engine.
 *
 * PeriodSpec is the URL-friendly representation of a reporting period:
 *   - { type: 'month', year: 2026, month: 5 }
 *   - { type: 'quarter', year: 2026, quarter: 2 }
 *   - { type: 'year', year: 2026 }
 *
 * All functions are pure and side-effect-free.
 */

export type PeriodType = 'month' | 'quarter' | 'year';

export type PeriodSpec =
  | { type: 'month'; year: number; month: number }
  | { type: 'quarter'; year: number; quarter: number }
  | { type: 'year'; year: number };

/** Return which quarter (1–4) a calendar month (1–12) belongs to. */
export function quarterOf(month: number): number {
  return Math.ceil(month / 3);
}

/**
 * Human-readable label for a period:
 *   year    → "2026"
 *   quarter → "Q2 2026"
 *   month   → "2026-05"  (month zero-padded)
 */
export function periodLabel(spec: PeriodSpec): string {
  switch (spec.type) {
    case 'year':
      return String(spec.year);
    case 'quarter':
      return `Q${spec.quarter} ${spec.year}`;
    case 'month': {
      const mm = String(spec.month).padStart(2, '0');
      return `${spec.year}-${mm}`;
    }
  }
}

/** Return the period immediately before `spec`. */
export function previousPeriod(spec: PeriodSpec): PeriodSpec {
  switch (spec.type) {
    case 'year':
      return { type: 'year', year: spec.year - 1 };
    case 'quarter':
      if (spec.quarter === 1) {
        return { type: 'quarter', year: spec.year - 1, quarter: 4 };
      }
      return { type: 'quarter', year: spec.year, quarter: spec.quarter - 1 };
    case 'month':
      if (spec.month === 1) {
        return { type: 'month', year: spec.year - 1, month: 12 };
      }
      return { type: 'month', year: spec.year, month: spec.month - 1 };
  }
}

/** Return the period immediately after `spec`. */
export function nextPeriod(spec: PeriodSpec): PeriodSpec {
  switch (spec.type) {
    case 'year':
      return { type: 'year', year: spec.year + 1 };
    case 'quarter':
      if (spec.quarter === 4) {
        return { type: 'quarter', year: spec.year + 1, quarter: 1 };
      }
      return { type: 'quarter', year: spec.year, quarter: spec.quarter + 1 };
    case 'month':
      if (spec.month === 12) {
        return { type: 'month', year: spec.year + 1, month: 1 };
      }
      return { type: 'month', year: spec.year, month: spec.month + 1 };
  }
}
