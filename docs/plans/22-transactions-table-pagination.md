# Step 22 — Transactions Table Pagination

> Add a reusable pagination control and apply it to the dashboard Transactions table so it shows a maximum of 10 rows per page. Pure client-side; layers on top of the existing sort.

**Estimated effort:** 45–60 minutes
**Prerequisites:** Step 14 (transactions table with client-side sort exists)
**Phase:** 7 — Dashboard UX refinements

---

## Goal

The Transactions table renders at most 10 rows per page with Prev / Next controls and a "Page X of Y" label. Pagination drives **both** the desktop `<Table>` and the mobile card list from the same slice. The existing Date / Category / Amount sort still works; changing the sort resets to page 1. A new `components/ui/pagination.tsx` primitive is introduced for reuse by Step 23.

## Tasks

### 1. Create the reusable pagination control

Create `components/ui/pagination.tsx` — a fully controlled, presentational client component (no internal page state):

```tsx
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Pagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" /> Prev
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums">
        Page {page} of {pageCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

### 2. Wire pagination into the transactions table

All remaining changes are in `app/components/transactions-table.tsx` (already `'use client'`).

1. **Add constants/state** near the existing `sort` state:
   ```ts
   const PAGE_SIZE = 10;
   const [page, setPage] = useState(1);
   ```

2. **Derive the page slice** after the existing `sorted` computation:
   ```ts
   const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
   const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
   ```

3. **Render `paged` instead of `sorted`** in BOTH the desktop `<TableBody>` map and the mobile card-list map.

4. **Reset to page 1 on sort change** inside `toggleSort` (`setPage(1)` after `setSort`).

5. **Clamp the page** when the data prop changes so a delete/period switch never strands an empty page:
   ```ts
   useEffect(() => {
     if (page > pageCount) setPage(1);
   }, [pageCount, page]);
   ```

6. **Render the control** once, below both views (inside the component's returned root — wrap the existing fragment in a parent `<div>` if needed):
   ```tsx
   <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
   ```

## Files affected

- `components/ui/pagination.tsx` — create (reusable controlled pagination control)
- `app/components/transactions-table.tsx` — modify (page state, slice, reset-on-sort, control)

## Acceptance criteria

- With more than 10 transactions, exactly 10 rows render per page; Prev is disabled on page 1 and Next on the last page.
- The desktop table and the mobile card list show the identical 10-row slice.
- Changing the Date / Category / Amount sort resets to page 1 and re-pages the sorted set.
- A period with ≤10 transactions shows no pagination control (it returns `null`).
- `pnpm build`, `pnpm lint`, and `pnpm tsc --noEmit` pass.

## Notes & gotchas

- Keep pagination **client-side and local** — do not push page number into the URL/searchParams. Period state owns the URL (project convention); the table page is transient UI state that should reset when the period changes (the component remounts with new data).
- Slice **after** sorting, not before, or paging will show the wrong rows.
- The category filter from Step 14 (if present) must run **before** the slice so pagination reflects the filtered set; reset to page 1 when the filter changes too.

## Commits

One commit per task (see the Git workflow note in [`00-INDEX.md`](./00-INDEX.md)). The reusable control ships first (it builds standalone), then the table is wired to it.

| Commit | Covers | Message |
|--------|--------|---------|
| 1 | Task 1 | `feat(ui): add reusable controlled Pagination control` |
| 2 | Task 2 (sub-steps 1–6) | `feat(transactions): paginate table at 10 rows per page` |

## Next step

[Step 23 — Statements table sorting & pagination](./23-statements-table-sort-pagination.md)
