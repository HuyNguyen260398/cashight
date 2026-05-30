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

/** Valid PeriodType values as a set for O(1) membership checks. */
const VALID_PERIOD_TYPES = new Set<PeriodType>(['month', 'quarter', 'year']);

/**
 * Parse a `PeriodSpec` from URL search params.
 *
 * Reads `period`, `year`, `month`, and `quarter` from `params`.
 * Unknown or missing values fall back to the current date at call time.
 * Non-numeric numeric params (e.g. `?year=abc`) also fall back to the
 * current-date default — NaN is never present in the returned spec.
 *
 * This function is pure and side-effect-free; `new Date()` is the only
 * implicit input (evaluated at call time, not module load time).
 */
export function parsePeriodFromSearch(params: URLSearchParams): PeriodSpec {
  const now = new Date();

  // Validate type — unknown values fall back to 'month'.
  const rawType = params.get('period') ?? '';
  const type: PeriodType = VALID_PERIOD_TYPES.has(rawType as PeriodType)
    ? (rawType as PeriodType)
    : 'month';

  // Parse year, falling back to current year if absent or non-numeric.
  const rawYear = params.get('year');
  const parsedYear = rawYear !== null ? parseInt(rawYear, 10) : NaN;
  const year = Number.isNaN(parsedYear) ? now.getFullYear() : parsedYear;

  if (type === 'year') {
    return { type, year };
  }

  if (type === 'quarter') {
    const rawQuarter = params.get('quarter');
    const parsedQuarter = rawQuarter !== null ? parseInt(rawQuarter, 10) : NaN;
    const quarter = Number.isNaN(parsedQuarter)
      ? quarterOf(now.getMonth() + 1)
      : parsedQuarter;
    return { type, year, quarter };
  }

  // type === 'month'
  const rawMonth = params.get('month');
  const parsedMonth = rawMonth !== null ? parseInt(rawMonth, 10) : NaN;
  const month = Number.isNaN(parsedMonth) ? now.getMonth() + 1 : parsedMonth;
  return { type, year, month };
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
