# Step 24 — Chart Vibrancy & Straight Axis Labels

> Make the Spending trend, Total installments, and Top merchants charts more vibrant, and fix the slanted x-axis tick labels in the trend and installment charts so digits render horizontally.

**Estimated effort:** 45–60 minutes
**Prerequisites:** Step 04 (charts exist)
**Phase:** 7 — Dashboard UX refinements

---

## Goal

Three charts currently render in `var(--primary)` (near-black in light mode, near-white in dark mode) and the two time-series charts angle their x-axis labels at -45°. After this step:

- **Spending trend**, **Total installments**, and **Top merchants** use vibrant, theme-safe colors (gradients).
- **Spending trend** and **Total installments** x-axis digits are horizontal (straight) and readable.

## Tasks

### A. Vibrant colors

1. **`app/components/trend-chart.tsx`** — replace the `<Bar fill="var(--primary)">` with a gradient. Add a `<defs>` inside `<BarChart>` and reference it:
   ```tsx
   <defs>
     <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0%" stopColor="#6366f1" />
       <stop offset="100%" stopColor="#8b5cf6" />
     </linearGradient>
   </defs>
   ...
   <Bar dataKey="value" fill="url(#trendGradient)" radius={[4, 4, 0, 0]} />
   ```

2. **`app/components/installment-area-chart.tsx`** — replace `stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.2}` with a teal area gradient:
   ```tsx
   <defs>
     <linearGradient id="installmentGradient" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.6} />
       <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.05} />
     </linearGradient>
   </defs>
   ...
   <Area
     type="monotone"
     dataKey="value"
     stroke="#14b8a6"
     fill="url(#installmentGradient)"
   />
   ```

3. **`app/components/merchant-bar.tsx`** — replace `<Bar fill="var(--primary)">` with a horizontal gradient:
   ```tsx
   <defs>
     <linearGradient id="merchantGradient" x1="0" y1="0" x2="1" y2="0">
       <stop offset="0%" stopColor="#f97316" />
       <stop offset="100%" stopColor="#ec4899" />
     </linearGradient>
   </defs>
   ...
   <Bar dataKey="value" fill="url(#merchantGradient)" radius={[0, 4, 4, 0]} />
   ```

### B. Straight x-axis labels

4. In **`app/components/trend-chart.tsx`** and **`app/components/installment-area-chart.tsx`**, change the `<XAxis>` from:
   ```tsx
   <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-45} textAnchor="end" height={48} />
   ```
   to horizontal labels:
   ```tsx
   <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" textAnchor="middle" height={28} />
   ```
   Also reduce the chart `margin.bottom` from `24` back toward `8`–`12` since angled clearance is no longer needed.

5. **Overlap check (month view):** the month view can produce ~28–31 daily buckets. Verify labels do not collide. `interval="preserveStartEnd"` thins them automatically; if it's still dense, drop `tick` font to `10` or keep `interval={0}` only if the labels are short enough to fit.

## Files affected

- `app/components/trend-chart.tsx` — modify (bar gradient + straight axis + margin)
- `app/components/installment-area-chart.tsx` — modify (area gradient + straight axis + margin)
- `app/components/merchant-bar.tsx` — modify (bar gradient)

## Acceptance criteria

- Spending trend, Total installments, and Top merchants render in vibrant colors (not the monochrome `--primary`) in **both** light and dark themes.
- Spending trend and Total installments x-axis digits are horizontal and not overlapping in month, quarter, and year views.
- No recharts `width(-1)`/`height(-1)` console warnings (keep the numeric `height` on `ResponsiveContainer`).
- `pnpm build` and `pnpm lint` pass.

## Notes & gotchas

- Gradients use explicit hex stops, so they are **theme-independent** and avoid the contrast problem of `var(--primary)`. The hexes are drawn from `lib/category-colors.ts` for visual consistency.
- Keep the numeric `height={280}` (and `350` for merchants) on `ResponsiveContainer` — the existing comments explain this prevents the first-render `-1` warning. Don't switch to `height="100%"`.
- Each `<defs>` gradient `id` must be unique across the page; the three ids above (`trendGradient`, `installmentGradient`, `merchantGradient`) are distinct.

## Commits

One commit per task group (see the Git workflow note in [`00-INDEX.md`](./00-INDEX.md)). The two concerns — vibrancy and the axis fix — are independent and map cleanly to one commit each.

| Commit | Covers | Message |
|--------|--------|---------|
| 1 | Task group A (1–3) | `style(charts): use vibrant gradients for trend, installment, and merchant charts` |
| 2 | Task group B (4–5) | `fix(charts): render trend and installment x-axis labels horizontally` |

## Next step

[Step 25 — Scroll-to-top floating button](./25-scroll-to-top-button.md)
