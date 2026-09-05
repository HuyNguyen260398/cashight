# Dashboard Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AWS Cost Explorer the default dashboard and integrate bank-specific upload and statement history into TPB and VIB dashboards.

**Architecture:** Preserve existing bank query URLs and static SPA routing. Extract a shared bank dashboard that composes upload, existing analytics, and filtered history; use one complete metadata snapshot and explicit mutation refreshes. Preserve all backend contracts and AWS capability restrictions.

**Tech Stack:** Next.js 16 App Router static export, React 19, TypeScript, Tailwind 4, existing shadcn/ui components, Cognito OIDC, Zod, Vitest/Testing Library, Playwright.

**Spec:** [Dashboard consolidation design](../superpowers/specs/2026-09-05-dashboard-consolidation-design.md)

**Status:** Proposed; planning only. Tasks below have not been implemented or tested.

**Prerequisites:** Shipped Steps 30–32 navigation, auth, Cost Explorer, and Billing Invoice components. The index still has unchecked entries for those steps; inspect actual code rather than interpreting tracker state as missing implementation. Baseline inspected at `f8a844d` on 2026-09-05.

## Global Constraints

- Preserve Next.js static export and `trailingSlash: true`; do not introduce server-only frontend routes.
- Keep pnpm pinned to `11.2.2`; use existing dependencies.
- Keep bank knowledge in `packages/domain/src/banks.ts`; preserve API resolution for absent/unrecognised bank selections.
- Preserve Cognito capability enforcement, feature flags, workspace ownership, and API authorization.
- Preserve deterministic parser detection, PDF password handling, PCI masking, and anonymized Gemini payloads.
- No parser, storage schema, backend API, IAM, Terraform, or data migration is required by this design.
- Use synthetic masked metadata in tests; never log PDFs, passwords, PANs, transaction descriptions, or auth tokens.

## Requirements and decisions

| Requirement | Implementation | Main proof |
| --- | --- | --- |
| R1: Cost Explorer login/default | Tasks 1, 4 | Callback resolver tests; bare-home browser navigation |
| R2: AWS before banks | Task 1 | Ordered accessible link assertions in all shell modes |
| R3: Embedded upload on both banks | Tasks 3, 4 | TPB/VIB composition and upload-completion tests |
| R4: Embedded history on both banks | Tasks 2, 4 | Both bank pages show history, including empty analytics |
| R5: Strict bank history isolation | Tasks 2, 4 | Mixed multi-page metadata, rapid bank switch, row-link tests |
| R6: All Dashboard descendants visible initially | Task 1 | Initial disclosure state, pointer/keyboard, mobile/flyout tests |
| R7: Retire standalone utilities | Tasks 4, 5 | No live utility links; redirect-only legacy routes |

Defaults for review: history spans all months for the selected bank; legacy utility URLs redirect into the integrated sections; a PDF from the other bank opens its parser-detected bank/month after success. These are proposed choices, not separately confirmed preferences.

Keep existing bank URLs (`/?bank=TPBank`, `/?bank=VIB`) instead of adding a new route. Load all metadata pages and reuse the table's 12-row pagination instead of adding a bank-filtered backend endpoint. See the design for tradeoffs and error behavior.

## Files and responsibilities

