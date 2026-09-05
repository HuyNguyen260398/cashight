# Dashboard consolidation design

Date: 2026-09-05
Status: Proposed for review; implementation is not part of this planning task.
Implementation plan: [Step 33](../../plans/33-dashboard-consolidation.md)

## Intent and requirements

Make AWS Cost Explorer the default entry point and consolidate bank statement management into each bank dashboard, following the existing Billing Invoice composition.

| ID | Required outcome |
| --- | --- |
| R1 | Normal login returns to `/aws/cost-explorer/`; bare `/` also opens it. |
| R2 | Dashboard navigation lists AWS budget before Bank statements. |
| R3 | Both TPB and VIB dashboards contain an embedded upload section. |
| R4 | Both bank dashboards contain an embedded statement history table. |
| R5 | TPB history contains only TPBank statements; VIB history contains only VIB statements, including across pagination and bank changes. |
| R6 | Dashboard and both groups initially expand, revealing all four leaf links. |
| R7 | Remove standalone Upload and Statements UI and menu entries. |

“Back statement” is interpreted as Bank statements. “Similar to Billing Invoice” means header, upload, analytics or an empty/error state, then history. History covers all uploaded months for the selected bank; the period selector filters analytics only.

## Current implementation evidence

- `next.config.ts` exports a static SPA with trailing slashes. `frontend/auth/` uses Cognito OIDC; Lambda APIs supply data. Older AGENTS.md statements about Auth.js and server-rendered S3 reads are stale descriptions, not the architecture to reintroduce.
- `frontend/auth/return-to.ts` defaults callback navigation to `/`, while only `/aws/cost-explorer/` is currently allowlisted for explicit return navigation.
- `app/page.tsx` contains the bank dashboard and its initial-period fetch; bank leaf URLs are `/?bank=TPBank` and `/?bank=VIB`.
- `app/components/dashboard-nav.tsx` orders banks before AWS. Dashboard starts open, but both group states start closed, with the active group forced open.
- `app/components/admin-shell.tsx` links to Upload and Statements in both sidebar and account menu.
- `app/components/aws-invoices/aws-invoice-dashboard.tsx` composes upload, analytics, and history and follows a completed upload to its month.
- `frontend/hooks/use-statements.ts` loads one API page at a time across both banks. `backend/functions/statements-api/handler.ts` accepts a cursor, but does not implement bank filtering.
- `app/components/statements-table.tsx` already sorts and paginates at 12 rows. Its period links currently omit `bank`. Its fallback `router.refresh()` cannot refresh client hook state reliably in a static SPA.
- `useUploadJob()` uses the shared `usePdfUploadJob()` engine, which already supports `onSucceeded(job)`. Bank upload jobs supply an optional `statementId`, not bank/month fields.

## Options and decision

1. **Recommended: preserve bank URLs and compose shared bank components.** Route bare home to Cost Explorer, reuse existing upload/table components, and load all statement metadata pages before filtering and table pagination. This keeps changes within the frontend and avoids a data/API migration.
2. **Move bank dashboards to a new `/bank-statements/` route.** Separates home and bank routing more explicitly, but requires broader URL changes and compatibility work without improving the requested behavior.
3. **Add server-side bank-filtered history pagination.** Better for very large histories, but requires coordinated API/cursor behavior and backend tests. For this personal tracker, complete metadata loading is simpler; no statement bodies are downloaded for history.

The recommended approach loads a number of API pages proportional to metadata history size. Keep this tradeoff explicit; reconsider option 3 if real history sizes make loading slow. Do not silently truncate history or treat a partial list as complete.

## Routing and authentication

- Default callback return becomes `/aws/cost-explorer/`, including missing or invalid OIDC state. Preserve the strict return-to allowlist; never redirect to an arbitrary URL from query/state.
- Bare home, or home with only unrelated tracking parameters, redirects using client `router.replace` inside `ProtectedRoute` and `Suspense`.
- Presence of any bank-dashboard parameter (`bank`, `period`, `year`, `month`, `quarter`) preserves the bank entry flow. Existing valid bank and period bookmarks continue working. Invalid bank values still go through domain parsing and API bank resolution.
- Keep Google sessions on Cost Explorer with the existing native-Cognito reauthentication warning. Preserve backend capability checks and feature-disabled UI. This request changes landing location, not AWS access rights or feature flags.
- `/upload/` and `/statements/` become protected, client-side redirect-only compatibility pages. Preserve existing query parameters, use the domain default bank only when neither a valid bank nor period context exists, and append `#statement-upload` or `#statement-history`. They render no standalone dashboard. No Next.js server redirect or middleware is introduced.
- Replace all live links to retired pages, including account-menu links and empty-state actions. Home/logo links may continue to `/`; rename “Spending dashboard” to “Cost Explorer” with its direct route.

