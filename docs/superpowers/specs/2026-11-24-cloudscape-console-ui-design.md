# Cloudscape console UI — design

Date: 2026-11-24 · Branch: `feat/cloudscape-ui` (PRs into `main`)

## Intent

The user likes the current AWS Management Console look (Cloudscape's "visual
refresh", in preview since Nov 2024 and rolled out across AWS consoles through
2026) and thinks it suits a dashboard app like Cashight. Goal: Cashight's UI
is built from the real Cloudscape component library, so it looks and behaves
like a modern AWS console page.

## Goals

- Every authenticated page renders with Cloudscape components: app shell,
  navigation, containers, tables, forms, buttons, alerts, modals, charts.
- Charts use `@cloudscape-design/chart-components` (Highcharts-based).
- Light/dark mode keeps working, now via Cloudscape's visual modes.
- Feature parity: every view, filter, action and data shown today still exists.

## Non-goals

- No changes to data flow, parsers, storage, API calls, auth (OIDC), or the
  domain package. This is a presentation-layer change only.
- No new features beyond what Cloudscape gives for free (e.g. table
  sorting/preferences are fine where cheap; no new reports).
- No pixel-for-pixel copy of any specific AWS console page.

## Anti-goals (failure even if it "works")

- **AWS branding in the app.** No AWS logo, "AWS"/"Amazon" product name in the
  top bar, AWS smile, or Amazon Ember font. Cashight keeps its own name and
  icon. Cloudscape (Apache-2.0) is the design system; AWS's brand is not ours.
- Breaking URL-as-source-of-truth: period and bank still live in the query
  string (`?period=…&year=…&bank=…`); no moving them into component state.
- Two design systems visibly mixed on one screen at the end of the project.
- Regressing PCI hygiene (e.g. a new component surfacing raw data that was
  previously hidden).

## Constraints (from the codebase)

- Next.js 16, React 19, `output: 'export'` static SPA on CloudFront/S3 — no
  server rendering of dynamic data. Cloudscape renders client-side; pages that
  use it are `'use client'`.
- `@cloudscape-design/components` v3 (Apache-2.0, peer `react >=16.8`).
- `@cloudscape-design/chart-components` v1 peers: `highcharts ^12.6.2`,
  `@cloudscape-design/components ^3`, `@cloudscape-design/design-tokens ^3`.
  **Pin `highcharts` to `^12`** — v13 is the npm latest and is outside the
  peer range. Highcharts is free for personal/non-commercial use only; Cashight
  is a single-user personal app, so this is acceptable, and the licence is
  noted in the README.
- `pnpm` 11.2.2, Tailwind 4 currently present, vitest + Testing Library unit
  tests in `app/__tests__/` (14 files), Playwright e2e in `tests/e2e/` (5 specs).

## Current state

- Shell: `app/components/nav.tsx` → `admin-shell.tsx` (sidebar + header),
  `dashboard-nav.tsx`, `mobile-nav.tsx`, `nav-links.tsx`, `theme-toggle.tsx`
  (`next-themes`).
- Routes: `/` renders the bank statement dashboard when it has bank/period
  params (`hasBankDashboardContext`), otherwise redirects to
  `DEFAULT_DASHBOARD_HREF` = `/aws/cost-explorer/`. `/statements` and
  `/upload` are legacy redirects (`LegacyStatementRedirect`) to
  `/?bank=…#statement-history` / `#statement-upload` — upload and history are
  sections of `bank-statement-dashboard.tsx`, sharing its bank/period state.
  Also `/aws/cost-explorer`, `/aws/billing-invoice`, `/signin`, `/auth/callback`.
- Shipped nav (`dashboard-nav.tsx`): group *AWS budget* → Cost Explorer,
  Billing Invoice; group *Bank statements* → **TPB** (`/?bank=TPBank`),
  **VIB** (`/?bank=VIB`). Active state for bank leaves reads `?bank=` as well
  as the path. Sidebar has a collapsed icon-rail mode with a keyboard flyout.
  `tests/e2e/dashboard-navigation.spec.ts` asserts the link texts, group
  `aria-expanded`, and `?bank=`-aware active state.