| File | Action and responsibility |
| --- | --- |
| `frontend/lib/dashboard-routes.ts` | Create: default destination, bank-query recognition, row and compatibility URLs. |
| `frontend/auth/return-to.ts` | Modify: safe callback default. |
| `app/components/dashboard-nav.tsx` | Modify: group order and disclosure state. |
| `app/components/admin-shell.tsx` | Modify: remove utility links and update account dashboard copy. |
| `frontend/lib/statement-history.ts` | Create: complete cursor traversal, metadata-to-row mapping, strict bank filter. |
| `frontend/hooks/use-bank-statements.ts` | Create: shared complete metadata state, cancellation, refresh, deletion. |
| `frontend/hooks/use-dashboard.ts` | Modify: explicit refresh for same-URL mutations. |
| `frontend/hooks/use-upload-job.ts` | Modify: expose existing engine success callback. |
| `app/components/upload-dropzone.tsx` | Modify: selected-bank copy and callback prop. |
| `app/components/bank-statement-dashboard.tsx` | Create: extract and compose existing bank page. |
| `app/components/bank-statement-history.tsx` | Create: history states, retry, table, bank scoping. |
| `app/components/statements-table.tsx` | Modify: bank-preserving links; retain sorting and delete confirmation. |
| `app/page.tsx` | Modify: protected home dispatcher and bank component. |
| `app/components/empty-state.tsx`, `app/components/empty-period-state.tsx` | Modify: inline upload anchor and bank-preserving latest link. |
| `app/components/legacy-statement-redirect.tsx` | Create: protected client compatibility redirect shared by retired routes. |
| `app/upload/page.tsx`, `app/statements/page.tsx` | Replace page bodies with redirect wrappers. |
| `frontend/hooks/use-statements.ts` | Delete after confirming no consumers remain; replaced by complete metadata hook. |
| `scripts/verify-static-export.mjs` | Modify: retain compatibility HTML checks and add AWS page checks. |
| `docs/plans/00-INDEX.md`, `docs/codebase/ARCHITECTURE.md` | Update tracker/reference links and current behavior documentation. |

Test files are named in their owning tasks below. Existing `frontend/auth/auth-provider.tsx`, callback page, protected route, domain bank module, and backend statement handler are reference points, not planned rewrites.

## Tasks

### Task 1: Default login destination and expanded AWS-first navigation

**Files:** Create `frontend/lib/dashboard-routes.ts`, `frontend/__tests__/dashboard-routes.test.ts`; modify `frontend/auth/return-to.ts`, `app/components/dashboard-nav.tsx`, `app/__tests__/dashboard-nav.test.tsx`, `frontend/__tests__/auth-provider.test.tsx`; create `frontend/__tests__/return-to.test.ts`.

**Interfaces:** Export `DEFAULT_DASHBOARD_HREF`, `hasBankDashboardContext(search: URLSearchParams): boolean`, `statementDashboardHref(row: Pick<StatementRow, 'bank' | 'year' | 'month'>): string`, and `legacyStatementHref(search: URLSearchParams, section: 'statement-upload' | 'statement-history'): string` from the route helper. Import `StatementRow` as a type only and use domain bank helpers for normalization/defaults. `resolveOidcCallbackReturn(state)` returns the existing allowlisted route union with Cost Explorer as its fallback.

- [ ] Add behavior tests before changing routing:

  ```ts
  expect(resolveOidcCallbackReturn(undefined)).toBe('/aws/cost-explorer/');
  expect(resolveOidcCallbackReturn({ returnTo: 'https://example.invalid/' }))
    .toBe('/aws/cost-explorer/');
  expect(resolveOidcCallbackReturn({ returnTo: '//example.invalid/' }))
    .toBe('/aws/cost-explorer/');
  expect(hasBankDashboardContext(new URLSearchParams('utm_source=bookmark'))).toBe(false);
  expect(hasBankDashboardContext(new URLSearchParams('bank=VIB'))).toBe(true);
  expect(hasBankDashboardContext(new URLSearchParams('period=quarter&year=2026&quarter=2'))).toBe(true);
  expect(statementDashboardHref({ bank: 'VIB', year: 2026, month: 7 }))
    .toBe('/?bank=VIB&period=month&year=2026&month=7');
  expect(legacyStatementHref(new URLSearchParams('bank=VIB'), 'statement-history'))
    .toBe('/?bank=VIB#statement-history');
  ```

  Add null, primitive, array, malformed-state, valid-return, invalid-bank, and bare compatibility URL cases. Existing external-return callback assertions must now expect Cost Explorer instead of `/`.
- [ ] Run `pnpm test frontend/__tests__/dashboard-routes.test.ts frontend/__tests__/return-to.test.ts frontend/__tests__/auth-provider.test.tsx`; confirm failures correspond to changed behavior.
- [ ] Implement URL helpers and callback fallback:

  ```ts
  export const DEFAULT_DASHBOARD_HREF = '/aws/cost-explorer/' as const;
  export function hasBankDashboardContext(search: URLSearchParams): boolean {
    return ['bank', 'period', 'year', 'month', 'quarter'].some((key) => search.has(key));
  }
  // statementDashboardHref constructs URLSearchParams in bank/period/year/month order.
  // legacyStatementHref clones the input, adds DEFAULT_BANK only with no valid
  // bank or period context, and appends its validated section fragment.
  ```

  Reuse the existing allowlist for callback state; do not add arbitrary `returnTo` support or change authentication provider permissions.
