# Step 23 — Statements Table: Sorting & Pagination

> Add sortable **Period** and **Total spend** column headers plus pagination (max 12 rows per page) to the Statements page table. Pure client-side.

**Estimated effort:** 40–60 minutes
**Prerequisites:** Step 22 (reusable `components/ui/pagination.tsx` exists), Step 07/09 (statements table exists)
**Phase:** 7 — Dashboard UX refinements

---

## Goal

On the Statements page, the **Period** and **Total spend** column headers become clickable to sort ascending/descending (with a sort indicator), mirroring the dashboard Transactions table pattern. The table shows a maximum of 12 rows per page using the `Pagination` control from Step 22. Card, Uploaded, and Actions headers stay non-sortable. Delete still works (and does not strand an empty page after `router.refresh()`).

## Tasks

All changes are in `app/components/statements-table.tsx` (already `'use client'`). Reuse `Pagination` from `@/components/ui/pagination`.

1. **Add sort types + a `SortIndicator`** mirroring `app/components/transactions-table.tsx`:
   ```ts
   type SortKey = 'period' | 'totalSpend';
   type SortDir = 'asc' | 'desc';
   interface SortState { key: SortKey; dir: SortDir; }
   ```
   Copy the small `SortIndicator` helper (the `↕ / ▲ / ▼` span) from the transactions table.

2. **Add state:**
   ```ts
   const [sort, setSort] = useState<SortState>({ key: 'period', dir: 'desc' });
   const PAGE_SIZE = 12;
   const [page, setPage] = useState(1);
   ```
   Add a `toggleSort(key)` with the same toggle semantics as the transactions table, and call `setPage(1)` inside it.

3. **Sort the rows:**
   ```ts
   const sorted = [...rows].sort((a, b) => {
     const cmp =
       sort.key === 'period'
         ? a.year - b.year || a.month - b.month
         : a.totalSpend - b.totalSpend;
     return sort.dir === 'asc' ? cmp : -cmp;
   });
   const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
   const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
   ```

4. **Make the two headers sortable** — keep Total spend right-aligned:
   ```tsx
   <TableHead
     className="cursor-pointer select-none"
     onClick={() => toggleSort('period')}
   >
     Period
     <SortIndicator sortKey="period" active={sort.key} dir={sort.dir} />
   </TableHead>
   ...
   <TableHead
     className="cursor-pointer select-none text-right"
     onClick={() => toggleSort('totalSpend')}
   >
     Total spend
     <SortIndicator sortKey="totalSpend" active={sort.key} dir={sort.dir} />
   </TableHead>
   ```
   Leave `Card`, `Uploaded`, and `Actions` headers as-is.

5. **Render `paged` instead of `rows`** in `<TableBody>`.

6. **Clamp the page** when `rows` changes (after a delete → `router.refresh()`):
   ```ts
   useEffect(() => {
     if (page > pageCount) setPage(1);
   }, [pageCount, page]);
   ```

7. **Render the control** below the `<Table>`, inside the existing `overflow-x-auto` wrapper:
   ```tsx
   <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
   ```

## Files affected

- `app/components/statements-table.tsx` — modify (sort state + indicators, page slice, control)

## Acceptance criteria

- Clicking **Period** or **Total spend** toggles asc/desc with a visible indicator; the other column shows the inactive `↕`.
- At most 12 rows render per page; the control hides when there are ≤12 statements.
- Deleting a statement (which calls `router.refresh()`) re-renders without leaving the user on an empty page.
- `pnpm build`, `pnpm lint`, and `pnpm tsc --noEmit` pass.

## Notes & gotchas

- `app/statements/page.tsx` already pre-sorts rows by year/month desc. That's harmless — the client `sort` now governs display order. Do not move sorting to the server.
- Default sort `period`/`desc` matches the page's current order so the table looks unchanged until the user interacts.
- Keep sort/page state local; do not put it in the URL.

## Commits

One commit per task (see the Git workflow note in [`00-INDEX.md`](./00-INDEX.md)). Ship sorting first (render the sorted rows), then layer pagination on top — each leaves the table working and green.

| Commit | Covers | Message |
|--------|--------|---------|
| 1 | Tasks 1, 2 (sort state), 3 (sort), 4 | `feat(statements): add sortable Period and Total spend headers` |
| 2 | Tasks 2 (page state), 5, 6, 7 | `feat(statements): paginate table at 12 rows per page` |

## Next step

[Step 24 — Chart vibrancy & straight axis labels](./24-chart-vibrancy-and-axis.md)
