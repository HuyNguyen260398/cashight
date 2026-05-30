/**
 * Vitest suite for lib/aggregations.ts and lib/period.ts.
 *
 * Uses:
 *  - The real parsed May 2026 sample PDF for acceptance-number tests.
 *  - Small hand-built Statement fixtures for unit-clarity tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';

import { parseTPBankStatement } from '@/lib/parsers/tpbank';
import type { Statement } from '@/lib/schemas';
import { aggregate, filterStatements } from '@/lib/aggregations';
import {
  periodLabel,
  previousPeriod,
  nextPeriod,
  quarterOf,
  type PeriodSpec,
} from '@/lib/period';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Statement for a given year/month with specific totals. */
function makeStatement(
  year: number,
  month: number,
  overrides: Partial<Statement['totals']> = {},
): Statement {
  const mm = String(month).padStart(2, '0');
  return {
    bank: 'TPBank',
    cardLast4: '1234',
    statementDate: `${year}-${mm}-15`,
    paymentDueDate: `${year}-${mm}-25`,
    creditLimit: 100_000_000,
    totals: {
      previousBalance: 0,
      statementBalance: 1_000_000,
      minimumPayment: 100_000,
      totalSpend: 1_000_000,
      totalInstallments: 0,
      totalCashback: 50_000,
      totalFeesAndInterest: 0,
      ...overrides,
    },
    transactions: [],
  };
}

// ---------------------------------------------------------------------------
// Real PDF fixture
// ---------------------------------------------------------------------------

let realStatement: Statement;

beforeAll(async () => {
  const pdfPath = path.resolve(
    __dirname,
    '../../test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf',
  );
  const buffer = fs.readFileSync(pdfPath);
  realStatement = await parseTPBankStatement(buffer);
});

// ---------------------------------------------------------------------------
// period.ts
// ---------------------------------------------------------------------------

describe('periodLabel', () => {
  it('year', () => expect(periodLabel({ type: 'year', year: 2026 })).toBe('2026'));
  it('quarter', () =>
    expect(periodLabel({ type: 'quarter', year: 2026, quarter: 2 })).toBe(
      'Q2 2026',
    ));
  it('month', () =>
    expect(periodLabel({ type: 'month', year: 2026, month: 5 })).toBe(
      '2026-05',
    ));
  it('month zero-pads single digit', () =>
    expect(periodLabel({ type: 'month', year: 2026, month: 3 })).toBe(
      '2026-03',
    ));
});

describe('quarterOf', () => {
  it('months 1-3 → Q1', () => {
    expect(quarterOf(1)).toBe(1);
    expect(quarterOf(2)).toBe(1);
    expect(quarterOf(3)).toBe(1);
  });
  it('months 4-6 → Q2', () => {
    expect(quarterOf(4)).toBe(2);
    expect(quarterOf(5)).toBe(2);
    expect(quarterOf(6)).toBe(2);
  });
  it('months 10-12 → Q4', () => {
    expect(quarterOf(10)).toBe(4);
    expect(quarterOf(12)).toBe(4);
  });
});

describe('previousPeriod', () => {
  it('month: Jan → Dec prev year', () => {
    const prev = previousPeriod({ type: 'month', year: 2026, month: 1 });
    expect(prev).toEqual({ type: 'month', year: 2025, month: 12 });
  });
  it('month: normal decrement', () => {
    const prev = previousPeriod({ type: 'month', year: 2026, month: 5 });
    expect(prev).toEqual({ type: 'month', year: 2026, month: 4 });
  });
  it('quarter: Q1 → Q4 prev year', () => {
    const prev = previousPeriod({ type: 'quarter', year: 2026, quarter: 1 });
    expect(prev).toEqual({ type: 'quarter', year: 2025, quarter: 4 });
  });
  it('quarter: normal decrement', () => {
    const prev = previousPeriod({ type: 'quarter', year: 2026, quarter: 3 });
    expect(prev).toEqual({ type: 'quarter', year: 2026, quarter: 2 });
  });
  it('year: decrement', () => {
    const prev = previousPeriod({ type: 'year', year: 2026 });
    expect(prev).toEqual({ type: 'year', year: 2025 });
  });
});

describe('nextPeriod', () => {
  it('month: Dec → Jan next year', () => {
    const next = nextPeriod({ type: 'month', year: 2025, month: 12 });
    expect(next).toEqual({ type: 'month', year: 2026, month: 1 });
  });
  it('month: normal increment', () => {
    const next = nextPeriod({ type: 'month', year: 2026, month: 5 });
    expect(next).toEqual({ type: 'month', year: 2026, month: 6 });
  });
  it('quarter: Q4 → Q1 next year', () => {
    const next = nextPeriod({ type: 'quarter', year: 2025, quarter: 4 });
    expect(next).toEqual({ type: 'quarter', year: 2026, quarter: 1 });
  });
  it('quarter: normal increment', () => {
    const next = nextPeriod({ type: 'quarter', year: 2026, quarter: 2 });
    expect(next).toEqual({ type: 'quarter', year: 2026, quarter: 3 });
  });
  it('year: increment', () => {
    const next = nextPeriod({ type: 'year', year: 2026 });
    expect(next).toEqual({ type: 'year', year: 2027 });
  });
});