- [ ] Update navigation tests to assert visible initial links in order `Cost Explorer`, `Billing Invoice`, `TPB`, `VIB` without expansion clicks. Cover collapse/reopen of Dashboard and the active group, active descendants, flyout Escape/focus return, mobile leaf close, and trailing-slash route expectations. Existing tests contain assumptions about initially closed groups and some slashless AWS hrefs; update those intentionally.
- [ ] Put the AWS group first and initialize both groups to true. Replace unconditional `state || activeGroup` expansion with explicit user-controlled state. Use a route identity key (`pathname` plus parsed bank) for the disclosure state so a new route resets to expanded defaults; on an unchanged route clicks must collapse normally. Keep flyout open state independently false initially.

  ```ts
  const initiallyOpen = { 'aws-budget': true, 'bank-statements': true };
  // A keyed disclosure child can own dashboardOpen/openGroups and receive
  // pathname + bank. Its route key changes only on a navigation identity change.
  ```

- [ ] Run the three frontend tests above and `pnpm test app/__tests__/dashboard-nav.test.tsx`; run lint/build before the task commit. Suggested commit: `feat(navigation): default to Cost Explorer and expand AWS-first menus`.

### Task 2: Complete metadata loading and bank-isolated history state

**Files:** Create `frontend/lib/statement-history.ts`, `frontend/hooks/use-bank-statements.ts`, `frontend/__tests__/statement-history.test.ts`, `frontend/__tests__/use-bank-statements.test.tsx`; modify `frontend/hooks/use-dashboard.ts`; create `frontend/__tests__/use-dashboard.test.tsx`.

**Interfaces:** `loadStatementHistory(signal?: AbortSignal): Promise<StatementListItem[]>`; `statementRows(items: StatementListItem[], bank: BankCode): StatementRow[]`. `useBankStatements()` returns `{ items: StatementListItem[]; loading: boolean; refreshing: boolean; error: string | null; refresh: () => Promise<StatementListItem[]>; deleteStatement: (id: string) => Promise<void> }`. Extend the existing `useDashboard(spec, bank)` result with `refresh: () => void` without changing existing parameters.

- [ ] Write cursor traversal tests with synthetic metadata. In a Vitest test, mock `apiFetch` and `getPublicConfig`, then use the real response schema:

  ```ts
  const row = (bank: 'TPBank' | 'VIB', statementId: string) => ({
    bank, statementId, cardLast4: statementId.slice(-4),
    statementDate: '2026-07-01', totalSpend: 100,
    transactionCount: 1, uploadedAt: '2026-08-01T00:00:00.000Z',
  });
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(Response.json({ items: [row('TPBank', '2026-07-1111')], nextCursor: 'page-2' }))
    .mockResolvedValueOnce(Response.json({ items: [], nextCursor: 'page-3' }))
    .mockResolvedValueOnce(Response.json({ items: [row('VIB', '2026-07-2222')], nextCursor: null }));
  const items = await loadStatementHistory();
  expect(statementRows(items, 'VIB').map((item) => item.key)).toEqual(['2026-07-2222']);
  expect(statementRows(items, 'TPBank').map((item) => item.key)).toEqual(['2026-07-1111']);
  expect(apiFetch).toHaveBeenCalledTimes(3);
  ```

  Also test duplicate IDs, missing bank -> TPBank, invalid payload, network failure on later page, repeated non-null cursor rejection, and cancellation. Do not return a partial list after any page fails.
- [ ] Run `pnpm test frontend/__tests__/statement-history.test.ts` and observe the expected failure.
- [ ] Implement cursor exhaustion with schema validation and an abort signal on every `apiFetch`. Build a fresh URL for each cursor; never interpret cursor contents. Accumulate in a Map keyed by statementId and publish only after `nextCursor === null`.

  ```ts
  const url = new URL(`${getPublicConfig().apiBaseUrl}/statements`);
  if (cursor !== null) url.searchParams.set('cursor', cursor);
  const response = await apiFetch(url.toString(), { signal });
  const page = StatementsListResponseSchema.parse(await response.json());
  // Before another iteration, reject a nextCursor already in the seen set.
  // Convert year/month from statementDate only in the row mapping helper.
  ```

