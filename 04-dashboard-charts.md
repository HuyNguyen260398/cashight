# Step 04 — Dashboard Charts

> Replace the JSON preview with the actual dashboard: KPI cards, category donut, top merchants, cumulative spend chart, and transactions table.

**Estimated effort:** 3–4 hours
**Prerequisites:** Step 03
**Phase:** 1 — MVP

---

## Goal

After upload, the user sees a polished dashboard with five components rendering data from the parsed statement. Mobile-responsive layout.

## Tasks

### Layout structure

Build the dashboard as a grid on `/upload` (or factor out to a `<Dashboard>` component that takes a `Statement`):

```
┌─────────────────────────────────────────────┐
│  KPI cards (4-5 across, 2x2 on mobile)      │
├──────────────────────┬──────────────────────┤
│  Category donut      │  Top merchants bar   │
├──────────────────────┴──────────────────────┤
│  Cumulative spend line                       │
├─────────────────────────────────────────────┤
│  Transactions table                          │
└─────────────────────────────────────────────┘
```

### Components to build

**1. `app/components/kpi-cards.tsx`** — five cards in a responsive grid:
- Total spent (sum of `debitVND` for non-installment, non-fee transactions)
- Fees & interest (sum of `Fees & Interest` category)
- Cashback received (sum of cashback section)
- Biggest transaction (max debitVND, show description)
- Minimum payment due (from `statement.totals.minimumPayment`)

Use `shadcn/ui` `<Card>`. Format VND with `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })`.

**2. `app/components/category-pie.tsx`** — donut chart using Recharts:
```tsx
<ResponsiveContainer width="100%" height={300}>
  <PieChart>
    <Pie data={data} dataKey="value" nameKey="category" innerRadius={60} outerRadius={100} />
    <Tooltip formatter={(v: number) => formatVND(v)} />
    <Legend />
  </PieChart>
</ResponsiveContainer>
```
Aggregate transactions by category, sort descending, use a fixed color palette.

**3. `app/components/merchant-bar.tsx`** — horizontal bar chart, top 10 merchants by total spend:
- Aggregate transactions by `merchant` field
- Sort descending, slice top 10
- Use Recharts `<BarChart layout="vertical">`

**4. `app/components/daily-spend-line.tsx`** — cumulative spend across the month:
- Group transactions by `txnDate`, sum debit per day
- Compute running total day by day
- Render with Recharts `<AreaChart>` showing cumulative line + filled area below
- X-axis: day of month, Y-axis: cumulative VND

**5. `app/components/transactions-table.tsx`** — sortable table using shadcn/ui `<Table>`:
- Columns: Date, Description, Category (badge), Amount
- Sortable by date and amount (use TanStack Table if you want, or simple `useState` sort)
- On mobile, collapse to a card list (one card per transaction)
- Category column uses `<Badge>` colored by category

### Aggregation helpers

Create `lib/dashboard-aggregations.ts` with pure functions:
```ts
export function totalSpend(s: Statement): number;
export function byCategory(s: Statement): Array<{ category: string; value: number }>;
export function topMerchants(s: Statement, n: number): Array<{ merchant: string; value: number }>;
export function cumulativeByDay(s: Statement): Array<{ day: number; cumulative: number }>;
```

These will be reused in Step 08 when building multi-period aggregation.

### Wire it together

Update `app/upload/page.tsx` to render the dashboard once `statement` is set:
```tsx
{statement && <Dashboard statement={statement} />}
```

## Files affected

- `app/components/kpi-cards.tsx` — **create**
- `app/components/category-pie.tsx` — **create**
- `app/components/merchant-bar.tsx` — **create**
- `app/components/daily-spend-line.tsx` — **create**
- `app/components/transactions-table.tsx` — **create**
- `app/components/dashboard.tsx` — **create** (composes the five above)
- `lib/dashboard-aggregations.ts` — **create**
- `app/upload/page.tsx` — modify (use Dashboard instead of `<pre>`)

## Acceptance criteria

- Upload the sample PDF → see the complete dashboard
- KPI totals match the statement: total spend ≈ 26,986,712 VND, cashback = 519,020 VND
- Donut chart shows categories with percentages
- Top merchants bar shows Memoryzone and other installment merchants at the top (since those are the biggest debits)
- Cumulative spend line goes from 0 at the start of the period to roughly the statement total at the end
- Transaction table is sortable
- Layout looks good at 390px (iPhone), 768px (iPad), and 1440px (desktop)

## Notes & gotchas

- **Recharts is responsive by default** when wrapped in `<ResponsiveContainer>`. Don't set fixed widths.
- **Don't try to chart 27 transactions individually** — the merchant bar chart aggregates first, then shows top 10.
- **Installments are a big chunk of the statement (~10M VND).** Decide whether to include them in "Total spent" KPI or surface them separately. The master plan §13.4 flags this as an open question — for now, include them with a footnote.
- **Color palette:** define category colors in one place (`lib/category-colors.ts`) and import everywhere for consistency.
- **Mobile table → card layout:** use a simple Tailwind responsive class (`hidden md:table` + `md:hidden block`) rather than a JS-based switch.
- **No persistence still.** This step shows the dashboard for the currently uploaded statement only.

## Next step

[Step 05 — AI summary integration](./05-ai-summary.md)
