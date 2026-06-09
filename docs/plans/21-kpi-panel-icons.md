# Step 21 — KPI Panel Icons

> Add a distinct icon to each of the six KPI panels (Total Spend, Installments, Software & Subscriptions, Fees & Interest, Cashback, Statements). Pure presentation; no value or layout changes.

**Estimated effort:** 20–30 minutes
**Prerequisites:** Step 15 (six KPI cards exist)
**Phase:** 7 — Dashboard UX refinements

---

## Goal

Each KPI card shows a small `lucide-react` icon next to its title, so the row reads at a glance. Values, the `grid grid-cols-2 gap-4 md:grid-cols-3` layout, and the accessible text labels are unchanged. Icons are decorative (`aria-hidden`).

## Tasks

All changes are in `app/components/kpi-cards.tsx` (a server component — no `'use client'` needed; lucide icons render fine server-side).

1. **Import six icons** from the already-installed `lucide-react` (`^1.16.0`):
   ```ts
   import {
     Wallet,            // Total Spend
     CalendarClock,     // Installments
     MonitorSmartphone, // Software & Subscriptions
     Percent,           // Fees & Interest
     PiggyBank,         // Cashback
     FileText,          // Statements
   } from 'lucide-react';
   ```
   Verify each name is exported by the installed major version before relying on it (see gotchas); swap to the nearest equivalent if one is missing.

2. **Update each `<CardHeader>`** to place the icon beside the title. Change the header to a flex row and append the icon after `<CardTitle>`:
   ```tsx
   <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
     <CardTitle className="text-sm font-medium text-muted-foreground">
       Total Spend
     </CardTitle>
     <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />
   </CardHeader>
   ```
   Repeat for the other five cards with their mapped icon. Leave `<CardContent>` untouched.

## Files affected

- `app/components/kpi-cards.tsx` — modify (icon imports + six card headers)

## Acceptance criteria

- All six cards render their title text plus the mapped icon; nothing overflows at the `grid-cols-2` (mobile) or `md:grid-cols-3` (desktop) breakpoints.
- Icons are `aria-hidden`; the title text remains the accessible label.
- Card values are unchanged.
- `pnpm build` and `pnpm lint` pass.

## Notes & gotchas

- `lucide-react` here is the `^1.x` line — its export names can differ from the common `0.x` releases. If an import fails to compile, grep the package's exports (`node -e "console.log(Object.keys(require('lucide-react')))"`) and substitute the nearest icon.
- Do not change card values or add fields to `AggregatedView`. This is presentation-only.

## Commits

One commit per task (see the Git workflow note in [`00-INDEX.md`](./00-INDEX.md)). Tasks 1 and 2 are not independently buildable — an icon import with no usage fails lint — so they land in a single commit.

| Commit | Covers | Message |
|--------|--------|---------|
| 1 | Tasks 1–2 | `feat(dashboard): add icons to the six KPI panels` |

## Next step

[Step 22 — Transactions table pagination](./22-transactions-table-pagination.md)