- [ ] Add hook tests with deferred responses: refresh B wins over refresh A; unmount aborts fetches; delete cancels older loads; failed DELETE retains the row; a refresh failure preserves last complete metadata and exposes an error. Implement request-generation guards and AbortController cleanup. After successful deletion invalidate prior loads and remove the ID immediately; reject deletion errors for the parent/table to report. A later refresh error must be surfaced separately from a DELETE error.
- [ ] Test `useDashboard.refresh()` refetching an unchanged bank and period. Add a refresh epoch to the existing request key and effect dependencies; retain current stale-bank/period suppression:

  ```ts
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const refresh = useCallback(() => setRefreshEpoch((value) => value + 1), []);
  const requestKey = spec ? JSON.stringify({ spec, bank, refreshEpoch }) : null;
  ```

- [ ] Run `pnpm test frontend/__tests__/statement-history.test.ts frontend/__tests__/use-bank-statements.test.tsx frontend/__tests__/use-dashboard.test.tsx`; run lint, typecheck, and build before commit. Suggested commit: `feat(statements): load complete history and refresh client dashboard data`.

### Task 3: Embedded upload callback and bank-aware copy

**Files:** Modify `frontend/hooks/use-upload-job.ts`, `app/components/upload-dropzone.tsx`, `frontend/__tests__/upload-flow.test.tsx`; create `app/__tests__/upload-dropzone.test.tsx`.

**Interfaces:** `useUploadJob(onSucceeded?: (job: UploadJob) => void)` retains its existing state/start/reset result. `UploadDropzone({ bank, onSucceeded }: { bank?: BankCode; onSucceeded?: (job: UploadJob) => void })` supports existing no-prop callers until Task 4. The callback is synchronous at the engine boundary; page-owned async refresh catches its own errors.

- [ ] Extend upload-flow tests to assert callback exactly once on SUCCEEDED and never on conflict/failure. Retain all existing presign headers, checksum, timeout, and forced-overwrite checks. Use the existing flow fixture/harness and a spy callback; assert its payload is the final parsed job:

  ```ts
  const onSucceeded = vi.fn();
  // Pass onSucceeded to the existing test harness's useUploadJob invocation.
  // Drive the existing successful polling fixture through SUCCEEDED.
  expect(onSucceeded).toHaveBeenCalledTimes(1);
  expect(onSucceeded).toHaveBeenCalledWith(expect.objectContaining({ state: 'SUCCEEDED' }));
  ```

- [ ] Run `pnpm test frontend/__tests__/upload-flow.test.tsx` before implementing the callback change.
- [ ] Forward the callback using stable options and the already-supported engine API:

  ```ts
  const options = useMemo(
    () => ({ ...statementUploadOptions, onSucceeded }),
    [onSucceeded],
  );
  return usePdfUploadJob(options);
  ```

  Add the React `useMemo` import and `UploadJob` type to the hook's existing imports. Pass the dropzone callback to `useUploadJob(onSucceeded)`. Do not change the shared invoice upload engine unless a regression proves a change necessary.
- [ ] Replace TPBank-only uploader text with `bank ? bankShortName(bank) : 'TPB or VIB'` and explain that issuer is detected automatically. Add an accessible input label, retain the 5 MB/PDF restrictions, progress/status/error feedback, duplicate confirmation, and automatic reset. Test TPB, VIB, and unspecified-bank copy.
- [ ] Run `pnpm test frontend/__tests__/upload-flow.test.tsx app/__tests__/upload-dropzone.test.tsx frontend/__tests__/aws-invoice-flow.test.tsx`; run lint/typecheck/build before commit. Suggested commit: `feat(upload): support embedded bank-aware statement uploads`.

### Task 4: Compose both bank dashboards and refresh mutations

