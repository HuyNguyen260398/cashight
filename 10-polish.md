# Step 10 — Polish: Error States, Empty States, Responsive Design

> Production polish. Cross-period AI summary, loading states, error handling, mobile-first responsive review, and a proper statements admin view.

**Estimated effort:** 2–3 hours
**Prerequisites:** Step 09
**Phase:** 3 — Polish

---

## Goal

The app feels finished. Every state (loading, empty, error, success) is handled gracefully. Mobile UX is solid. Cross-period AI summaries work.

## Tasks

### Cross-period AI summary

Extend `/api/summarize` to accept an `AggregatedView` instead of just a single statement:

1. Update the route to detect input shape and build different prompts:
   - Single month → "this month" tone, similar to Phase 1
   - Quarter → focus on month-over-month trends within Q
   - Year → highlights, biggest spending months, category shifts

2. Update prompt:
   ```
   You are reviewing {period.label} spending. Compared to a typical month,
   {period.statementCount} statements are aggregated here. Discuss:
   - Total spending and how it breaks down
   - Trends across the sub-periods ({subPeriods.length} buckets)
   - Categories that dominated
   - Anything unusual worth flagging
   ```

3. Same anonymization rules apply — only aggregates, no individual transactions.

4. Cache the summary by period spec — `useMemo` in the component keyed on `JSON.stringify(spec)` to avoid re-calling on every minor re-render.

### Loading states (Skeletons)

Add shadcn `<Skeleton>` to every async surface:

- KPI cards: skeleton bars while statements load
- Charts: skeleton rectangle the size of the chart
- AI summary card: 3-line skeleton paragraph
- Transactions table: 5-row skeleton

### Error boundaries

Two levels:

1. **Page-level**: `app/error.tsx` for unhandled exceptions
   ```tsx
   'use client';
   export default function Error({ error, reset }: { error: Error; reset: () => void }) {
     return (
       <div className="text-center py-16">
         <h2>Something went wrong</h2>
         <p className="text-muted-foreground mb-4">{error.message}</p>
         <Button onClick={reset}>Try again</Button>
       </div>
     );
   }
   ```

2. **Component-level**: inline error states for the AI summary, chart load failures, etc. Already started in Step 05 — extend to handle:
   - Network errors (`fetch` failed)
   - Gemini rate limit (HTTP 429) — show "AI is busy, try again in a minute"
   - Empty data (no transactions in period) — show explanation, not an empty chart

### Empty states

For each period view with zero statements:

```tsx
{view.statementCount === 0 ? (
  <EmptyPeriodState spec={spec} />
) : (
  <Dashboard view={view} />
)}
```

`<EmptyPeriodState>` should be informative: "No statements uploaded for {period.label}. Upload one or [view earlier months]."

### Default to most recent statement

Step 09 noted this: if no statements exist for the current month, default the dashboard to the most recent month that has data.

Logic in `app/page.tsx`:
```ts
const statements = await getAllStatements();
if (!searchParams.period && statements.length > 0) {
  const latest = statements.sort(byDateDesc)[0];
  redirect(`/?period=month&year=${latest.period.year}&month=${latest.period.month}`);
}
```

### Statements admin view (`app/statements/page.tsx`)

Replace the basic list from Step 07 with a proper management UI:

- Table of all uploaded statements (card last4, month, total spend, uploaded date)
- Delete button per row with confirmation dialog
- Link to view each statement's monthly dashboard
- "Upload another" button prominently at top

### Re-upload confirmation

When uploading a statement that overwrites an existing one (same card + same month), show a confirmation dialog before saving:

```
A statement for May 2026 (****9674) already exists.
Replace it? The old version is kept for 90 days.
[Cancel] [Replace]
```

Implement by checking S3 in the parse route before saving and returning a `409 Conflict` with the existing key. Client-side handles by showing the dialog and re-posting with a `?force=true` flag.

### Mobile audit

Test on real device or browser DevTools at 390px width. Check specifically:

- [ ] Period selector — tabs and arrows are tappable (44x44 minimum)
- [ ] KPI cards — readable, not squished
- [ ] Donut chart — legend doesn't overflow
- [ ] Top merchants bar — labels truncate or wrap cleanly
- [ ] Trend chart — X-axis labels don't overlap
- [ ] Transactions table — collapses to card list, expandable rows
- [ ] AI summary — text isn't tiny, no horizontal scroll
- [ ] Upload dropzone — tap target large enough
- [ ] Nav links — visible without horizontal scrolling

### Format helpers (`lib/format.ts`)

Centralize formatters used across components:

```ts
const VND_FORMATTER = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export function formatVND(value: number): string {
  return VND_FORMATTER.format(value);
}

export function formatVNDCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ₫`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K ₫`;
  return `${value} ₫`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(iso));
}
```

Use `formatVND` in KPI cards and tables, `formatVNDCompact` in chart axis labels.

### Sonner toasts

Use shadcn's `<Toaster>` for transient feedback:
- "Statement saved" after upload
- "Statement deleted"
- "Could not generate summary — try again"

Initialize once in `app/layout.tsx`.

### Theming touches (optional)

- Add a dark mode toggle if you want — `next-themes` is two lines of setup
- Consistent category colors across donut, bar, and badges (pull from one source)

## Files affected

- `app/api/summarize/route.ts` — modify (accept AggregatedView)
- `app/components/ai-summary-card.tsx` — modify (handle period changes)
- `app/components/empty-period-state.tsx` — **create**
- `app/error.tsx` — **create**
- `app/page.tsx` — modify (default-to-latest redirect)
- `app/statements/page.tsx` — rewrite (proper management UI)
- `app/api/parse/route.ts` — modify (conflict detection)
- `app/components/upload-dropzone.tsx` — modify (replace confirmation)
- `lib/format.ts` — **create**
- `app/layout.tsx` — add `<Toaster>`
- Various dashboard components — add loading skeletons

## Acceptance criteria

- Visit `/` with no statements uploaded → see helpful empty state
- Visit `/?period=year&year=2025` (no data) → see period-specific empty state
- Upload a statement that already exists → see replace dialog
- Network tab: throttle to slow 3G → see skeletons, then content streams in progressively
- Trigger an error (kill the Gemini API key, reload) → AI summary shows inline error, rest of dashboard still works
- Open on a 390px viewport → no horizontal scroll anywhere, all controls usable
- Period switching is snappy (no full-page jumps)
- Delete a statement from `/statements` → toast confirms, list updates

## Notes & gotchas

- **Don't over-polish.** This is a personal project. A small number of focused improvements beats trying to make it perfect.
- **Error messages should help, not just inform.** "Failed to load statement" is worse than "Could not reach storage. Check that AWS credentials are set in environment variables."
- **Test the conflict flow carefully** — overwriting real financial data unintentionally is bad UX even with versioning saving the day.
- **The "default to latest" redirect** is server-side — Next.js handles it cleanly with `redirect()` from `next/navigation`. Don't try to do it in client useEffect.
- **Skeleton design:** rough rectangles work fine. Don't try to make them look like the final component shape exactly — the user just needs to know something is loading.

## Next step

[Step 11 — Deploy to AWS Amplify](./11-amplify-deployment.md)