- Primitives: shadcn/ui in `components/ui/` (button ×25 imports, card ×14,
  table, skeleton, alert-dialog, pagination ×4–5, input, badge, checkbox, tabs,
  select, collapsible), `sonner` toasts, `lucide-react` icons (29 files),
  `react-dropzone` upload.
- Charts (Recharts): `category-pie`, `merchant-bar`, `trend-chart`,
  `installment-area-chart`, `chart-tooltip`, `aws-cost-explorer/cost-usage-graph`,
  `aws-invoices/invoice-monthly-trend`, plus `invoice-cost-usage-graph`.
- Theme: TailAdmin-style tokens in `app/globals.css`, Geist fonts.

## Approaches considered

1. **Re-skin shadcn/Tailwind with Cloudscape tokens** — least rework, keeps
   every customisation, but only approximates the console (behaviour, density,
   table/AppLayout patterns differ).
2. **Replace with the real Cloudscape library** — exact console look and
   behaviour, built-in a11y and dark mode; rewrites most UI and conflicts with
   Tailwind's global reset. **Chosen by the user.**

Charts, sub-decision:

1. Built-in charts in `@cloudscape-design/components` — no extra deps, less
   capable, being superseded.
2. **`@cloudscape-design/chart-components` + Highcharts** — what newer consoles
   use, more capable; adds Highcharts (licence + bundle size). **Chosen by the user.**
3. Keep Recharts restyled — least work, visibly off-system.

## Design

### Shell and navigation

- `@cloudscape-design/global-styles` imported once in the root layout (brings
  Cloudscape's base styles and its default **Open Sans** font).
- Authenticated pages wrap in a single client `ConsoleShell`:
  - `TopNavigation`: identity = "Cashight" + existing `app/icon.svg`; utilities
    = theme (light/dark/system) menu, density (comfortable/compact) menu, user
    menu with the email and "Sign out".
  - `AppLayout` with `SideNavigation` mirroring today's nav exactly:
    expandable section *AWS budget* → Cost Explorer, Billing Invoice;
    expandable section *Bank statements* → TPB (`/?bank=TPBank`), VIB
    (`/?bank=VIB`). Link labels unchanged. `activeHref` is computed with the
    same pathname + `?bank=` logic as today. Plus `BreadcrumbGroup` and a
    `Flashbar` slot for notifications.
  - Routing is unchanged: `/` default redirect, legacy `/statements` and
    `/upload` redirects, and the `#statement-upload` / `#statement-history`
    anchors on the bank dashboard all keep working.
  - The collapsed icon-rail + flyout is replaced by AppLayout's standard
    open/close navigation (Cloudscape has no icon rail).
  - Mobile: AppLayout's built-in collapsible navigation replaces `mobile-nav`.
- Navigation uses Next's router (`onFollow` → `preventDefault` +
  `router.push`) so links stay client-side, and `activeHref` reflects the
  current pathname.
- `/signin` and `/auth/callback` render without the shell, centred
  `Container` + `Button` in Cloudscape style.

### Visual mode and density

- `applyMode(Mode.Light|Mode.Dark)` and `applyDensity(Density.Comfortable|
  Compact)` from `@cloudscape-design/global-styles`. Preference persisted in
  `localStorage`; "system" follows `prefers-color-scheme`. `next-themes` is
  removed.
- Highcharts follows the mode through chart-components' own theming (verify
  during the spike; see Risks).

### Component mapping

