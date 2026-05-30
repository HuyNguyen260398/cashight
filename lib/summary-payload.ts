/**
 * Anonymized payload builder for the AI spending summary.
 *
 * SECURITY-CRITICAL / PCI BOUNDARY:
 * This module strips a full bank Statement down to anonymized aggregate numbers
 * before anything is sent to Gemini. It MUST NOT include cardLast4, bank name,
 * raw transactions, individual transaction dates, creditLimit, statementBalance,
 * cardholder name, or the PAN in any form.
 *
 * Pure function: no I/O, no logging, no side effects.
 */

import type { Statement } from '@/lib/schemas';
import { byCategory, topMerchants } from '@/lib/dashboard-aggregations';

export interface SummaryPayload {
  period: { year: number; month: number };
  totals: {
    spend: number;
    feesAndInterest: number; // combined (parser does not split fees/interest)
    cashback: number;
    installments: number;
  };
  topCategories: Array<{ category: string; amount: number; pct: number }>;
  topMerchants: Array<{ merchant: string; amount: number }>;
  internationalSpendPct: number; // % of spend that is international, 0–100, rounded to 1 decimal
}

/** Categories that are NOT considered spend for internationalSpendPct calculation. */
const NON_SPEND = new Set([
  'Installments',
  'Cashback',
  'Fees & Interest',
  'Payment',
]);

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function buildSummaryPayload(s: Statement): SummaryPayload {
  // --- period ---
  const [yearStr, monthStr] = s.statementDate.split('-');
  const period = { year: parseInt(yearStr, 10), month: parseInt(monthStr, 10) };

  // --- totals ---
  const totals = {
    spend: s.totals.totalSpend,
    feesAndInterest: s.totals.totalFeesAndInterest,
    cashback: s.totals.totalCashback,
    installments: s.totals.totalInstallments,
  };

  // --- topCategories ---
  const allByCategory = byCategory(s);
  const denominator = allByCategory.reduce((sum, c) => sum + c.value, 0);
  const topCategories = allByCategory.slice(0, 5).map((c) => ({
    category: c.category,
    amount: c.value,
    pct: denominator > 0 ? round1((100 * c.value) / denominator) : 0,
  }));

  // --- topMerchants ---
  const merchants = topMerchants(s, 5).map((m) => ({
    merchant: m.merchant,
    amount: m.value,
  }));

  // --- internationalSpendPct ---
  // Spend transactions: category NOT in NON_SPEND AND amountVnd > 0
  const spendTxns = s.transactions.filter(
    (t) => !NON_SPEND.has(t.category) && t.amountVnd > 0,
  );
  const totalSpendVnd = spendTxns.reduce((sum, t) => sum + t.amountVnd, 0);
  const intlSpendVnd = spendTxns
    .filter((t) => t.isInternational)
    .reduce((sum, t) => sum + t.amountVnd, 0);
  const internationalSpendPct =
    totalSpendVnd > 0 ? round1((100 * intlSpendVnd) / totalSpendVnd) : 0;

  return {
    period,
    totals,
    topCategories,
    topMerchants: merchants,
    internationalSpendPct,
  };
}
