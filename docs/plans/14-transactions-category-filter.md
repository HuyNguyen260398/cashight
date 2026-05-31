# Step 14 — Transactions Table: Filter by Category

> Add a category filter to the Transactions table so the user can narrow the list to a single category. Pure client-side; no API or aggregation changes.

**Estimated effort:** 30–45 minutes
**Prerequisites:** Step 10 (transactions table exists)
**Phase:** 4 — Pre-deployment feature pass

---

## Goal

Above the Transactions table, a dropdown lets the user pick a category (default **"All categories"**). The table (desktop) and the card list (mobile) both show only matching rows. The existing date/amount sorting still works on the filtered set.

## Tasks

All changes are in `app/components/transactions-table.tsx` (already a `'use client'` component).

1. **Derive the category list** from the incoming `transactions` prop:
   ```ts
   const categories = Array.from(new Set(transactions.map((t) => t.category))).sort();
   ```
   Memoize with `useMemo` keyed on `transactions`.

2. **Add filter state:** `const [category, setCategory] = useState<string>('all');`

3. **Apply the filter before the existing sort:**
   ```ts
   const visible = category === 'all'
     ? transactions
     : transactions.filter((t) => t.category === category);
   // then sort `visible` with the existing comparator
   ```

4. **Render the control** above the desktop table and mobile list. Use a native styled `<select>` to avoid adding a new dependency:
   ```tsx
   <select
     value={category}
     onChange={(e) => setCategory(e.target.value)}
     className="rounded-md border bg-background px-3 py-1.5 text-sm"
   >
     <option value="all">All categories</option>
     {categories.map((c) => <option key={c} value={c}>{c}</option>)}
   </select>
   ```
   (Optional upgrade: a shadcn/radix `Select` for visual consistency — only if you want it; not required.)

5. **Empty-after-filter state:** if `visible.length === 0`, render a muted "No transactions in this category." row/line in both layouts instead of an empty table body.

## Files affected

- `app/components/transactions-table.tsx` — modify (filter state, control, empty state)

## Acceptance criteria

- Selecting a category narrows both the desktop table and the mobile card list to that category.
- "All categories" restores the full list.
- Sorting by Date / Amount still works while a filter is active.
- Choosing a category with no rows (shouldn't normally happen since the list is derived from present data) shows the muted empty message, not a blank table.
- `pnpm build` and `pnpm lint` pass.

## Notes & gotchas

- Categories must be derived from the **current** `transactions` prop, not a hardcoded list — the set of categories changes per period.
- Keep it controlled and local; **do not** push the filter into the URL/searchParams. Period state lives in the URL (project convention), but a transient table filter is local UI state and should reset when the period changes (which it will, because the component remounts with new data).

## Next step

[Step 15 — Software & Subscriptions KPI card](./15-software-subscriptions-card.md)