| Today | Cloudscape |
|---|---|
| Card | `Container` + `Header` |
| KPI cards | `Container` + `KeyValuePairs` (or `ColumnLayout variant="text-grid"` + `Box variant="awsui-value-large"`) |
| Table + pagination + filter | `Table` + `Pagination` + `TextFilter`/`PropertyFilter`, via `@cloudscape-design/collection-hooks` |
| Button | `Button` (`primary`/`normal`/`link`/`icon`) |
| Select / BankSelector / PeriodSelector | `Select` (+ `SegmentedControl` for month/quarter/year) |
| Input / Checkbox | `Input`, `Checkbox` inside `FormField` |
| Tabs / Collapsible | `Tabs`, `ExpandableSection` |
| AlertDialog | `Modal` with footer `SpaceBetween` actions |
| Badge | `Badge` / `StatusIndicator` |
| Skeleton / spinner / loading | `Spinner`, `StatusIndicator type="loading"`, table/chart `loading` states |
| sonner toasts | `Flashbar` fed by a small notifications context in the shell |
| Upload dropzone | `FileUpload` (+ `FileDropzone` if available in the installed version); `react-dropzone` removed |
| Empty states | Cloudscape empty-state pattern (`Box textAlign="center"` + action) |
| AI summary (streaming text) | `Container` with streamed text; Cloudscape gen-AI patterns optional |
| lucide icons | Cloudscape `Icon` names; lucide kept only where no equivalent exists |
| Recharts charts | `PieChart` (donut), `CartesianChart` (bar/line/area) from chart-components |

### Pages

Each page uses `ContentLayout` + `Header` (title, description, actions) and
`SpaceBetween`/`Grid` for layout. Period and bank selectors sit in the page
header actions and keep writing to the URL exactly as today, preserving each
other's params.

### Styling and Tailwind

- Migrate page by page with Tailwind still present; at the end remove Tailwind,
  `tw-animate-css`, shadcn `components/ui/`, `components.json`, Geist,
  `next-themes`, `sonner`, `recharts`, `class-variance-authority`,
  `tailwind-merge`, and the TailAdmin tokens in `globals.css`.
- Any residual custom styling uses CSS modules referencing
  `@cloudscape-design/design-tokens`, never hard-coded hex values.
- Tailwind's preflight can override Cloudscape base styles; during migration
  verify no visible conflict, and if there is, disable preflight early.

### Migration order

1. Spike: install packages, shell + one chart on Cloudscape, confirm static
   export build, dark mode, Highcharts theming.
2. Shell + navigation for all routes; sign-in page.
3. Bank statement dashboard as one page: KPIs, charts, transactions table, AI
   summary, upload section and statement history section (anchors kept).
4. AWS Cost Explorer dashboard (incl. filter builder, report parameters, saved
   reports).
5. AWS Billing invoice dashboard.
6. Remove old stack, clean `globals.css`, update docs (`docs/codebase/STACK.md`,
   CLAUDE.md UI mentions).

Each step is its own commit and leaves the app building and tests passing.

### Testing

- Update unit tests to query by role/label/text (Cloudscape exposes proper
  ARIA); where needed use `@cloudscape-design/components/test-utils/dom`
  wrappers. Keep every existing behavioural assertion (URL params, bank
  selection, period switching, chart data mapping).
- Chart tests assert the series/data passed to chart components rather than
  rendered SVG (Highcharts rendering in jsdom is unreliable).
- Update Playwright selectors in the same commit as each UI step; e2e flows
  unchanged. `dashboard-navigation.spec.ts` is rewritten for SideNavigation
  (same link texts and active-state rules; flyout assertions replaced by
  nav open/close). `current-production.spec.ts` keeps its `/upload` and
  `/statements` deep-link assertions, which stay valid because routing is
  unchanged; its selectors will match production again once this ships.
- `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build` (static export)
  green at the end of every step.

## Risks

- **Bundle size**: Cloudscape + Highcharts is heavier than today. Import
  components per path (`@cloudscape-design/components/button`) and lazy-load
  chart components; measure the build output before/after.
- **Static export compatibility**: Cloudscape touches `window` in some
  components — mitigated by `'use client'` and the spike in step 1.
- **Highcharts theming/dark mode** with chart-components needs confirmation
  in the spike.

## Decided by the user

- Replace UI with the real Cloudscape library (not a re-skin).
- Charts via `@cloudscape-design/chart-components` (Highcharts).

## Builder's calls (Claude's proposals, open to correction)

- Open Sans (Cloudscape default) instead of Geist; no Amazon Ember.
- Add a comfortable/compact density toggle next to the theme toggle.
- Flashbar replaces toast notifications.
- Remove Tailwind and shadcn entirely at the end.
- Collapsed icon-rail/flyout dropped in favour of AppLayout's nav toggle.
- Bank dashboard stays one page (upload + history sections included).
- Incremental migration on one feature branch, one commit per step.