## Navigation

```text
Dashboard (initially expanded)
  AWS budget (initially expanded)
    Cost Explorer
    Billing Invoice
  Bank statements (initially expanded)
    TPB
    VIB
```

Use the same ordered tree for desktop, collapsed-sidebar flyout, and mobile drawer. Disclosures remain operable with keyboard and pointer, including collapsing the active group. Opening the collapsed sidebar flyout is still explicit; default expansion does not force that flyout open. Navigation to a different active descendant reopens its ancestors. Preserve Escape/focus return and close the mobile drawer only after leaf navigation.

## Bank dashboard composition and data flow

Extract the existing bank page into `BankStatementDashboard`, retaining its analytics, period selection, and server-resolved `selectedBank` behavior. It owns one complete statement metadata hook shared by initial-period selection, history, and upload completion.

Render in this order:

1. Bank-specific heading and bank/period controls.
2. `statement-upload`: existing PDF uploader with bank-aware copy.
3. Existing analytics, loading, error, or empty-period content.
4. `statement-history`: selected-bank history with existing sorting, pagination, masked card display, and deletion confirmation.

Upload and history remain mounted during analytics loading, failures, and empty periods. History failures have their own retry action. When a bank is unspecified, do not display an unfiltered table while awaiting API bank resolution; hide history rows until the effective bank is known. Explicit bank changes immediately hide old-bank rows and reset table pagination.

Fetch every `/statements` page through `apiFetch` and `StatementsListResponseSchema`. Follow `nextCursor`, deduplicate by `statementId`, detect repeated cursors, and support abort/stale-response suppression. Publish a complete snapshot atomically; on refresh failure retain the last successful snapshot with an error banner. Filtering occurs before passing rows to `StatementsTable`. Existing missing-bank response compatibility continues to classify legacy statements as TPBank.

Use the complete metadata list with `initialPeriodHref()` so a selected bank whose newest statement occurs on a later API page is discoverable. Preserve explicit bank selection when it has no data. When no records exist, use the requested bank or `DEFAULT_BANK`; no unfiltered totals are introduced. Preserve URL fragments during initial-period replacement so compatibility links still reach their section.

## Upload and mutation behavior

Recommended assumption pending optional user feedback: uploading the other bank's PDF is allowed; parser-detected bank remains authoritative and successful upload opens that bank and month. Do not infer the bank from the filename or stamp the current bank onto parser output.

Pass an optional success callback through `UploadDropzone` and `useUploadJob` to the existing upload engine. On success, refresh metadata and analytics. Match `job.statementId` to the refreshed metadata to obtain bank and statement date, then navigate to that bank/month. If the ID is absent or not yet visible, stay on the current selection, show that the statement was saved but its view could not be located, and provide retry. A refresh error must not turn a successful upload into a failed upload or invite accidental duplicate submission.

Keep 5 MB/PDF validation, progress, timeout, duplicate confirmation, force overwrite, and unsupported-bank messages. Upload copy supports both banks and uses `bankShortName()` for the selected dashboard label.

Deletion stays delegated to the parent. After a successful DELETE, remove the row and refresh analytics even when the URL does not change. Keep the selected period after deletion; if it is now empty, show the empty-period state. On DELETE failure retain the row and permit retry. Distinguish a failed DELETE from a refresh failure after successful deletion. Prevent stale in-flight list responses from resurrecting deleted rows.

## Global constraints

- Preserve Next.js static export and `trailingSlash: true`; do not introduce server-only frontend routes.
- Keep pnpm pinned to `11.2.2`; use existing dependencies.
- Keep bank knowledge in `packages/domain/src/banks.ts`; preserve API resolution for absent/unrecognised bank selections.
- Preserve Cognito capability enforcement, feature flags, workspace ownership, and API authorization.
- Preserve deterministic parser detection, PDF password handling, PCI masking, and anonymized Gemini payloads.
- No parser, storage schema, backend API, IAM, Terraform, or data migration is required by this design.
- Use synthetic masked metadata in tests; never log PDFs, passwords, PANs, transaction descriptions, or auth tokens.

## Review and acceptance

Step 33 maps all seven requirements to implementation and regression checks. Include sparse mixed-bank pages, rapid bank switching, same-period mutations, initial empty state, old bookmarks, Google reauthentication UI, desktop/mobile keyboard navigation, and a static export build. Planning checks validate documentation only; application tests run during implementation. This design supersedes Step 30's bank-first ordering and decision to retain standalone utilities, not its identity/workspace architecture.
