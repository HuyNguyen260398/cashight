# Cloudscape Console UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cashight's shadcn/Tailwind/Recharts UI with the real Cloudscape component library and Cloudscape chart-components, so the app looks and behaves like a current AWS console page, with no change to data flow or routing.

**Architecture:** A single client `ConsoleShell` (Cloudscape `AppLayout` + `TopNavigation` + `SideNavigation` + `Flashbar`) replaces `AdminShell`. Pure helper modules (nav model, visual settings, chart series builders) carry the testable logic; Cloudscape components render it. Pages are migrated one at a time with Tailwind still installed, then the old stack is removed.

**Tech Stack:** Next.js 16 static export (`output: 'export'`), React 19, `@cloudscape-design/components` v3, `@cloudscape-design/global-styles`, `@cloudscape-design/collection-hooks`, `@cloudscape-design/design-tokens` v3, `@cloudscape-design/chart-components` v1, `highcharts` ^12, vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-cloudscape-console-ui-design.md`

## Global Constraints

- Presentation layer only: do not change `frontend/api`, `frontend/hooks`, `frontend/auth`, `frontend/lib`, `lib/`, `packages/domain`, parsers, or routes. Only exception: `frontend/hooks/use-pdf-upload-job.ts` may swap its `sonner` import for the notifications API (Task 2).
- Routing unchanged: `/` default redirect to `/aws/cost-explorer/`, `/statements` and `/upload` legacy redirects, and the `#statement-upload` / `#statement-history` anchors keep working.
- URL is the source of truth for period and bank state (`?period=…&year=…&month=…&quarter=…&bank=…`); selectors keep preserving each other's params exactly as `period-selector.tsx` / `bank-selector.tsx` do today.
- No AWS branding: no AWS logo, no "AWS"/"Amazon" in the top-bar identity, no Amazon Ember. Identity is "Cashight" + `app/icon.svg`. Page titles that already say "AWS Cost Explorer" etc. stay, since they describe the data.
- `highcharts` pinned to `^12` (v13 is outside chart-components' peer range `^12.6.2`).
- Import Cloudscape components per path (`@cloudscape-design/components/button`), never from the package root.
- No hard-coded hex colours in new code; use Cloudscape components, props, or `@cloudscape-design/design-tokens`. Exception: `lib/category-colors.ts` keeps defining category colours for chart series, so a merchant bar matches its category slice.
- PCI hygiene: show only the fields shown today. No new column, tooltip, or detail view may expose description/card data that is hidden today.
- Every task ends with `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, and `pnpm build` passing.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Cmd/Ctrl/middle-click on nav links** must still open a new tab. The client-side `onFollow` handler may only `preventDefault()` for plain left clicks on internal hrefs. Test in Task 2.
2. **Bank leaf active state with extra params**: on `/?bank=VIB&period=quarter&year=2026&quarter=2`, VIB is active and TPB is not; on `/aws/billing-invoice/` neither bank is active. Test in Task 2.
3. **Hash anchors under AppLayout**: `/upload` → `/?bank=TPBank#statement-upload` must scroll the upload section into view, below the sticky top navigation. Test in Task 5 (e2e).
4. **Theme switch at runtime**: toggling dark mode must restyle open charts without a reload, and the saved choice must apply before first paint on the next visit (no light flash in dark mode). Test in Tasks 1 and 4.
5. **Charts with no data**: a period with zero categories, merchants or cost series shows the chart's empty state, not a blank box or a crash. Test in Tasks 4 and 6.

---

## File Structure

New:
- `app/components/console/console-shell.tsx` — AppLayout + TopNavigation + SideNavigation + Flashbar; client component.
- `app/components/console/nav-model.ts` — pure: nav items and `activeHrefFor()`.
- `app/components/console/follow.ts` — pure: `shouldHandleClientSide()` for `onFollow` events.
- `app/components/console/visual-settings.ts` — pure-ish: load/save/apply mode and density.
- `app/components/console/notifications.tsx` — Flashbar context: `NotificationsProvider`, `useNotify()`, `notify` singleton for non-React callers.
- `app/components/console/visual-settings-script.tsx` — inline pre-paint script that applies the saved mode.
- `app/components/charts/use-highcharts.ts` — lazy-loads Highcharts on the client.
- `app/components/charts/*-series.ts` — pure series builders, one per chart.
- `vitest.setup.ts` — jsdom shims Cloudscape needs.

Replaced/removed by the end: `admin-shell.tsx`, `dashboard-nav.tsx`, `mobile-nav.tsx`, `nav-links.tsx`, `theme-toggle.tsx`, `theme-provider.tsx`, `chart-tooltip.tsx`, `scroll-to-top.tsx` (if AppLayout makes it redundant), `components/ui/*`, `components.json`, Tailwind, Geist, `next-themes`, `sonner`, `recharts`, `react-dropzone`, `class-variance-authority`, `tailwind-merge`, `tw-animate-css`.

---

### Task 1: Foundation — packages, global styles, visual settings, Highcharts loader

**Files:**
- Modify: `package.json`, `app/layout.tsx`, `vitest.config.ts`
- Create: `vitest.setup.ts`, `app/components/console/visual-settings.ts`, `app/components/console/visual-settings-script.tsx`, `app/components/charts/use-highcharts.ts`
- Test: `app/__tests__/visual-settings.test.ts`

**Interfaces:**
- Produces:
  - `type ModePreference = 'light' | 'dark' | 'system'`; `type DensityPreference = 'comfortable' | 'compact'`
  - `interface VisualSettings { mode: ModePreference; density: DensityPreference }`
  - `const VISUAL_SETTINGS_KEY = 'cashight.visual-settings'`
  - `loadVisualSettings(storage?: Pick<Storage,'getItem'>): VisualSettings` — defaults `{ mode: 'system', density: 'comfortable' }` on missing/invalid JSON or unknown values.
  - `saveVisualSettings(settings: VisualSettings, storage?: Pick<Storage,'setItem'>): void`
  - `resolveMode(mode: ModePreference, prefersDark: boolean): 'light' | 'dark'`
  - `applyVisualSettings(settings: VisualSettings): () => void` — calls `applyMode` / `applyDensity` from `@cloudscape-design/global-styles`; for `'system'` subscribes to `matchMedia('(prefers-color-scheme: dark)')` changes; returns an unsubscribe.
  - `<VisualSettingsScript />` — `<script dangerouslySetInnerHTML>` placed in `<head>`; reads `VISUAL_SETTINGS_KEY` and adds Cloudscape's dark-mode class (`awsui-dark-mode`) and compact class (`awsui-compact-mode`) to `document.documentElement` before paint. Confirm the class names against `@cloudscape-design/global-styles` source after install.
  - `useHighcharts(): typeof import('highcharts') | null` — `null` until `import('highcharts')` resolves in an effect.

- [ ] **Step 1: Install packages**

Run: `pnpm add @cloudscape-design/components @cloudscape-design/global-styles @cloudscape-design/collection-hooks @cloudscape-design/design-tokens @cloudscape-design/chart-components highcharts@^12`
Expected: `package.json` lists all six; `pnpm why highcharts` shows a 12.x version.

- [ ] **Step 2: Record the chart-components API**

Open `node_modules/@cloudscape-design/chart-components/` type definitions and note, at the bottom of this plan under "API notes", the exact export names and props for the pie/donut chart and the cartesian chart: series shape, the Highcharts-module prop, axis config, tooltip/detail formatting, empty/no-data, loading, and height props. Tasks 4–7 use these notes.

- [ ] **Step 3: Write the failing tests** in `app/__tests__/visual-settings.test.ts`

```ts
it('defaults when storage is empty or corrupt', () => {
  expect(loadVisualSettings({ getItem: () => null })).toEqual({ mode: 'system', density: 'comfortable' });
  expect(loadVisualSettings({ getItem: () => '{bad' })).toEqual({ mode: 'system', density: 'comfortable' });
  expect(loadVisualSettings({ getItem: () => '{"mode":"neon","density":"compact"}' })).toEqual({ mode: 'system', density: 'compact' });
});
it('round-trips through storage', () => {
  const store = new Map<string, string>();
  saveVisualSettings({ mode: 'dark', density: 'compact' }, { setItem: (k, v) => store.set(k, v) });
  expect(loadVisualSettings({ getItem: (k) => store.get(k) ?? null })).toEqual({ mode: 'dark', density: 'compact' });
});
it('resolves system mode from the media query', () => {
  expect(resolveMode('system', true)).toBe('dark');
  expect(resolveMode('system', false)).toBe('light');
  expect(resolveMode('light', true)).toBe('light');
});
it('applies dark mode and follows system changes until unsubscribed', () => {
  // mock matchMedia with a controllable listener; vi.mock('@cloudscape-design/global-styles')
  // assert applyMode called with Mode.Dark, then Mode.Light after the media query flips,
  // and not again after the returned unsubscribe runs.
});
```

- [ ] **Step 4: Run** `pnpm test app/__tests__/visual-settings.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 5: Implement** `visual-settings.ts`, `visual-settings-script.tsx`, `use-highcharts.ts`.

- [ ] **Step 6: Wire the root layout and test setup**
  - `app/layout.tsx`: `import '@cloudscape-design/global-styles/index.css'` **before** `./globals.css`; render `<VisualSettingsScript />` in `<head>`. Keep `ThemeProvider` for now (Task 2 removes it).
  - `vitest.setup.ts`: shim `window.matchMedia` and `ResizeObserver` only if Cloudscape components throw without them under jsdom; register it in `vitest.config.ts` `test.setupFiles`.

- [ ] **Step 7: Verify** — `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` all pass, and `out/` exists. In `pnpm dev`, check that existing pages still render with no visible conflict from Cloudscape's base styles. If there is a conflict, add a note to the plan; preflight is removed in Task 8.

- [ ] **Step 8: Commit** — `feat(ui): add Cloudscape packages, visual settings and Highcharts loader`

---

### Task 2: Console shell, navigation and notifications

**Files:**
- Create: `app/components/console/nav-model.ts`, `follow.ts`, `notifications.tsx`, `console-shell.tsx`
- Modify: `app/components/nav.tsx` (render `ConsoleShell` instead of `AdminShell`), `app/layout.tsx` (remove `ThemeProvider`, `Toaster`; wrap in `NotificationsProvider`), every `from 'sonner'` importer: `statements-table.tsx`, `bank-statement-dashboard.tsx`, `upload-dropzone.tsx`, `aws-invoices/invoice-history.tsx`, `aws-invoices/aws-invoice-upload.tsx`, `frontend/hooks/use-pdf-upload-job.ts`, plus `frontend/__tests__/upload-flow.test.tsx` and `aws-invoice-flow.test.tsx` mocks
- Delete: `admin-shell.tsx`, `dashboard-nav.tsx`, `mobile-nav.tsx`, `nav-links.tsx`, `theme-toggle.tsx`, `theme-provider.tsx`, `components/ui/sonner.tsx`
- Test: `app/__tests__/nav-model.test.ts`, `app/__tests__/console-shell.test.tsx` (replaces `dashboard-nav.test.tsx`), `tests/e2e/dashboard-navigation.spec.ts`

**Interfaces:**
- Consumes: Task 1 `loadVisualSettings`, `saveVisualSettings`, `applyVisualSettings`, `VisualSettings`.
- Produces:
  - `NAV_ITEMS: SideNavigationProps.Item[]`. An expandable group `"Dashboard"` contains two expandable groups. `"AWS budget"` holds `Cost Explorer` → `/aws/cost-explorer/` and `Billing Invoice` → `/aws/billing-invoice/`. `"Bank statements"` holds `TPB` → `/?bank=TPBank` and `VIB` → `/?bank=VIB`. All groups are `defaultExpanded: true`, and the labels must match these strings exactly.
  - `activeHrefFor(pathname: string, search: URLSearchParams): string | undefined`. On `/`, it returns the bank leaf href when `?bank=` is `TPBank` or `VIB` (other params ignored). Otherwise it returns the leaf whose href is a prefix of `pathname`, or `undefined`. Port this logic from today's `dashboard-nav.tsx:33-45`.
  - `shouldHandleClientSide(e: { detail: { href?: string; external?: boolean }; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; button?: number }): boolean`. It returns true only for a plain left click on an internal href.
  - `notify(item: { type: 'success' | 'error' | 'info' | 'warning'; content: string; id?: string }): void`. This is a module-level function usable outside React (it replaces `toast.success` / `toast.error`). Items auto-dismiss after 5 s, except `error` items, which stay until dismissed.
  - `<NotificationsProvider>` renders nothing itself. `<ConsoleNotifications />` renders the `Flashbar`, and `ConsoleShell` passes it to `AppLayout notifications`.
  - `<ConsoleShell email: string; signOutAction: () => Promise<void>; children>`
    - `TopNavigation` identity: title "Cashight", logo `/icon.svg`, href `/`.
    - Utilities: a theme menu (Light / Dark / System, current one checked), a density menu (Comfortable / Compact), and a user menu labelled with the email that holds a "Sign out" item.
    - Body: `AppLayout` with `toolsHide`, `navigation={<SideNavigation items={NAV_ITEMS} activeHref=… onFollow=…/>}`, `notifications`, and `content`.

- [ ] **Step 1: Write failing unit tests** — `nav-model.test.ts`:

```ts
const q = (s: string) => new URLSearchParams(s);
expect(activeHrefFor('/', q('bank=VIB&period=quarter&year=2026&quarter=2'))).toBe('/?bank=VIB');
expect(activeHrefFor('/', q('bank=TPBank'))).toBe('/?bank=TPBank');
expect(activeHrefFor('/', q(''))).toBeUndefined();
expect(activeHrefFor('/aws/billing-invoice/', q('bank=VIB'))).toBe('/aws/billing-invoice/');
expect(activeHrefFor('/aws/cost-explorer/', q('report=x'))).toBe('/aws/cost-explorer/');
expect(shouldHandleClientSide({ detail: { href: '/aws/cost-explorer/' }, button: 0 })).toBe(true);
expect(shouldHandleClientSide({ detail: { href: '/aws/cost-explorer/' }, metaKey: true })).toBe(false);
expect(shouldHandleClientSide({ detail: { href: '/aws/cost-explorer/' }, ctrlKey: true })).toBe(false);
expect(shouldHandleClientSide({ detail: { href: '/x', external: true } })).toBe(false);
// leaf labels in order
expect(flattenLinks(NAV_ITEMS).map((l) => l.text)).toEqual(['Cost Explorer', 'Billing Invoice', 'TPB', 'VIB']);
```

`console-shell.test.tsx` (jsdom, mock `next/navigation`):
- renders the email and a "Sign out" item; clicking it calls `signOutAction`
- choosing "Dark" in the theme menu calls `saveVisualSettings` with `mode: 'dark'`
- `notify({ type: 'success', content: 'Statement deleted' })` makes the text appear in the Flashbar
- with `pathname='/'` and `?bank=VIB`, the VIB link has `aria-current="page"`

- [ ] **Step 2: Run** `pnpm test app/__tests__/nav-model.test.ts app/__tests__/console-shell.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement** the four console modules. `onFollow` calls `e.preventDefault()` and `router.push(href)` when `shouldHandleClientSide` is true. `AppLayout` `navigationOpen` is controlled state, closed by default below Cloudscape's mobile breakpoint (AppLayout handles this itself when `navigationOpen` is left uncontrolled; prefer uncontrolled unless a test requires otherwise). Breadcrumbs: `BreadcrumbGroup` with `Cashight` → current page label taken from the nav model's active leaf.

- [ ] **Step 4: Replace sonner** — change every `toast.success(x)` / `toast.error(x)` to `notify({ type: 'success' | 'error', content: x })`. Update the two `frontend/__tests__` flow tests to mock `@/app/components/console/notifications` instead of `sonner`, keeping their assertions on the message text.

- [ ] **Step 5: Swap the shell** in `nav.tsx` and `layout.tsx`, then delete the files listed above and `app/__tests__/dashboard-nav.test.tsx`.

- [ ] **Step 6: Rewrite** `tests/e2e/dashboard-navigation.spec.ts` for SideNavigation:
  - Keep: bare `/` lands on `/aws/cost-explorer/`; link texts `['Cost Explorer','Billing Invoice','TPB','VIB']`; groups "Dashboard", "AWS budget", "Bank statements" are expanded; `aria-current="page"` on the active leaf; TPB href `/?bank=TPBank`; switching TPB→VIB moves `aria-current`; no console errors.
  - Replace the collapsed-flyout assertions with: the nav toggle closes and reopens navigation, and the links stay reachable by keyboard.

- [ ] **Step 7: Verify** — the four standard commands pass, plus `pnpm test:e2e tests/e2e/dashboard-navigation.spec.ts`. Manually in `pnpm dev`: Cmd-click "VIB" opens a new tab; the theme and density menus restyle the page; reloading in dark mode shows no light flash.

- [ ] **Step 8: Commit** — `feat(ui): Cloudscape console shell with side navigation and flashbar`

---

### Task 3: Sign-in and auth callback pages

**Files:** Modify `app/signin/page.tsx`, `app/auth/callback/page.tsx`, `app/loading.tsx`, `app/error.tsx`. Test: the existing `frontend/__tests__/auth-provider.test.tsx` stays green; add `app/__tests__/signin-page.test.tsx`.

**Interfaces:** Consumes the existing `frontend/auth/oidc` sign-in function, unchanged. Produces nothing new.

- [ ] **Step 1: Write the failing test** — the sign-in page renders a heading "Sign in to Cashight" and a primary button "Sign in"; clicking the button calls the mocked OIDC sign-in exactly once. Keep today's copy if it differs from this, and assert today's copy instead.
- [ ] **Step 2: Run** it — expect FAIL, either because the copy changed or because Cloudscape markup isn't there yet. Assert `createWrapper(container).findButton()!.getElement()` to prove it is a Cloudscape button.
- [ ] **Step 3: Implement** — centred `Container` with `Header variant="h1"`, `SpaceBetween`, `Button variant="primary"`; callback page uses `StatusIndicator type="loading"`; `loading.tsx` uses `Spinner size="large"`; `error.tsx` uses `Alert type="error"` + retry `Button`.
- [ ] **Step 4: Verify** the standard commands. **Step 5: Commit** `feat(ui): Cloudscape sign-in, callback, loading and error pages`.

---

### Task 4: Bank-statement charts on chart-components

**Files:**
- Create: `app/components/charts/category-series.ts`, `merchant-series.ts`, `trend-series.ts`, `installment-series.ts`
- Modify: `category-pie.tsx`, `merchant-bar.tsx`, `trend-chart.tsx`, `installment-area-chart.tsx` (keep file names and exported component names/props so `dashboard.tsx` is untouched)
- Delete: `chart-tooltip.tsx`, `app/__tests__/chart-tooltip.test.tsx`
- Test: `app/__tests__/bank-chart-series.test.ts`, `app/__tests__/bank-charts.test.tsx`

**Interfaces:**
- Consumes: Task 1 `useHighcharts`, the API notes, `categoryColor` from `@/lib/category-colors`, and `formatVND` / `formatVNDCompact` from `@/lib/format`.
- Produces: pure builders that return the chart-components series type recorded in the API notes.
  - `categoryPieSeries(data: Array<{ category: string; value: number }>)` — one slice per category, `color: categoryColor(category)`, order preserved.
  - `merchantBarSeries(data: Array<{ merchant: string; value: number; category?: string }>)` — a horizontal bar series, with each point coloured by `categoryColor(category ?? '')`.
  - `trendSeries(view: AggregatedView)` and `installmentSeries(view: AggregatedView)`. These carry over whatever x-values and y-series today's Recharts components derive from `view` (read the current files and port the data mapping exactly). Values are formatted with `formatVND` in tooltips and `formatVNDCompact` on the axes.
  - Component props are unchanged: `CategoryPie({ data })`, `MerchantBar({ data })`, `TrendChart({ view })`, `InstallmentAreaChart({ view })`.

- [ ] **Step 1: Write failing series tests.** Assert the exact names, values and colours for a two-category fixture. For `merchantBarSeries`, a merchant with no category gets `categoryColor('')`. For trend and installment, assert the series against a small `AggregatedView` fixture, built with the helpers already used in `lib/__tests__/aggregations.test.ts`. Empty input returns series with no points.
- [ ] **Step 2: Write failing render tests.** Mock `useHighcharts` to return `null` and check that each chart renders without throwing and shows its loading state. Render with an empty `data` and a resolved Highcharts mock, and check that the no-data empty state text is present (Review Focus 5).
- [ ] **Step 3: Run** both — expect FAIL.
- [ ] **Step 4: Implement** the builders and components. Donut = pie chart with an inner radius/donut option; merchant = horizontal (inverted) bar; trend = line; installment = area. Tooltip values use `formatVND`.
- [ ] **Step 5: Verify** the standard commands. Manually in `pnpm dev` on a TPBank month, check that the charts render with the same numbers as `main`. Switch Light→Dark from the top-nav menu and check that the charts restyle without a reload (Review Focus 4).
- [ ] **Step 6: Commit** `feat(ui): bank statement charts on Cloudscape chart-components`

---

### Task 5: Bank statement dashboard page

**Files:** Modify `bank-statement-dashboard.tsx`, `dashboard.tsx`, `kpi-cards.tsx`, `bank-selector.tsx`, `period-selector.tsx`, `ai-summary-card.tsx`, `reveal-panel.tsx`, `empty-state.tsx`, `empty-period-state.tsx`, `transactions-table.tsx`, `statements-table.tsx`, `bank-statement-history.tsx`, `upload-dropzone.tsx`, `spinner.tsx`. Tests: update `bank-selector.test.tsx`, `period-selector.test.tsx`, `bank-statement-dashboard.test.tsx`, `bank-statement-history.test.tsx`, `upload-dropzone.test.tsx`, `frontend/__tests__/upload-flow.test.tsx`; update `tests/e2e/bank-statement-dashboard.spec.ts`.

**Interfaces:**
- Consumes: Task 2 `notify`. All `frontend/hooks/*` unchanged. Exported component names and props stay unchanged.
- Produces: no new exports.

Mapping (from spec):
- Page: `ContentLayout` with a `Header variant="h1"`.
  - Title as today: `"{bank} bank statements"`. The description stays as today.
  - `actions` = `SpaceBetween direction="horizontal"` holding `BankSelector` and `PeriodSelector`.
- `BankSelector` → `Select`. It always includes `current`, even when that bank isn't in `available`; keep the URL-building logic unchanged.
- `PeriodSelector` → `SegmentedControl` for month/quarter/year plus a `Select` for the specific month, quarter or year. Keep the URL-building logic unchanged, including the clearing of stale `month`/`quarter` params.
- KPI cards → `Container` with `KeyValuePairs` (or `ColumnLayout variant="text-grid"` + `Box variant="awsui-value-large"`). The labels and values stay as today.
- The charts from Task 4 each go in a `Container` with a `Header variant="h2"`. Lay them out with `Grid` at 6/6 on desktop and 12 on mobile.
- `TransactionsTable` and `StatementsTable` become a Cloudscape `Table` driven by `useCollection`.
  - Use `TextFilter` and `Pagination` with a page size of 20.
  - The category filter becomes a `Select` in the table's `filter` slot.
  - The columns stay exactly as today, with no new columns.
- Statement delete → `Modal`. The confirm button in the footer is `Button variant="primary"` and the cancel button is `variant="link"`. Keep today's copy.
- `UploadDropzone` → `FileDropzone` + `FileUpload` (or `FileUpload` alone if `FileDropzone` is absent in the installed version). Accept only `application/pdf`.
  - Keep the job-progress states and all copy.
  - Show progress with a `ProgressBar` / `StatusIndicator`.
  - Remove `react-dropzone` from this file.
- AI summary → `Container`. Keep the streamed text rendering and the reveal toggle, using `ExpandableSection` where `reveal-panel` is used.
- Error and notice blocks → `Alert` (`type="error"` / `"info"`) with an action `Button`.
- Skeletons → `StatusIndicator type="loading"` inside a `Container`, or a `loading` prop where the component has one.
- Keep the section ids `statement-upload` and `statement-history`.

- [ ] **Step 1: Update tests first.** Keep every behavioural assertion: URL params produced by both selectors, the "current bank always listed" rule, upload success navigation, delete → notify text, history retry, and empty/loading/error states. Change only the queries, using role/label/text or `createWrapper()` finders. Add:

```ts
it('lists the current bank even when it has no statements in the period', ...) // BankSelector, existing rule
it('preserves ?bank= when switching period to quarter', ...)                   // PeriodSelector, existing rule
it('paginates transactions at 20 per page', ...)                               // 25-row fixture → page 2 has 5 rows
```

- [ ] **Step 2: Run** the listed test files — expect FAIL on the new queries.
- [ ] **Step 3: Implement** the mapping above, component by component.
- [ ] **Step 4: Update** `tests/e2e/bank-statement-dashboard.spec.ts` selectors. Add (Review Focus 3): go to `/upload`, expect the URL hash `#statement-upload` and the upload section visible in the viewport and not hidden under the top navigation. If it is hidden, set `scroll-margin-top` on the sections from the top-nav height.
- [ ] **Step 5: Verify** — the standard commands plus `pnpm test:e2e tests/e2e/bank-statement-dashboard.spec.ts`.
- [ ] **Step 6: Commit** `feat(ui): bank statement dashboard on Cloudscape`

---

### Task 6: AWS Cost Explorer dashboard

**Files:** Modify every file in `app/components/aws-cost-explorer/` (except `cost-format.ts`), `app/aws/cost-explorer/page.tsx`, `app/aws/components/aws-dashboard-placeholder.tsx`. Create `app/components/charts/cost-series.ts`. Tests: update `cost-explorer-dashboard.test.tsx`, `cost-explorer-parameters.test.tsx`; add `app/__tests__/cost-series.test.ts`; update `tests/e2e/aws-cost-explorer.spec.ts`.

**Interfaces:**
- Consumes: Task 1 `useHighcharts`, the API notes, Task 2 `notify`.
- Produces: `costUsageSeries(input: { request: CostExplorerReportRequest; result: CostExplorerCompleteResult | null; forecast: CostExplorerForecast | null; comparison: CostExplorerComparison | null; chartStyle: 'BAR' | 'STACK' | 'LINE' })`. It returns chart-components series plus x categories, porting today's `standardData`/forecast/comparison mapping in `cost-usage-graph.tsx` exactly (period labels via `formatPeriodLabel`, values via `decimalNumber`). `'STACK'` maps to stacked bars, `'LINE'` to lines, and `'BAR'` to grouped bars. `CostUsageGraph` keeps its props.

Mapping:
- Chart-style toggle → `SegmentedControl` (Bar / Stacked bar / Line).
- Report parameters, filter builder and saved reports → `Form` and `FormField` with `Select`, `Multiselect`, `DateRangePicker` (where a date range is chosen today), `Input`, `Checkbox`, and `ExpandableSection`.
- Save, load and delete → `Button`s. Destructive confirms → `Modal`.
- `cost-breakdown` → `Table` + `useCollection`, with the same columns.
- `cost-overview` → `KeyValuePairs`.
- `cognito-reauth-warning` → `Alert type="warning"` with its existing action.
- Remove the `.cost-explorer-chart` / `.cost-breakdown-scroll` CSS rules from `globals.css`.

- [ ] **Step 1: Write failing `cost-series.test.ts`** — for a 2-period, 2-series result fixture, assert the x categories equal the formatted period labels and each series' y-values equal the `decimalNumber` values. `'STACK'` yields stacked series. A forecast adds a distinguishable forecast series. `result: null` with no forecast gives an empty series list (Review Focus 5).
- [ ] **Step 2: Update the dashboard and parameters tests** to Cloudscape queries, keeping every behavioural assertion (URL ↔ request mapping, saved-report flows, filter add/remove).
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement**.
- [ ] **Step 5: Update** `tests/e2e/aws-cost-explorer.spec.ts` selectors; heading stays "AWS Cost Explorer".
- [ ] **Step 6: Verify** the standard commands + that e2e spec. **Step 7: Commit** `feat(ui): AWS Cost Explorer dashboard on Cloudscape`.

---

### Task 7: AWS Billing invoice dashboard

**Files:** Modify every file in `app/components/aws-invoices/` (except `invoice-format.ts`), `app/aws/billing-invoice/page.tsx`. Tests: update `aws-invoice-components.test.tsx`, `aws-invoice-dashboard.test.tsx`, `invoice-cost-usage-graph.test.tsx`, `frontend/__tests__/aws-invoice-flow.test.tsx`; update `tests/e2e/aws-billing-invoice.spec.ts`.

**Interfaces:**
- Consumes: Task 6 `costUsageSeries` (for `invoice-cost-usage-graph`, which reuses `CostUsageGraph` or its series), `useHighcharts`, `notify`.
- Produces: `invoiceMonthlyTrendSeries(dashboard: AwsInvoiceDashboard)` in `app/components/charts/invoice-series.ts`, porting today's mapping in `invoice-monthly-trend.tsx`. `invoiceCostReportRequest` stays exported unchanged.

Mapping:
- KPI cards → `KeyValuePairs`
- `invoice-services-table` and `invoice-history` → `Table` + `useCollection`
- `aws-invoice-upload` → `FileUpload` (PDF only)
- `invoice-chart-card` → `Container` + `Header`
- AI summary → `Container`, as in Task 5
- Remove the `.aws-invoice-chart` CSS rules

- [ ] **Step 1:** Add a failing `invoiceMonthlyTrendSeries` test to `invoice-cost-usage-graph.test.tsx`, using a 3-month fixture and asserting categories and values. Keep `invoiceCostReportRequest` tests unchanged.
- [ ] **Step 2:** Update the component tests to Cloudscape queries; behavioural assertions unchanged.
- [ ] **Step 3: Run** — expect FAIL. **Step 4: Implement.** **Step 5:** Update e2e selectors.
- [ ] **Step 6: Verify** the standard commands + e2e spec. **Step 7: Commit** `feat(ui): AWS billing invoice dashboard on Cloudscape`.

---

### Task 8: Remove the old UI stack and update docs

**Files:**
- Delete: `components/ui/`, `components.json`, `app/components/scroll-to-top.tsx` (if AppLayout already handles scroll on navigation; otherwise keep it), `lib/chart-colors.ts` (if unused).
- Modify: `app/globals.css` → keep only rules still referenced (expect none or a handful; no TailAdmin tokens, no `@import "tailwindcss"`). `app/layout.tsx` → drop Geist `localFont`. `package.json` → remove `tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css`, `geist`, `next-themes`, `sonner`, `recharts`, `react-dropzone`, `class-variance-authority`, `tailwind-merge`, and `lucide-react` (if no import remains). Also `postcss.config.*`, `lib/utils.ts` `cn` (if unused). Docs: `docs/codebase/STACK.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `CLAUDE.md` (UI/theme mentions only), `README.md` (add the Highcharts licence note: free for personal/non-commercial use).

- [ ] **Step 1: Find leftovers** — `grep -rnE "className=|@/components/ui|recharts|sonner|next-themes|lucide-react|surface-card|tailwind" app frontend components lib` must return nothing that renders UI. Exception: `className` passed to Cloudscape-free wrapper elements is allowed only with a CSS module.
- [ ] **Step 2:** Delete and uninstall as listed; `pnpm install`.
- [ ] **Step 3: Verify** — run the four standard commands, `pnpm test:e2e`, and `pnpm verify:static`. Compare the `pnpm build` First Load JS per route against `main` and note the numbers in the PR description.
- [ ] **Step 4:** Check by hand in `pnpm dev:local`, light and dark, comfortable and compact, at desktop and 375 px width. Cover every route: `/`, `/?bank=VIB`, `/upload`, `/statements`, `/aws/cost-explorer/`, `/aws/billing-invoice/`, and `/signin`.
- [ ] **Step 5: Commit** `chore(ui): remove Tailwind, shadcn and Recharts after Cloudscape migration` and `docs: describe the Cloudscape UI stack`.

---

## API notes (filled in during Task 1, Step 2)

_Empty until Task 1._

Recorded from `@cloudscape-design/chart-components@1.0.167` / `global-styles@1.0.72`:

- Exports: `import { PieChart, CartesianChart } from '@cloudscape-design/chart-components'`; types `PieChartProps`, `CartesianChartProps`.
- Common props (`BaseChartOptions`): `highcharts: null | object` (pass the module from `useHighcharts()`; `null` shows `fallback`), `fallback?`, `chartHeight?`, `fitHeight?`, `ariaLabel?`, `legend?: { enabled?, title? }`, `noData?: { statusType?: 'finished'|'loading'|'error', empty?, error?, loading? }`, `filter?`.
- PieChart: `series: null | { type: 'pie' | 'donut'; name: string; data: { name: string; y: number | null; id?: string; color?: string }[] }`; `tooltip?: { details?: ({segmentName, segmentValue, totalValue}) => {key, value}[] }`; `segmentDescription?`, `innerAreaTitle?`, `innerAreaDescription?`.
- CartesianChart: `series: Array<{ type: 'column'|'line'|'area'|'spline'|'areaspline'|…; name: string; id?: string; color?: string; data: (number | null | { x?: number; y: number | null })[]; dashStyle?; linkedTo? }>`; `inverted?: boolean` (horizontal bars); `stacking?: 'normal'`; `xAxis?: { title?, type?: 'category'|'linear'|'datetime', categories?: string[], valueFormatter? }`; `yAxis?: same + reversedStacks?`; `tooltip?: { point?: ({ item }) => { key?, value?, description? }, header?, body?, footer? }`.
- **No per-point colour** on cartesian points — only per series.
- global-styles: `applyMode(Mode|null, target = document.body)`, `applyDensity(Density|null, target)`; classes `awsui-dark-mode`, `awsui-compact-mode`. The open-source components build is `ALWAYS_VISUAL_REFRESH = true`, `INCLUDE_ONE_THEME = false`.
