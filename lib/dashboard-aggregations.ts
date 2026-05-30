/**
 * Pure aggregation helpers for the expense-tracker dashboard.
 *
 * All functions are side-effect-free: they take a Statement, return new
 * arrays/numbers, and never mutate inputs, perform I/O, or log anything.
 *
 * Reused by the Step 08 vitest suite — do not change signatures without
 * updating those tests.
 */

import type { Statement } from '@/lib/schemas';

/**
 * Categories that are NOT considered spend for `totalSpend` / `cumulativeByDay`.
 * Installments and Fees & Interest have their own slices in `byCategory` but
 * are excluded from the "pure spend" total.
 */
export const NON_SPEND = new Set([
  'Installments',
  'Cashback',
  'Fees & Interest',
  'Payment',
]);

/**
 * Sum of amountVnd for SPEND transactions only:
 * category NOT in NON_SPEND AND amountVnd > 0.
 */
export function totalSpend(s: Statement): number {
  return s.transactions.reduce((sum, t) => {
    if (!NON_SPEND.has(t.category) && t.amountVnd > 0) {
      return sum + t.amountVnd;
    }
    return sum;
  }, 0);
}

/**
 * Group ALL positive-amountVnd transactions by category.
 * This INCLUDES Installments and Fees & Interest as their own slices;
 * it EXCLUDES the negative credits (Payment / Cashback).
 * Returns entries sorted by value descending.
 */
export function byCategory(
  s: Statement,
): Array<{ category: string; value: number }> {
  const map = new Map<string, number>();

  for (const t of s.transactions) {
    if (t.amountVnd <= 0) continue; // skip credits (Payment, Cashback)
    map.set(t.category, (map.get(t.category) ?? 0) + t.amountVnd);
  }

  return Array.from(map.entries())
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Group positive-amountVnd transactions by normalized description (merchant),
 * EXCLUDING category 'Fees & Interest' (shows where money actually went:
 * spend + installments). Sort descending and return the top n entries.
 */
export function topMerchants(
  s: Statement,
  n: number,
): Array<{ merchant: string; value: number }> {
  const map = new Map<string, number>();

  for (const t of s.transactions) {
    if (t.amountVnd <= 0) continue;           // skip credits
    if (t.category === 'Fees & Interest') continue; // exclude fee rows
    map.set(t.description, (map.get(t.description) ?? 0) + t.amountVnd);
  }

  return Array.from(map.entries())
    .map(([merchant, value]) => ({ merchant, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/**
 * Cumulative spend over time.
 *
 * Takes SPEND transactions (same filter as totalSpend: category NOT in
 * NON_SPEND AND amountVnd > 0), groups by the full ISO `date` string
 * (YYYY-MM-DD), sums per day, sorts chronologically, then emits a running
 * cumulative total.
 *
 * The full ISO date is used (not day-of-month) because transactions can span
 * multiple calendar months within a single statement.
 */
export function cumulativeByDay(
  s: Statement,
): Array<{ date: string; cumulative: number }> {
  const dailyMap = new Map<string, number>();

  for (const t of s.transactions) {
    if (NON_SPEND.has(t.category) || t.amountVnd <= 0) continue;
    dailyMap.set(t.date, (dailyMap.get(t.date) ?? 0) + t.amountVnd);
  }

  const days = Array.from(dailyMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  let running = 0;
  return days.map(([date, amount]) => {
    running += amount;
    return { date, cumulative: running };
  });
}
