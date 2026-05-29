# Step 08 — Aggregation Engine

> Build the library that rolls up multiple statements into monthly, quarterly, or yearly aggregates.

**Estimated effort:** 2 hours
**Prerequisites:** Step 07
**Phase:** 2 — Persistence

---

## Goal

Pure, well-tested functions that take a list of statements and a period spec, and return an aggregated view shaped like a single statement (so dashboard components from Step 04 work unchanged).

## Tasks

### Period types (`lib/period.ts`)

```ts
export type PeriodType = 'month' | 'quarter' | 'year';

export interface PeriodSpec {
  type: PeriodType;
  year: number;
  month?: number;    // required when type === 'month'
  quarter?: number;  // required when type === 'quarter'
}

export function periodLabel(spec: PeriodSpec): string {
  if (spec.type === 'year') return `${spec.year}`;
  if (spec.type === 'quarter') return `Q${spec.quarter} ${spec.year}`;
  const mm = spec.month!.toString().padStart(2, '0');
  return `${spec.year}-${mm}`;
}

export function quarterOf(month: number): number {
  return Math.ceil(month / 3);
}

export function previousPeriod(spec: PeriodSpec): PeriodSpec { /* ... */ }
export function nextPeriod(spec: PeriodSpec): PeriodSpec { /* ... */ }
```

### Aggregation library (`lib/aggregations.ts`)

```ts
import type { Statement, Transaction } from './schemas';
import type { PeriodSpec } from './period';
import { quarterOf } from './period';

export interface AggregatedView {
  spec: PeriodSpec;
  label: string;
  statementCount: number;
  totals: {
    totalSpend: number;
    totalInstallments: number;
    totalCashback: number;
    totalFees: number;
    totalInterest: number;
  };
  transactions: Transaction[];   // flattened across statements
  byCategory: Array<{ category: string; value: number; pct: number }>;
  topMerchants: Array<{ merchant: string; value: number }>;
  subPeriods: Array<{ label: string; value: number }>;  // for trend chart
}

export function filterStatements(statements: Statement[], spec: PeriodSpec): Statement[] {
  return statements.filter((s) => {
    if (s.period.year !== spec.year) return false;
    if (spec.type === 'year') return true;
    if (spec.type === 'quarter') return quarterOf(s.period.month) === spec.quarter;
    return s.period.month === spec.month;
  });
}

export function aggregate(statements: Statement[], spec: PeriodSpec): AggregatedView {
  const filtered = filterStatements(statements, spec);
  const allTxns = filtered.flatMap((s) => s.transactions);

  const totals = filtered.reduce(
    (acc, s) => ({
      totalSpend: acc.totalSpend + s.totals.totalSpend,
      totalInstallments: acc.totalInstallments + s.totals.totalInstallments,
      totalCashback: acc.totalCashback + s.totals.totalCashback,
      totalFees: acc.totalFees + s.totals.totalFees,
      totalInterest: acc.totalInterest + s.totals.totalInterest,
    }),
    { totalSpend: 0, totalInstallments: 0, totalCashback: 0, totalFees: 0, totalInterest: 0 }
  );

  const byCategory = aggregateByCategory(allTxns);
  const topMerchants = aggregateByMerchant(allTxns).slice(0, 10);
  const subPeriods = computeSubPeriods(filtered, spec);

  return {
    spec,
    label: periodLabel(spec),
    statementCount: filtered.length,
    totals,
    transactions: allTxns,
    byCategory,
    topMerchants,
    subPeriods,
  };
}

function aggregateByCategory(txns: Transaction[]) { /* ... */ }
function aggregateByMerchant(txns: Transaction[]) { /* ... */ }

function computeSubPeriods(statements: Statement[], spec: PeriodSpec) {
  // year → 12 monthly buckets
  // quarter → 3 monthly buckets
  // month → daily buckets (1..31)
  // Return Array<{ label, value }> for the trend chart
}
```

### Trend computation

The `subPeriods` array drives the trend chart in Step 09. For each period type:

| Period type | Sub-period | Example labels |
|---|---|---|
| `year` | One bucket per month | `Jan`, `Feb`, ..., `Dec` |
| `quarter` | One bucket per month | `Jan`, `Feb`, `Mar` (for Q1) |
| `month` | One bucket per day | `1`, `2`, ..., `31` |

Always return 12 / 3 / N buckets even if some are empty (zero-fill) so the chart renders consistently.

### Unit tests (`lib/__tests__/aggregations.test.ts`)

Worth writing tests for this one — it's pure logic and easy to verify. Use Vitest:

```bash
pnpm add -D vitest @vitest/ui
```

Test cases:
- Single statement, monthly view → totals match input
- Three statements in Q2, quarterly view → totals sum correctly
- Yearly view with statements from multiple months → 12-month sub-period array
- Empty input → zero totals, empty arrays
- Categorization rollup matches expected per-category sums

Add `"test": "vitest"` to `package.json` scripts.

## Files affected

- `lib/period.ts` — **create**
- `lib/aggregations.ts` — **create**
- `lib/__tests__/aggregations.test.ts` — **create**
- `package.json` — add vitest

## Acceptance criteria

- `pnpm test` runs and passes
- For the sample PDF statement (May 2026), `aggregate([statement], { type: 'month', year: 2026, month: 5 })` produces:
  - `totals.totalSpend === 26986712`
  - `totals.totalCashback === 519020`
  - `byCategory` contains entries summing to roughly the total
  - `subPeriods` has 31 daily buckets, with the days having transactions populated
- `aggregate([statement], { type: 'year', year: 2026 })` returns 12 sub-periods, only May has non-zero value

## Notes & gotchas

- **Pure functions, no side effects.** Everything in this step is testable in isolation. Use the test to drive correctness, not the UI.
- **Don't mutate inputs.** Aggregation functions should return new objects. Easier debugging, no React re-render surprises.
- **Sub-period zero-filling matters** for the trend chart — Recharts handles missing data points oddly. Always return the full N buckets.
- **Installments are confusing.** Master plan §13.4 flags this — for now, include them in `totalInstallments` separately and let the dashboard decide whether to add to `totalSpend`. Default: don't double-count in any single KPI.
- **Date-fns is already installed** (Step 01). Use it for any date math here (`startOfMonth`, `endOfYear`, etc.) instead of hand-rolling.
- **Performance is not a concern.** Even at 36 statements × ~30 transactions = ~1000 rows, this all runs in <10ms.

## Next step

[Step 09 — Period selector & multi-period dashboard](./09-period-selector.md)
