# Step 27 — Mobile KPI Single Column & Chart Layout Fixes

> Make the six KPI panels stack into a single column on mobile, fix the overlapping title / donut / legend in the **Spending by category** chart, and fix the overlapping y-axis labels in the **Top merchants** chart. Pure presentation; no values, data, schema, or aggregation changes.

**Estimated effort:** 30–45 minutes
**Prerequisites:** Step 21 (KPI panels exist), Step 24 (chart colors/axes)
**Phase:** 7 — Dashboard UX refinements

---

## Goal

Three independent presentation fixes:

1. **KPI panels** — on mobile the six panels (Total Spend, Installments, Software & Subscriptions, Fees & Interest, Cashback, Statements) currently render in **two** columns (`grid-cols-2`). They should render in **one** column on mobile and keep three columns from the `md` breakpoint up.
2. **Spending by category** — the card title, donut, and legend currently overlap because the donut is centered in the full container height and the legend is drawn over its lower edge. After this step the title, donut, and legend each occupy their own vertical band with no overlap, in both themes.
3. **Top merchants** — the y-axis merchant labels overlap each other / get clipped. After this step every label is on its own line, long names are truncated with an ellipsis, and nothing overlaps.

No value, data, `AggregatedView`, schema, or aggregation changes — this is layout/presentation only.

## Tasks

### A. KPI panels: one column on mobile

1. **`app/components/kpi-cards.tsx`** — change the grid wrapper (currently line 24) from two mobile columns to one:
   ```tsx
   // from
   <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
   // to
   <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
   ```
   Leave every `<Card>`, `<CardHeader>`, icon, and value untouched — only the wrapper's column count changes.

### B. Spending by category: stop title / donut / legend overlap

2. **`app/components/category-pie.tsx`** — reserve a dedicated band for the donut and a dedicated band for the legend so neither overlaps the other or the card title above:
   - Increase the `ResponsiveContainer` height from `300` to `320` so the donut + legend both fit.
   - Position and shrink the donut so it sits in the upper area, leaving the bottom for the legend. On `<Pie>` add `cx="50%" cy="45%"` and reduce the radii from `innerRadius={60} outerRadius={100}` to `innerRadius={55} outerRadius={85}`.
   - Pin the legend to the bottom with an explicit height so recharts lays it out below the donut instead of over it: replace `<Legend />` with
     ```tsx
     <Legend
       verticalAlign="bottom"
       height={40}
       iconType="circle"
       wrapperStyle={{ fontSize: 12 }}
     />
     ```

   Resulting chart:
   ```tsx
   <ResponsiveContainer width="100%" height={320}>
     <PieChart>
       <Pie
         data={data}
         dataKey="value"
         nameKey="category"
         cx="50%"
         cy="45%"
         innerRadius={55}
         outerRadius={85}
       >
         {data.map((d) => (
           <Cell key={d.category} fill={categoryColor(d.category)} />
         ))}
       </Pie>
       <Tooltip formatter={(v) => formatVND(Number(v))} />
       <Legend
         verticalAlign="bottom"
         height={40}
         iconType="circle"
         wrapperStyle={{ fontSize: 12 }}
       />
     </PieChart>
   </ResponsiveContainer>
   ```

### C. Top merchants: stop y-axis label overlap

3. **`app/components/merchant-bar.tsx`** — force one label per bar, truncate long merchant names, and give the labels a little more room. Update the `<YAxis>`:
   ```tsx
   // from
   <YAxis
     type="category"
     dataKey="merchant"
     width={140}
     tick={{ fontSize: 12 }}
   />
   // to
   <YAxis
     type="category"
     dataKey="merchant"
     width={160}
     interval={0}
     tick={{ fontSize: 11 }}
     tickFormatter={(v: string) =>
       v.length > 18 ? `${v.slice(0, 17)}…` : v
     }
   />
   ```
   `interval={0}` makes recharts render every category label (no auto-thinning that can collide), the truncating `tickFormatter` keeps each label to one line, and `width={160}` gives the (now smaller) text room without clipping.

## Files affected

- `app/components/kpi-cards.tsx` — modify (grid wrapper: `grid-cols-2` → `grid-cols-1`)
- `app/components/category-pie.tsx` — modify (container height, Pie cx/cy + radii, explicit bottom Legend)
- `app/components/merchant-bar.tsx` — modify (YAxis width, `interval={0}`, smaller font, truncating `tickFormatter`)

## Acceptance criteria

- On a mobile-width viewport the six KPI panels stack in a **single** column; from the `md` breakpoint up they remain **three** columns. Panel values, icons, and headers are unchanged.
- In **Spending by category**, the card title, the donut, and the legend are visually separated with **no overlap** in both light and dark themes, across month / quarter / year views.
- In **Top merchants**, every y-axis label is on its own line, long merchant names are truncated with an ellipsis, and no labels overlap or are clipped.
- No recharts `width(-1)` / `height(-1)` console warnings (the numeric `ResponsiveContainer` heights are preserved).
- `pnpm build` and `pnpm lint` pass.

## Notes & gotchas

- Keep the numeric `height` on every `ResponsiveContainer` (`320` for the pie, `350` for merchants) — the existing comments/pattern in the chart components rely on a numeric height to avoid the first-render `-1` warning. Don't switch to `height="100%"`.
- The donut `cy="45%"` plus the explicit `Legend height={40}` is what creates the two non-overlapping bands; if you only change one of them the overlap can persist. Change both together.
- The truncation threshold (`18` chars) is a presentation choice tuned to `width={160}`; the full merchant name still shows in the tooltip on hover, so no information is lost.
- This step touches only the three named components. Do **not** alter `lib/aggregations.ts`, `AggregatedView`, `categoryColor`, or the merchant/category data shapes.

## Commits

One commit per task group (see the Git workflow note in [`00-INDEX.md`](./00-INDEX.md)). The three fixes are independent and map cleanly to one commit each.

| Commit | Covers | Message |
|--------|--------|---------|
| 1 | Task A (1) | `style(dashboard): stack KPI panels in a single column on mobile` |
| 2 | Task B (2) | `fix(charts): separate title, donut, and legend in spending-by-category chart` |
| 3 | Task C (3) | `fix(charts): prevent top-merchants y-axis label overlap` |

## Next step

_Last step in Phase 7 so far._
