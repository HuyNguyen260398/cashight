/**
 * Multi-statement aggregation engine.
 *
 * All functions are pure and side-effect-free — no I/O, no mutation.
 * Reuses byCategory/topMerchants/totalSpend/NON_SPEND from
 * dashboard-aggregations.ts to avoid duplicating filter rules.
 */

import { getDaysInMonth } from 'date-fns';
import type { Statement, Transaction } from './schemas';
import {
  NON_SPEND,
  byCategory as singleByCategory,
  topMerchants as singleTopMerchants,
} from './dashboard-aggregations';
import { periodLabel, quarterOf, type PeriodSpec } from './period';

export type { PeriodSpec };

export interface AggregatedView {
  spec: PeriodSpec;
  label: string;
  statementCount: number;
  totals: {
    totalSpend: number;
    totalInstallments: number;
    totalCashback: number;
    totalFeesAndInterest: number;
  };
  transactions: Transaction[];
  byCategory: Array<{ category: string; value: number; pct: number }>;
  topMerchants: Array<{ merchant: string; value: number }>;
  /**
   * Year/quarter views: monthly buckets derived from s.totals.totalSpend —
   * bars sum to totals.totalSpend.
   * Month view: daily buckets derived from transactions (category ∉ NON_SPEND,
   * amountVnd > 0), filtered to dates within the spec month — may NOT sum to
   * totals.totalSpend (statement billing period can include cross-month txns).
   */
  subPeriods: Array<{ label: string; value: number }>;
  /**
   * Same bucket structure as `subPeriods`, but values are installments rather
   * than spend.
   * Year/quarter views: monthly buckets from s.totals.totalInstallments —
   * bars sum to totals.totalInstallments.
   * Month view: daily buckets from transactions (isInstallment, amountVnd > 0),
   * filtered to dates within the spec month.
   */
  installmentSubPeriods: Array<{ label: string; value: number }>;
}

/** Month abbreviations used for year/quarter subPeriod labels. */
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Derive { year, month } (1-based) from a statementDate "YYYY-MM-DD". */
function periodFrom(statementDate: string): { year: number; month: number } {
  const [y, m] = statementDate.split('-').map(Number);
  return { year: y, month: m };
}

/** Filter statements to only those that fall within the given period. */
export function filterStatements(
  statements: Statement[],
  spec: PeriodSpec,
): Statement[] {
  return statements.filter((s) => {
    const { year, month } = periodFrom(s.statementDate);
    if (year !== spec.year) return false;
    switch (spec.type) {
      case 'year':    return true;
      case 'quarter': return quarterOf(month) === spec.quarter;
      case 'month':   return month === spec.month;
    }
  });
}

/**
 * Build the zero-filled subPeriods array for a period spec + filtered
 * statements, for one of two metrics:
 *  - 'spend':        statement-level totalSpend / transaction-derived spend
 *  - 'installments': statement-level totalInstallments / installment txns
 *
 * Both metrics share the same bucket structure so their charts line up.
 */
