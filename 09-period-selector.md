# Step 09 — Period Selector & Multi-Period Dashboard

> Build the month / quarter / year switcher and rewire the dashboard to read from S3 and aggregate by the selected period.

**Estimated effort:** 2–3 hours
**Prerequisites:** Step 08
**Phase:** 2 — Persistence

---

## Goal

The homepage (`/`) is now the dashboard. It loads all statements from S3, aggregates them by the period selected in the URL, and renders the same charts as Phase 1 but on aggregated data. Adding a trend chart that breaks the selected period into sub-buckets.

> **Milestone:** Phase 2 complete after this step.

## Tasks

### Period state in the URL

URL is the source of truth — makes the view shareable and bookmarkable:

```
/                              → defaults to current month
/?period=month&year=2026&month=5
/?period=quarter&year=2026&quarter=2
/?period=year&year=2026
```

Reasons for URL over local state:
- Back/forward buttons work as expected
- Easy to deep-link from notifications / external links
- Survives page refresh

### Period selector component (`app/components/period-selector.tsx`)

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PeriodSpec, PeriodType } from '@/lib/period';
import { previousPeriod, nextPeriod, periodLabel } from '@/lib/period';

export function PeriodSelector({ current }: { current: PeriodSpec }) {
  const router = useRouter();

  function setPeriod(spec: PeriodSpec) {
    const params = new URLSearchParams();
    params.set('period', spec.type);
    params.set('year', String(spec.year));
    if (spec.month) params.set('month', String(spec.month));
    if (spec.quarter) params.set('quarter', String(spec.quarter));
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      <Tabs value={current.type} onValueChange={(t) => /* convert type */}>
        <TabsList>
          <TabsTrigger value="month">Month</TabsTrigger>
          <TabsTrigger value="quarter">Quarter</TabsTrigger>
          <TabsTrigger value="year">Year</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => setPeriod(previousPeriod(current))}>
          <ChevronLeft />
        </Button>
        <span className="font-medium min-w-[120px] text-center">{periodLabel(current)}</span>
        <Button size="icon" variant="ghost" onClick={() => setPeriod(nextPeriod(current))}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
```

On mobile (`< 640px`), the layout stacks vertically and the tabs become a segmented control.

### Parse URL → PeriodSpec helper (`lib/period.ts`)

Add a function that reads `searchParams` and returns a validated `PeriodSpec`:

```ts
export function parsePeriodFromSearch(params: URLSearchParams): PeriodSpec {
  const type = (params.get('period') ?? 'month') as PeriodType;
  const now = new Date();
  const year = parseInt(params.get('year') ?? String(now.getFullYear()));

  if (type === 'year') return { type, year };
  if (type === 'quarter') {
    const quarter = parseInt(params.get('quarter') ?? String(quarterOf(now.getMonth() + 1)));
    return { type, year, quarter };
  }
  const month = parseInt(params.get('month') ?? String(now.getMonth() + 1));
  return { type, year, month };
}
```

### Refactor home page (`app/page.tsx`) as a server component

```tsx
import { getAllStatements } from '@/lib/storage';
import { aggregate } from '@/lib/aggregations';
import { parsePeriodFromSearch } from '@/lib/period';
import { Dashboard } from '@/app/components/dashboard';
import { PeriodSelector } from '@/app/components/period-selector';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = new URLSearchParams(await searchParams);
  const spec = parsePeriodFromSearch(params);

  const statements = await getAllStatements();
  const view = aggregate(statements, spec);

  return (
    <main className="container mx-auto p-4 md:p-6 max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-medium">Expense tracker</h1>
        <PeriodSelector current={spec} />
      </header>

      {statements.length === 0 ? (
        <EmptyState />
      ) : (
        <Dashboard view={view} />
      )}
    </main>
  );
}
```

### Update Dashboard to take `AggregatedView` instead of `Statement`

Refactor `app/components/dashboard.tsx` and its children to accept the `AggregatedView` shape from Step 08. The KPI cards, donut, bar, and table all map directly. The cumulative-spend line gets replaced or supplemented by the trend chart below.

### New trend chart component (`app/components/trend-chart.tsx`)

```tsx
'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import type { AggregatedView } from '@/lib/aggregations';
import { formatVND } from '@/lib/format';

export function TrendChart({ view }: { view: AggregatedView }) {
  return (
    <div className="w-full h-[280px]">
      <ResponsiveContainer>
        <BarChart data={view.subPeriods}>
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v: number) => formatVND(v)} />
          <Bar dataKey="value" fill="hsl(var(--primary))" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Place this prominently in the dashboard — it's the main "multi-period" visual.

### Empty state for first run

`app/components/empty-state.tsx`:
```tsx
export function EmptyState() {
  return (
    <div className="text-center py-16">
      <h2 className="text-xl mb-2">No statements yet</h2>
      <p className="text-muted-foreground mb-6">Upload a statement to get started.</p>
      <Button asChild>
        <Link href="/upload">Upload statement</Link>
      </Button>
    </div>
  );
}
```

### Navigation

Add a simple nav header with links to `/` (dashboard), `/upload`, and `/statements`. Keep it minimal — a single row of links on desktop, hamburger menu on mobile if you want polish (but defer to Step 10).

## Files affected

- `app/page.tsx` — rewrite (now the dashboard)
- `app/components/period-selector.tsx` — **create**
- `app/components/trend-chart.tsx` — **create**
- `app/components/empty-state.tsx` — **create**
- `app/components/dashboard.tsx` — refactor (take `AggregatedView`)
- `app/components/kpi-cards.tsx` — refactor (take `AggregatedView`)
- `app/components/category-pie.tsx` — refactor
- `app/components/merchant-bar.tsx` — refactor
- `app/components/transactions-table.tsx` — refactor
- `lib/period.ts` — add `parsePeriodFromSearch`, `previousPeriod`, `nextPeriod`

## Acceptance criteria

- Upload 2-3 statements from different months (re-upload the sample, edit the date fields, or wait for real new statements)
- Visit `/` → see the current month's view by default
- Click "Quarter" tab → switch to quarterly aggregation
- Click "Year" tab → see all 12 months in the trend chart, only the populated months have bars
- Use the chevron arrows to navigate prev/next periods
- Refresh the page → URL state persists the view
- Share the URL with yourself → loads the same view
- At 390px width: layout doesn't break, period selector is usable with thumb

## Notes & gotchas

- **Server component + URL state** is the cleanest pattern in App Router. Don't put period state in React context — URL is more durable.
- **`force-dynamic`** on the page prevents Next.js from caching the aggregated view across periods. Required since S3 content can change.
- **S3 latency** can add 200-500ms to the initial dashboard load. Add a loading skeleton in Step 10.
- **The "current period defaults to today"** logic is in `parsePeriodFromSearch`. If you have no statements for the current month, the dashboard shows zero-value KPIs — which is correct but jarring. Consider defaulting to "most recent month with data" instead; Step 10 polishes this.
- **Trend chart on mobile:** 12 bars in a year view get cramped on a 390px screen. Either rotate labels (`angle={-45}`) or shorten them (`Jan` → `J`).
- **No AI summary in this step** for multi-period views — that's the first task in Step 10.

## Next step

[Step 10 — Polish: error states, empty states, responsive design](./10-polish.md)

> 🎉 **Phase 2 complete.** Multi-period views work. Next, polish for production.