// ---------------------------------------------------------------------------
// aggregate — real PDF: monthly view
// ---------------------------------------------------------------------------

describe('aggregate with real May 2026 statement — monthly', () => {
  let view: ReturnType<typeof aggregate>;

  beforeAll(() => {
    view = aggregate([realStatement], { type: 'month', year: 2026, month: 5 });
  });

  it('totals.totalSpend === 26986712 (acceptance number)', () => {
    expect(view.totals.totalSpend).toBe(26_986_712);
  });

  it('totals.totalCashback === 519020 (acceptance number)', () => {
    expect(view.totals.totalCashback).toBe(519_020);
  });

  it('statementCount === 1', () => {
    expect(view.statementCount).toBe(1);
  });

  it('byCategory values sum to a positive number', () => {
    const sum = view.byCategory.reduce((a, e) => a + e.value, 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('byCategory entries each have pct in [0,1]', () => {
    for (const entry of view.byCategory) {
      expect(entry.pct).toBeGreaterThanOrEqual(0);
      expect(entry.pct).toBeLessThanOrEqual(1);
    }
  });

  it('byCategory pcts sum to ≈ 1', () => {
    const pctSum = view.byCategory.reduce((a, e) => a + e.pct, 0);
    expect(pctSum).toBeCloseTo(1, 5);
  });

  it('subPeriods.length === 31 (May has 31 days)', () => {
    expect(view.subPeriods.length).toBe(31);
  });

  it('at least one day in subPeriods has value > 0', () => {
    const hasSpend = view.subPeriods.some((d) => d.value > 0);
    expect(hasSpend).toBe(true);
  });

  it('transactions array is non-empty', () => {
    expect(view.transactions.length).toBeGreaterThan(0);
  });

  it('label is "2026-05"', () => {
    expect(view.label).toBe('2026-05');
  });
});

// ---------------------------------------------------------------------------
// aggregate — real PDF: yearly view
// ---------------------------------------------------------------------------

describe('aggregate with real May 2026 statement — yearly', () => {
  let view: ReturnType<typeof aggregate>;

  beforeAll(() => {
    view = aggregate([realStatement], { type: 'year', year: 2026 });
  });

  it('subPeriods.length === 12', () => {
    expect(view.subPeriods.length).toBe(12);
  });

  it('exactly one month (May = index 4) has value > 0', () => {
    const nonZero = view.subPeriods.filter((p) => p.value > 0);
    expect(nonZero.length).toBe(1);
    expect(view.subPeriods[4].label).toBe('May');
    expect(view.subPeriods[4].value).toBeGreaterThan(0);
  });

  it('all other months have value 0', () => {
    for (let i = 0; i < 12; i++) {
      if (i !== 4) expect(view.subPeriods[i].value).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// aggregate — hand-built Q2 (months 4,5,6) quarterly view
// ---------------------------------------------------------------------------

describe('aggregate with hand-built Q2 statements — quarterly', () => {
  const apr = makeStatement(2026, 4, {
    totalSpend: 5_000_000,
    totalInstallments: 1_000_000,
    totalCashback: 100_000,
    totalFeesAndInterest: 10_000,
  });
  const may = makeStatement(2026, 5, {
    totalSpend: 6_000_000,
    totalInstallments: 2_000_000,
    totalCashback: 200_000,
    totalFeesAndInterest: 20_000,
  });
  const jun = makeStatement(2026, 6, {
    totalSpend: 7_000_000,
    totalInstallments: 3_000_000,
    totalCashback: 300_000,
    totalFeesAndInterest: 30_000,
  });

  const spec: PeriodSpec = { type: 'quarter', year: 2026, quarter: 2 };
  let view: ReturnType<typeof aggregate>;

  beforeAll(() => {
    view = aggregate([apr, may, jun], spec);
  });

  it('statementCount === 3', () => {
    expect(view.statementCount).toBe(3);
  });

  it('totals.totalSpend sums correctly', () => {
    expect(view.totals.totalSpend).toBe(18_000_000);
  });

  it('totals.totalInstallments sums correctly', () => {
    expect(view.totals.totalInstallments).toBe(6_000_000);
  });

  it('totals.totalCashback sums correctly', () => {
    expect(view.totals.totalCashback).toBe(600_000);
  });

  it('totals.totalFeesAndInterest sums correctly', () => {
    expect(view.totals.totalFeesAndInterest).toBe(60_000);
  });

  it('subPeriods.length === 3', () => {
    expect(view.subPeriods.length).toBe(3);
  });

  it('subPeriods labels are Apr, May, Jun', () => {
    expect(view.subPeriods.map((p) => p.label)).toEqual(['Apr', 'May', 'Jun']);
  });

  it('excludes statements outside Q2 (e.g. March)', () => {
    const mar = makeStatement(2026, 3, { totalSpend: 9_999_999 });
    const filtered = filterStatements([mar, apr, may, jun], spec);
    expect(filtered.length).toBe(3);
  });

  it('label is "Q2 2026"', () => {
    expect(view.label).toBe('Q2 2026');
  });
});

// ---------------------------------------------------------------------------
// aggregate — cross-statement merchant accumulation
// ---------------------------------------------------------------------------

describe('aggregate — cross-statement merchant accumulation', () => {
  /** Build a minimal Transaction with a spend category and positive amountVnd. */
  function makeTx(
    description: string,
    amountVnd: number,
    dateStr: string,
  ): Statement['transactions'][number] {
    return {
      date: dateStr,
      postingDate: dateStr,
      description,
      currency: 'VND',
      originalAmount: amountVnd,
      amountVnd,
      category: 'Shopping', // not in NON_SPEND
      isInstallment: false,
      isInternational: false,
    };
  }

  // Two statements in the same period (Q2 2026)
  const stmtA: Statement = {
    ...makeStatement(2026, 4),
    transactions: [
      makeTx('GRAB', 200_000, '2026-04-10'),
      makeTx('SHOPEE', 500_000, '2026-04-12'),
    ],
  };
  const stmtB: Statement = {
    ...makeStatement(2026, 5),
    transactions: [
      makeTx('GRAB', 300_000, '2026-05-03'),
      makeTx('TIKI', 400_000, '2026-05-20'),
    ],
  };

  const spec: PeriodSpec = { type: 'quarter', year: 2026, quarter: 2 };
  let view: ReturnType<typeof aggregate>;

  beforeAll(() => {
    view = aggregate([stmtA, stmtB], spec);
  });

  it('GRAB total equals sum across both statements (200_000 + 300_000)', () => {
    const grab = view.topMerchants.find((m) => m.merchant === 'GRAB');
    expect(grab).toBeDefined();
    expect(grab!.value).toBe(500_000);
  });

  it('topMerchants is sorted descending by value', () => {
    for (let i = 0; i < view.topMerchants.length - 1; i++) {
      expect(view.topMerchants[i].value).toBeGreaterThanOrEqual(
        view.topMerchants[i + 1].value,
      );
    }
  });

  it('topMerchants is capped at 10 entries', () => {
    // Build 12 statements with distinct merchants to exceed the 10-entry cap
    const stmts: Statement[] = Array.from({ length: 12 }, (_, idx) => ({
      ...makeStatement(2026, 4),
      transactions: [
        makeTx(`MERCHANT_${idx + 1}`, (12 - idx) * 100_000, '2026-04-01'),
      ],
    }));
    const bigView = aggregate(stmts, { type: 'quarter', year: 2026, quarter: 2 });
    expect(bigView.topMerchants.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// aggregate — empty input
// ---------------------------------------------------------------------------

describe('aggregate with empty input', () => {
  it('monthly: all zero totals, empty arrays, subPeriods full-length zero-filled', () => {
    const view = aggregate([], { type: 'month', year: 2026, month: 5 });
    expect(view.statementCount).toBe(0);
    expect(view.totals.totalSpend).toBe(0);
    expect(view.totals.totalInstallments).toBe(0);
    expect(view.totals.totalCashback).toBe(0);
    expect(view.totals.totalFeesAndInterest).toBe(0);
    expect(view.transactions).toEqual([]);
    expect(view.byCategory).toEqual([]);
    expect(view.topMerchants).toEqual([]);
    // May has 31 days, all zero
    expect(view.subPeriods.length).toBe(31);
    expect(view.subPeriods.every((p) => p.value === 0)).toBe(true);
  });

  it('yearly: subPeriods length 12, all zero', () => {
    const view = aggregate([], { type: 'year', year: 2026 });
    expect(view.subPeriods.length).toBe(12);
    expect(view.subPeriods.every((p) => p.value === 0)).toBe(true);
  });

  it('quarterly: subPeriods length 3, all zero', () => {
    const view = aggregate([], { type: 'quarter', year: 2026, quarter: 2 });
    expect(view.subPeriods.length).toBe(3);
    expect(view.subPeriods.every((p) => p.value === 0)).toBe(true);
  });
});