**Files:** Create `app/components/bank-statement-dashboard.tsx`, `app/components/bank-statement-history.tsx`, `app/__tests__/bank-statement-dashboard.test.tsx`, `app/__tests__/bank-statement-history.test.tsx`, `app/__tests__/home-routing.test.tsx`; modify `app/page.tsx`, `app/components/statements-table.tsx`, `app/components/empty-state.tsx`, `app/components/empty-period-state.tsx`; create `app/__tests__/statements-table.test.tsx`; extend `frontend/__tests__/initial-period.test.ts`.

**Interfaces:** `BankStatementDashboard()` reads query state and owns `useBankStatements()` plus `useDashboard()`. `BankStatementHistory({ items, bank, loading, error, onRetry, onDelete })` accepts metadata items, `BankCode | null`, booleans/error state, `onRetry: () => void`, and `onDelete: (id: string) => Promise<void>`. It uses `statementRows()` and never renders all-bank rows. Extend empty-period props with `bank: BankCode`; empty-state upload links use `#statement-upload`.

- [ ] Add failing composition tests in jsdom, mocking hooks and Next navigation. Assert for both banks that upload and history exist when analytics is loaded, empty, loading, or failed. Mock mixed-bank records, switch query and API selectedBank, and verify no opposite-bank row flash. With an unspecified bank and pending API response, assert no history rows before resolution.
- [ ] Add table link regression coverage:

  ```tsx
  render(<StatementsTable rows={[{
    key: '2026-07-2222', bank: 'VIB', cardLast4: '2222',
    year: 2026, month: 7, totalSpend: 100, uploadedAt: null,
  }]} onDelete={vi.fn()} />);
  const link = screen.getByRole('link');
  const url = new URL(link.getAttribute('href')!, 'https://cashight.example');
  expect(url.searchParams.get('bank')).toBe('VIB');
  expect(url.searchParams.get('period')).toBe('month');
  ```

  Test 13 selected-bank rows plus other-bank rows to prove filtering precedes 12-row pagination; changing banks resets to page 1. Test sort order and deletion cancellation.
- [ ] Run the five new app tests and initial-period tests, confirming the new assertions fail before implementation.
- [ ] Extract existing bank logic and skeleton from `app/page.tsx`. Keep `ProtectedRoute` outside the child owning all API hooks. The home dispatcher renders Cost Explorer navigation only when bank context is absent:

  ```tsx
  function HomeInner() {
    const search = useSearchParams();
    const router = useRouter();
    const isBankView = hasBankDashboardContext(search);
    useEffect(() => {
      if (!isBankView) router.replace(DEFAULT_DASHBOARD_HREF);
    }, [isBankView, router]);
    return isBankView ? <BankStatementDashboard /> : null;
  }
  // Page export wraps HomeInner with ProtectedRoute and Suspense.
  ```

  Remove the duplicate one-page fetch from the extracted bank component. Run `initialPeriodHref(items, search, requestedBank)` after complete metadata loads; preserve `window.location.hash` on replacement. An initial fetch failure renders an error with retry rather than “No statements.” Recalculate initial-period selection when bank/query changes; do not retain the old one-shot `fetchCompleted` behavior across banks.
- [ ] Compose sections, with bank scoping before table rendering:

  ```tsx
  <section id="statement-upload" className="scroll-mt-24" aria-label="Upload statement">
    <UploadDropzone bank={effectiveBank ?? undefined} onSucceeded={handleUploadSucceeded} />
  </section>
  // Existing analytics branch remains between upload and history.
  <BankStatementHistory
    items={items} bank={effectiveBank} loading={loading} error={historyError}
    onRetry={() => { void refreshHistory().catch(() => undefined); }}
    onDelete={handleDelete}
  />
  // Inside history, for non-null bank:
  <StatementsTable key={bank} rows={statementRows(items, bank)} onDelete={onDelete} />
  ```

  `effectiveBank` is the explicit parsed bank first, otherwise `view.selectedBank`; only a confirmed empty collection may fall back to `DEFAULT_BANK`. Do not use the last bank's view while loading another one. History's section ID is `statement-history`; render its own empty/loading/error/retry states. Use the domain short name in the bank heading. Keep bank and period selectors functional.