function buildSubPeriods(
  filtered: Statement[],
  spec: PeriodSpec,
  metric: 'spend' | 'installments' = 'spend',
): Array<{ label: string; value: number }> {
  // Statement-level total for year/quarter monthly buckets.
  const statementTotal = (s: Statement) =>
    metric === 'spend' ? s.totals.totalSpend : s.totals.totalInstallments;
  // Transaction filter for the month view's daily buckets.
  const includeTxn = (t: Transaction) =>
    metric === 'spend'
      ? !NON_SPEND.has(t.category) && t.amountVnd > 0
      : t.isInstallment && t.amountVnd > 0;

  if (spec.type === 'year') {
    // 12 monthly buckets: Jan..Dec — each bucket value is the statement-level
    // total so the 12 bars sum to the matching AggregatedView total.
    return MONTH_ABBR.map((label, idx) => {
      const m = idx + 1; // 1-based month
      const value = filtered
        .filter((s) => periodFrom(s.statementDate).month === m)
        .reduce((sum, s) => sum + statementTotal(s), 0);
      return { label, value };
    });
  }

  if (spec.type === 'quarter') {
    // 3 monthly buckets for the quarter's months — each bucket value is the
    // statement-level total so the 3 bars sum to the matching total.
    const startMonth = (spec.quarter - 1) * 3 + 1; // Q1→1, Q2→4, Q3→7, Q4→10
    return [0, 1, 2].map((offset) => {
      const m = startMonth + offset;
      const label = MONTH_ABBR[m - 1];
      const value = filtered
        .filter((s) => periodFrom(s.statementDate).month === m)
        .reduce((sum, s) => sum + statementTotal(s), 0);
      return { label, value };
    });
  }

  // month: daily buckets 1..N — values are transaction-derived, filtered to
  // dates within the spec month.  These daily buckets may NOT sum to the
  // statement-level total because the billing period can include cross-month
  // transactions that land outside this month's date prefix.
  const { year, month } = spec;
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const mm = String(month).padStart(2, '0');
  const prefix = `${year}-${mm}-`;

  // Build a map of day → metric total
  const dayMap = new Map<number, number>();
  for (const s of filtered) {
    for (const t of s.transactions) {
      if (!includeTxn(t)) continue;
      if (!t.date.startsWith(prefix)) continue;
      const day = parseInt(t.date.slice(8, 10), 10);
      dayMap.set(day, (dayMap.get(day) ?? 0) + t.amountVnd);
    }
  }

  return Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    return { label: String(d), value: dayMap.get(d) ?? 0 };
  });
}

/** Merge per-statement byCategory results into a single sorted list with pct. */
function mergeByCategory(
  filtered: Statement[],
): Array<{ category: string; value: number; pct: number }> {
  const map = new Map<string, number>();
  for (const s of filtered) {
    for (const { category, value } of singleByCategory(s)) {
      map.set(category, (map.get(category) ?? 0) + value);
    }
  }
  const total = Array.from(map.values()).reduce((a, b) => a + b, 0);
  return Array.from(map.entries())
    .map(([category, value]) => ({
      category,
      value,
      pct: total === 0 ? 0 : value / total,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Merge per-statement topMerchants results, return top 10. */
function mergeTopMerchants(
  filtered: Statement[],
): Array<{ merchant: string; value: number }> {
  const map = new Map<string, number>();
  for (const s of filtered) {
    for (const { merchant, value } of singleTopMerchants(
      s,
      Number.MAX_SAFE_INTEGER,
    )) {
      map.set(merchant, (map.get(merchant) ?? 0) + value);
    }
  }
  return Array.from(map.entries())
    .map(([merchant, value]) => ({ merchant, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

/** Roll up a list of statements for the given period into an AggregatedView. */
export function aggregate(
  statements: Statement[],
  spec: PeriodSpec,
): AggregatedView {
  const filtered = filterStatements(statements, spec);

  const totals = filtered.reduce(
    (acc, s) => ({
      totalSpend: acc.totalSpend + s.totals.totalSpend,
      totalInstallments: acc.totalInstallments + s.totals.totalInstallments,
      totalCashback: acc.totalCashback + s.totals.totalCashback,
      totalFeesAndInterest:
        acc.totalFeesAndInterest + s.totals.totalFeesAndInterest,
    }),
    {
      totalSpend: 0,
      totalInstallments: 0,
      totalCashback: 0,
      totalFeesAndInterest: 0,
    },
  );

  return {
    spec,
    label: periodLabel(spec),
    statementCount: filtered.length,
    totals,
    transactions: filtered.flatMap((s) => s.transactions),
    byCategory: mergeByCategory(filtered),
    topMerchants: mergeTopMerchants(filtered),
    subPeriods: buildSubPeriods(filtered, spec),
    installmentSubPeriods: buildSubPeriods(filtered, spec, 'installments'),
  };
}
