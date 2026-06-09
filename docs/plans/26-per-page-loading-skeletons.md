# Step 26 — Per-Page Loading Skeletons

> Add route-level loading skeletons for the Statements and Upload pages so every primary page has a loading effect (the dashboard already has `app/loading.tsx`).

**Estimated effort:** 25–35 minutes
**Prerequisites:** Step 07/09 (statements page), Step 03 (upload page), Step 10 (`app/loading.tsx` skeleton pattern exists)
**Phase:** 7 — Dashboard UX refinements

---

## Goal

Navigating to `/statements` shows a table-shaped skeleton while the server fetches statements from S3; navigating to `/upload` shows a header + dropzone skeleton during the route transition. Both reuse the shadcn `Skeleton` + `Card` pattern already established in `app/loading.tsx`, and both match their page's container width.

## Tasks

1. **Create `app/statements/loading.tsx`** — default-exported skeleton matching `app/statements/page.tsx`'s shell (`container mx-auto p-4 md:p-6 max-w-5xl`):
   ```tsx
   import { Skeleton } from '@/components/ui/skeleton';

   export default function Loading() {
     return (
       <main className="container mx-auto p-4 md:p-6 max-w-5xl">
         <div className="flex items-center justify-between gap-4 mb-6">
           <Skeleton className="h-8 w-40" />
           <Skeleton className="h-9 w-36" />
         </div>
         <div className="space-y-3">
           {Array.from({ length: 12 }).map((_, i) => (
             <Skeleton key={i} className="h-12 w-full" />
           ))}
         </div>
       </main>
     );
   }
   ```
   (Twelve rows mirrors the Step 23 page size.)

2. **Create `app/upload/loading.tsx`** — default-exported skeleton matching `app/upload/page.tsx` (`container mx-auto p-6 max-w-4xl` in its empty state):
   ```tsx
   import { Skeleton } from '@/components/ui/skeleton';

   export default function Loading() {
     return (
       <main className="container mx-auto p-6 max-w-4xl">
         <Skeleton className="h-8 w-56 mb-6" />
         <Skeleton className="h-48 w-full rounded-lg" />
       </main>
     );
   }
   ```

3. **(Optional)** lightly refine `app/loading.tsx` so its transactions skeleton hints at ~10 rows and the KPI skeleton shows up to 6 cards, keeping it visually consistent with Steps 21–22. Cosmetic only; skip if it already reads well.

## Files affected

- `app/statements/loading.tsx` — create
- `app/upload/loading.tsx` — create
- `app/loading.tsx` — optional cosmetic refinement

## Acceptance criteria

- Navigating to `/statements` shows the skeleton before the statements table renders (verify with network throttling or a slow S3 response).
- Navigating to `/upload` shows the skeleton during the route transition.
- Each skeleton's container width matches its page so there's no layout jump when content loads.
- `pnpm build` and `pnpm lint` pass.

## Notes & gotchas

- `app/statements/page.tsx` is an async server component that awaits S3 — its `loading.tsx` shows during that fetch via the App Router Suspense boundary. This is where the loading effect matters most.
- `app/upload/page.tsx` is a client component with no server `await`, so its `loading.tsx` mainly covers the navigation/compile transition rather than a data fetch — still valid and expected for a consistent "every page has a loading effect" experience.
- Match the page wrapper classes exactly (read each `page.tsx` first) to avoid a visible width shift when the real content swaps in.

## Commits

One commit per task (see the Git workflow note in [`00-INDEX.md`](./00-INDEX.md)). Each `loading.tsx` is an independent, buildable addition. Commit 3 is optional and only lands if you do the cosmetic refinement.

| Commit | Covers | Message |
|--------|--------|---------|
| 1 | Task 1 | `feat(statements): add route loading skeleton` |
| 2 | Task 2 | `feat(upload): add route loading skeleton` |
| 3 *(optional)* | Task 3 | `style(dashboard): refine loading skeleton for icons and pagination` |

## Next step

This is the final step of Phase 7 — Dashboard UX refinements. Run `pnpm build`, `pnpm lint`, `pnpm tsc --noEmit`, and `pnpm test`, then smoke-test the dashboard, Statements, and Upload pages.