- [ ] Implement upload completion as page-owned async work, catching all refresh errors. Call `useBankStatements().refresh()`, find the returned metadata by `job.statementId`, convert via `statementRows`, navigate with `statementDashboardHref`, and trigger `useDashboard().refresh()` even if the URL is unchanged. If ID/metadata is missing or refresh fails, retain the current URL and show a saved-but-view-not-refreshed message with retry; never throw back into the upload engine.
- [ ] Implement delegated deletion: await DELETE, remove metadata through the hook, then refresh analytics. Keep current bank/period even when emptied. A failed DELETE propagates to the existing table catch so it retains the row/dialog and shows one failure toast. A successful DELETE shows one success toast; later analytics refresh failure uses the dashboard error UI. Never rely on the table's fallback `router.refresh()` for this flow.
- [ ] Update table href to `statementDashboardHref(row)` and empty-state links to inline anchors. Build “Go to latest” with explicit bank, e.g. `/?bank=${bank}`; it must not open Cost Explorer.
- [ ] Test same-month overwrite refresh, another-month upload navigation, cross-bank upload navigation, missing completion ID, history refresh failure, stale async work after unmount, deleting last statement, and API-selected bank on period-only URLs. Guard late upload completion work after bank navigation/unmount with a generation/ref cleanup so old callbacks do not redirect a new page.
- [ ] Run `pnpm test app/__tests__/bank-statement-dashboard.test.tsx app/__tests__/bank-statement-history.test.tsx app/__tests__/home-routing.test.tsx app/__tests__/statements-table.test.tsx frontend/__tests__/initial-period.test.ts app/__tests__/bank-selector.test.tsx app/__tests__/period-selector.test.tsx`; run lint/typecheck/build before commit. Suggested commit: `feat(dashboard): integrate bank uploads and filtered statement history`.

### Task 5: Retire standalone utility pages and remove all live links

**Files:** Create `app/components/legacy-statement-redirect.tsx`, `app/__tests__/legacy-statement-redirect.test.tsx`; modify `app/upload/page.tsx`, `app/statements/page.tsx`, `app/components/admin-shell.tsx`, `app/__tests__/dashboard-nav.test.tsx`, `scripts/verify-static-export.mjs`, `tests/e2e/current-production.spec.ts`; delete unused `frontend/hooks/use-statements.ts` after reference search.

**Interfaces:** `LegacyStatementRedirect({ section }: { section: 'statement-upload' | 'statement-history' })` wraps an inner `useSearchParams`/effect component with `ProtectedRoute` and `Suspense`, then `router.replace(legacyStatementHref(search, section))`.

- [ ] Add redirect tests for each route, explicit bank/period retention, bare default-bank destination, section fragment, unauthenticated guard, and absence of standalone upload/library headings. Add shell assertions that neither sidebar nor account menu includes links to retired routes.
- [ ] Run `pnpm test app/__tests__/legacy-statement-redirect.test.tsx app/__tests__/dashboard-nav.test.tsx` to establish failures.
- [ ] Replace page contents with the shared redirect wrapper:

  ```tsx
  export default function UploadPage() {
    return <LegacyStatementRedirect section="statement-upload" />;
  }
  export default function StatementsPage() {
    return <LegacyStatementRedirect section="statement-history" />;
  }
  ```

  These exports belong in their respective route files, with the component import. The protected inner redirect effect depends on a stable query string and section. Keep redirect HTML in the static build for old bookmarks.
- [ ] Remove `navItems` utility entries and their unused mapping/icons/helpers; remove corresponding account menu links. Change its remaining “Spending dashboard” entry to “Cost Explorer” pointing at `DEFAULT_DASHBOARD_HREF`. Preserve sign-out, theme, identity display, sidebar controls, and mobile behavior.
- [ ] Search `rg -n '/upload|/statements|useStatements' app frontend tests scripts docs/codebase`. Distinguish frontend page links from required `/uploads` and `/statements` API paths. Remove the old hook only if no live imports remain. Update production smoke expectations to keep legacy routes auth-protected without expecting legacy dashboard content.
- [ ] Retain `out/upload/index.html` and `out/statements/index.html` export checks and add `out/aws/cost-explorer/index.html` and `out/aws/billing-invoice/index.html`. Run focused app tests, lint/typecheck/build and `pnpm verify:static` before commit. Suggested commit: `refactor(navigation): retire standalone statement utility dashboards`.

