# Step 15 — "Software & Subscriptions" KPI Card

> Add a sixth KPI card showing total spend in the **Software & Subscriptions** category for the selected period — same style as Total Spend / Installments / Fees & Interest / Cashback / Statements.

**Estimated effort:** 15–20 minutes
**Prerequisites:** Step 10 (KPI cards exist)
**Phase:** 4 — Pre-deployment feature pass

---

## Goal

The KPI row gains a "Software & Subscriptions" card whose value equals the Software & Subscriptions slice of the period's category breakdown. No aggregation changes needed — `view.byCategory` already includes this category.

## Tasks

All changes are in `app/components/kpi-cards.tsx`.

1. **Derive the value** from the already-aggregated `view.byCategory`:
   ```ts
   const software =
     view.byCategory.find((c) => c.category === 'Software & Subscriptions')?.value ?? 0;
   ```
   (Use the exact category string from `lib/categorize.ts`: `'Software & Subscriptions'`.)

2. **Add a sixth `<Card>`** in the existing grid, mirroring the others:
   ```tsx
   <Card>
     <CardHeader>
       <CardTitle className="text-sm font-medium text-muted-foreground">
         Software &amp; Subscriptions
       </CardTitle>
     </CardHeader>
     <CardContent>
       <p className="text-2xl font-semibold">{formatVND(software)}</p>
       <p className="mt-1 text-xs text-muted-foreground">Subscriptions this period</p>
     </CardContent>
   </Card>
   ```

3. **Grid check:** the container is `grid grid-cols-2 gap-4 md:grid-cols-3`. Six cards lay out as 3×2 on desktop and 2×3 on mobile — no grid change required, but verify it looks balanced.

## Files affected

- `app/components/kpi-cards.tsx` — modify (derive value + add card)

## Acceptance criteria

- A "Software & Subscriptions" card appears in the KPI row.
- Its value matches the Software & Subscriptions slice in the "Spending by category" donut for the same period.
- For a period with no software spend, the card reads `0 ₫` (not blank/NaN).
- `pnpm build` and `pnpm lint` pass.

## Notes & gotchas

- **No aggregation change.** Reuse `view.byCategory` — do not re-scan transactions in the component, and do not add a field to `AggregatedView`/`AggregatedViewSchema`.
- Match the category string exactly (`'Software & Subscriptions'`, with the ampersand) or the lookup silently returns 0.

## Next step

[Step 16 — Password-protected PDF upload](./16-password-protected-pdf.md)
