/**
 * Anonymized payload builder for the AI spending summary.
 *
 * SECURITY-CRITICAL / PCI BOUNDARY:
 * This module strips an AggregatedView down to anonymized aggregate numbers
 * before anything is sent to Gemini. It MUST NOT include cardLast4 (the view
 * has none anyway), raw transactions, individual transaction dates/descriptions,
 * creditLimit, statementBalance, cardholder name, or the PAN in any form.
 * Only derived aggregates are emitted (topMerchants names are pre-deemed
 * acceptable, matching the prior Statement behaviour).
 *
 * Pure function: no I/O, no logging, no side effects.
 */

import type { AggregatedView } from './aggregations';
import { NON_SPEND } from './dashboard-aggregations';
import type { PeriodType } from './period';

export interface SummaryPayload {
  periodType: PeriodType; // 'month' | 'quarter' | 'year'
  periodLabel: string; // e.g. "2026-05", "Q2 2026", "2026"
  // For month specs this carries { year, month }; for quarter/year there is no
  // single month, so `month` is omitted.
  period: { year: number; month?: number };
  statementCount: number;
  totals: {
    spend: number;
    feesAndInterest: number; // combined (parser does not split fees/interest)
    cashback: number;
    installments: number;
  };
  topCategories: Array<{ category: string; amount: number; pct: number }>;
  topMerchants: Array<{ merchant: string; amount: number }>;
  // Trend buckets: months for year/quarter views, days for month views.
  subPeriods: Array<{ label: string; value: number }>;
  internationalSpendPct: number; // % of spend that is international, 0–100, rounded to 1 decimal
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function sanitizeSummaryLabel(label: string): string {
  return label.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 120);
}

export function buildSummaryPayload(view: AggregatedView): SummaryPayload {
  // --- period ---
  const period: { year: number; month?: number } = { year: view.spec.year };
  if (view.spec.type === 'month') {
    period.month = view.spec.month;
  }

  // --- totals ---
  const totals = {
    spend: view.totals.totalSpend,
    feesAndInterest: view.totals.totalFeesAndInterest,
    cashback: view.totals.totalCashback,
    installments: view.totals.totalInstallments,
  };

  // --- topCategories --- (reuse the view's pct, a fraction 0..1 → percentage)
  const topCategories = view.byCategory.slice(0, 5).map((c) => ({
    category: sanitizeSummaryLabel(c.category),
    amount: c.value,
    pct: round1(c.pct * 100),
  }));

  // --- topMerchants ---
  const topMerchants = view.topMerchants.slice(0, 5).map((m) => ({
    merchant: sanitizeSummaryLabel(m.merchant),
    amount: m.value,
  }));

  // --- internationalSpendPct ---
  // Spend transactions: category NOT in NON_SPEND AND amountVnd > 0
  const spendTxns = view.transactions.filter(
    (t) => !NON_SPEND.has(t.category) && t.amountVnd > 0,
  );
  const totalSpendVnd = spendTxns.reduce((sum, t) => sum + t.amountVnd, 0);
  const intlSpendVnd = spendTxns
    .filter((t) => t.isInternational)
    .reduce((sum, t) => sum + t.amountVnd, 0);
  const internationalSpendPct =
    totalSpendVnd > 0 ? round1((100 * intlSpendVnd) / totalSpendVnd) : 0;

  return {
    periodType: view.spec.type,
    periodLabel: view.label,
    period,
    statementCount: view.statementCount,
    totals,
    topCategories,
    topMerchants,
    subPeriods: view.subPeriods.map((subPeriod) => ({
      label: sanitizeSummaryLabel(subPeriod.label),
      value: subPeriod.value,
    })),
    internationalSpendPct,
  };
}