### Task 6: Browser acceptance, documentation, and release readiness

**Files:** Modify `tests/e2e/dashboard-navigation.spec.ts`, `docs/plans/00-INDEX.md`, `docs/codebase/ARCHITECTURE.md`; create `tests/e2e/bank-statement-dashboard.spec.ts`. Consult `playwright.config.ts` for isolated local app/API fixtures and auth bypass.

**Interfaces:** Browser coverage uses existing local fake APIs or explicitly intercepted synthetic metadata/upload jobs. No real AWS Cost Explorer calls, real PDFs, or production mutations are needed for acceptance.

- [ ] Update browser expectations for initially expanded groups; remove unconditional “expand Bank statements” clicks. Assert AWS-first link order, all initial descendants, desktop flyout, keyboard collapse/reopen, mobile drawer and active bank retention after initial-period redirects.
- [ ] Add a bare-home test:

  ```ts
  test('opens Cost Explorer by default', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/aws\/cost-explorer\/$/);
    await expect(page.getByRole('heading', { name: 'AWS Cost Explorer' })).toBeVisible();
  });
  ```

  Add both-bank browser scenarios with synthetic intercepted pages: first metadata page contains only the opposite bank, selected-bank records occur later, and history stays correct after sorting/pagination. Mock auth callback/provider behavior at component level for normal/Google login; auth bypass alone does not prove the real callback behavior.
- [ ] Browser-test inline upload, completed upload navigation, selected-bank row navigation, deletion confirmation, zero-data upload access, history retry, and old utility URL section anchors. Intercept upload/poll responses with existing schema-valid synthetic jobs and a synthetic File; do not require private fixture PDFs. Verify no browser console errors.
- [ ] Check desktop and mobile layouts in light/dark themes; capture screenshots of TPB and VIB pages showing upload, analytics, and history. Verify focus visibility, labels, 390px viewport overflow, and section anchors with the sticky shell.
- [ ] Run final verification:

  ```bash
  pnpm lint
  pnpm tsc --noEmit
  pnpm test
  pnpm build
  pnpm verify:static
  pnpm exec playwright test tests/e2e/dashboard-navigation.spec.ts tests/e2e/bank-statement-dashboard.spec.ts tests/e2e/aws-billing-invoice.spec.ts tests/e2e/aws-cost-explorer.spec.ts
  ```

  Expected: exit 0 for every command. Record any unavailable environment or pre-existing failure accurately; do not claim it passed. The existing Playwright config pins fake Cost Explorer mode and isolated ports; keep those protections. No Terraform apply is part of verification.
- [ ] Update current codebase docs to describe Cost Explorer home, the AWS-first expanded menu, bank upload/history, and redirect-only legacy routes. Mark Step 33 complete only after implementation and all acceptance criteria pass. Leave Steps 30–32 historical requirements intact; link the new design as the navigation/utilities superseding decision.
- [ ] Commit verification/docs with `test(dashboard): cover consolidated bank workflows and default landing`. Include screenshots and actual check results in any implementation PR. State that auth capability enforcement and API/storage contracts are unchanged, no infrastructure/config migration is required, and Google login still requires native Cognito reauthentication for AWS costs.

## Completion criteria and rollback

- All seven requirement rows have passing automated coverage and observed browser behavior.
- Both bank views retain existing analytics while adding upload and all-month, bank-only history.
- Every successful mutation updates history and current analytics without a browser reload; failures remain retryable and truthful.
- Default landing works with the feature-enabled, feature-disabled, and native-Cognito-required states; no allowlist broadening occurs.
- No live UI links reach standalone utility dashboards; old bookmarks reach protected integrated sections.
- Static export and existing AWS invoice/Cost Explorer tests pass.
- Frontend rollback is a redeploy of the previous frontend artifact; this plan changes no persisted data or backend contracts. Do not perform production deployment during a planning-only task.

## Planning verification record

Repository navigation, auth return handling, bank page, upload engine, statement API pagination, table links, static export checks, existing tests, and Steps 30–32 were inspected. This document and its linked design are the deliverables of the current task. Application verification commands above are execution requirements, not claims of checks already run.
