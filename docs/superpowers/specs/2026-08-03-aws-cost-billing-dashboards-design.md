# AWS Cost and Billing Dashboards Design

**Status:** Approved for implementation planning

**Date:** 2026-08-03

**Owner:** Huy

**Branch:** `feat/aws-cost-billing-dashboards`

**Scope:** Add a full-parity AWS Cost Explorer report and a PDF-driven AWS monthly billing invoice dashboard to the shipped Cashight static SPA and serverless backend.

## 1. Outcome

Cashight will expose three dashboard families through one nested Dashboard navigation group:

```text
Dashboard
├── Bank statements
│   ├── TPB
│   └── VIB
└── AWS budget
    ├── Cost Explorer
    └── Billing Invoice
```

The bank statement dashboard keeps its existing one-bank-at-a-time behavior and URL-driven period selection. The two new AWS dashboards use the existing Cashight admin shell:

- **AWS Cost Explorer** reproduces the AWS Cost Explorer report experience available on 2026-08-03 inside Cashight. It contains the four required panels: Cost and usage overview, Cost and usage graph, Cost and usage breakdown, and Report parameters.
- **AWS Billing Invoice** accepts the known AWS consolidated monthly invoice PDF layout represented by the user-supplied local sample. It persists a privacy-safe monthly summary, renders intuitive charts, and provides a click-to-generate Gemini summary.

The Cost Explorer dashboard reads the deployment AWS account through a dedicated backend Lambda role. AWS credentials never enter the browser. Only a Cognito-native session may invoke Cost Explorer APIs. A Google-federated session can continue to use bank statements and billing invoices, but the Cost Explorer page displays a Cognito re-authentication warning and the backend independently rejects cost requests.

## 2. Goals

- **G-001:** Add the requested nested dashboard navigation without changing bank selection semantics.
- **G-002:** Provide functional parity with the four-panel AWS Cost Explorer report as it exists on 2026-08-03.
- **G-003:** Query only Cashight's deployment AWS account through a least-privilege backend IAM role.
- **G-004:** Require Cognito-native authentication for every Cost Explorer data request.
- **G-005:** Parse, reconcile, validate, persist, aggregate, visualize, and summarize the known AWS invoice layout.
- **G-006:** Keep Google and Cognito-native identities in one stable single-user Cashight workspace so re-authentication does not hide existing data.
- **G-007:** Preserve the current privacy, upload, PDF-runtime, infrastructure-as-code, observability, and static-export constraints.

## 3. Non-goals

- Amazon Q Developer prompts, Ask question, or Analyze with Amazon Q.
- Reserved Instance or Savings Plans purchase recommendations and utilization reports.
- AWS Budgets, Cost Anomaly Detection, Billing Conductor administration, payment actions, credits redemption, or Cost Explorer settings administration.
- Cross-account role onboarding or user-selected AWS accounts.
- Browser-side Cognito Identity Pool credentials or direct browser calls to AWS billing APIs.
- Cost and Usage Report/Data Exports ingestion, Athena, or a separate analytical warehouse.
- Automatic support for AWS invoice sellers, countries, currencies, or layouts not represented by the approved sample.
- Persisting or displaying bill-to names, postal addresses, full AWS account IDs, or invoice identifiers.

## 4. Current-system constraints

The design extends the hybrid serverless architecture already implemented in the repository:

- Next.js 16 builds a static SPA delivered by S3 and CloudFront.
- Cognito User Pool managed login issues PKCE tokens and federates Google.
- API Gateway REST API validates Cognito access tokens and invokes domain-specific Lambda functions.
- DynamoDB stores metadata and state; S3 stores validated financial documents; SQS isolates PDF parsing from HTTP timeouts.
- Existing bank uploads use presigned S3 PUT URLs, upload jobs, an SQS parser worker, deterministic monthly S3 keys, and DynamoDB metadata.
- Shared runtime-neutral schemas and pure logic live in `packages/domain/src/`.
- PDF modules must import the DOM polyfill before `pdfjs-dist` or `pdf-parse`, and the parser Lambda artifact must ship `pdf.worker.mjs` next to `index.js`.
- All external input is validated with Zod. Financial totals are trusted only after reconciliation and schema validation.
- Production AWS resources remain in `ap-southeast-1`, except global CloudFront dependencies already placed in `us-east-1`.

## 5. Architectural decisions

### AD-001: Keep the Cashight shell and reproduce the AWS report content

The approved visual direction is **AWS report fidelity inside Cashight**:

- Keep the current Cashight sidebar, header, responsive behavior, theme toggle, and user menu.
- Use AWS Cost Explorer's panel names, report-control density, graph/table relationship, terminology, and interaction model in the Cost Explorer content area.
- Do not reproduce the AWS global console header or the AWS Billing navigation sidebar.
- Keep the Billing Invoice dashboard visually consistent with the bank statement dashboard while using AWS billing terminology.

### AD-002: Use nested navigation without replacing existing bank routes

`app/components/admin-shell.tsx` owns the nested Dashboard tree on desktop and mobile.

- `TPB` links to `/?bank=TPBank`.
- `VIB` links to `/?bank=VIB`.
- `Cost Explorer` links to `/aws/cost-explorer/`.
- `Billing Invoice` links to `/aws/billing-invoice/`.
- The existing Upload and Statements utilities remain available outside the nested dashboard tree.
- Parent groups expand automatically when a descendant route is active, persist user collapse state for the current browser session, and expose accessible `aria-expanded` and keyboard behavior.
- A collapsed desktop sidebar renders flyout submenus; the mobile drawer renders the full nested tree.

This preserves `parseBankFromSearch()`, server-side `resolveBank()`, and the invariant that bank statements never show a combined total.

### AD-003: Introduce a stable single-user workspace boundary

Google federation and a native Cognito user can have different Cognito `sub` values even when they use the same allowed email. Cost Explorer re-authentication must not make existing statements disappear. Ownership therefore changes from raw provider subject to a stable workspace identifier.

The authorization record becomes:

```ts
interface AuthorizedUserRecord {
  PK: `AUTHZ#${string}`;       // Cognito sub
  SK: 'PROFILE';
  active: true;
  workspaceId: 'primary';
  authProvider: 'COGNITO' | 'GOOGLE';
  createdAt: string;
  updatedAt: string;
}
```

The Cognito trigger derives `authProvider` only from trusted pre-token-generation event data. The browser cannot supply or override it. `authorizeRequest()` returns both access claims and the validated authorization record. All data APIs derive ownership keys from `authorization.workspaceId`, not from request input.

Existing subject-keyed records and S3 objects receive a staged migration to `workspaceId = 'primary'`:

1. Dry-run and inventory current subject prefixes and DynamoDB records.
2. Copy records and objects to workspace-scoped keys.
3. Validate counts, schema parsing, object hashes, and dashboard totals.
4. Enable temporary read fallback to the legacy subject prefix during rollout.
5. Keep legacy objects for rollback; deletion is a separate explicitly approved cleanup operation.

### AD-004: Enforce Cognito-native Cost Explorer access twice

The Cost Explorer page requests a server-derived capability response. A Google session receives:

```json
{
  "canViewAwsCosts": false,
  "reason": "COGNITO_REAUTH_REQUIRED"
}
```

The page renders a persistent warning with a **Continue with Cognito** action. The sign-in redirect records `/aws/cost-explorer/` as the return route and does not display or request AWS credentials.

Every Cost Explorer backend operation also checks `authorization.authProvider === 'COGNITO'`. Failure returns HTTP 403 with code `COGNITO_REAUTH_REQUIRED` before creating an AWS SDK client or reading cached cost results. Frontend checks are usability only; backend enforcement is authoritative.

Bank statement and invoice routes accept either authorized provider.

### AD-005: Query Cost Explorer through a bounded backend API

Create a dedicated `cost-explorer-api` Lambda. It owns request validation, provider authorization, AWS SDK calls, pagination, response normalization, query caching, CSV generation, saved report definitions, error mapping, metrics, and logs.

The Lambda uses one dedicated IAM role with these read-only actions:

- `ce:GetCostAndUsage`
- `ce:GetCostAndUsageWithResources`
- `ce:GetCostForecast`
- `ce:GetUsageForecast`
- `ce:GetDimensionValues`
- `ce:GetTags`
- `ce:GetCostCategories`
- `ce:GetCostAndUsageComparisons`
- `ce:GetCostComparisonDrivers`
- `billing:ListBillingViews`
- `billing:GetBillingView`
- `aws-portal:ViewBilling`

The policy does not grant `ce:*`, Cost Explorer write actions, Billing write actions, Organizations write actions, or access to unrelated AWS services. `aws-portal:ViewBilling` is included because AWS documents it as a dependent read permission for the selected Cost Explorer operations. Where an action supports a billing-view resource ARN, Terraform scopes it to billing views in the deployment account; actions that do not support resource-level permissions use `Resource = "*"` only for that explicit action.

Cost Explorer APIs are regional SDK endpoints backed by deployment-account billing data. The frontend cannot choose an account ID or role ARN.

### AD-006: Pin full Cost Explorer parity to an explicit dated contract

“Full AWS-console parity” means the Cost Explorer report experience available on 2026-08-03 within the four required panels.

#### Cost and usage overview

- Selected-range total and currency.
- Current month-to-date estimated cost when the selected report includes the current month.
- Forecast total when AWS supports the active time range and grouping combination.
- Previous-period or comparison-period absolute and percentage change.
- Average per selected granularity.
- AWS data freshness timestamp and estimated/final state.

#### Cost and usage graph

- Bar, stacked bar, and line chart styles.
- Monthly, daily, and eligible hourly granularity.
- Up to two AWS-supported group definitions of type dimension, tag, or cost category.
- Top nine grouped series plus an `Other` series in the graph; the breakdown retains the complete dataset.
- Exact-value tooltips, legend series toggles, forecast overlay, and comparison mode.
- Responsive rendering without horizontal page overflow.

#### Cost and usage breakdown

- Complete server-paginated data, not only the plotted top series.
- Period columns, group labels, totals, currency/unit, estimated flags, comparison differences, percentage changes, and comparison cost drivers when available.
- Deterministic sorting and accessible tabular rendering.
- CSV export of the complete active query. Dates use `YYYY-MM-DD`, values preserve AWS precision, and the output follows AWS's transposed date/series orientation.

#### Report parameters

- Relative and absolute date ranges supported by the corresponding AWS API.
- Billing view selection from deployment-account views.
- Monthly, daily, and eligible hourly granularity.
- Cost metric: UnblendedCost, BlendedCost, AmortizedCost, NetUnblendedCost, NetAmortizedCost, UsageQuantity, or NormalizedUsageAmount, subject to AWS operation rules.
- Up to two group definitions.
- Searchable, paginated filter values for API operation, Availability Zone, billing entity, charge type, instance type, legal entity, linked account, platform, purchase option, Region, resource, service, tag, tenancy, usage type, and usage type group.
- Cost-category filters and groups.
- AND across filter categories and OR within selected values, matching Cost Explorer semantics.
- Advanced options for forecast values, untagged resources, and uncategorized resources.
- Month-to-month and custom two-month comparison modes with supported group and filter restrictions.
- Save, rename, load, and delete Cashight report definitions.
- Shareable URL report state that contains validated report parameters but no tokens or credentials.

Resource-level data is opt-in. `GetCostAndUsageWithResources` is limited by AWS to supported service, date-range, and granularity combinations. Unsupported combinations are disabled with an explanation rather than returned as zeros.

Amazon Q, recommendation reports, and console administration remain non-goals even if AWS renders them near Cost Explorer.

### AD-007: Model and validate Cost Explorer report requests in the domain package

Add Zod schemas and inferred TypeScript types under `packages/domain/src/aws-cost-explorer.ts`.

The canonical report request contains:

```ts
interface CostExplorerReportRequest {
  mode: 'STANDARD' | 'RESOURCE' | 'COMPARISON';
  billingViewArn?: string;
  timePeriod: { start: string; end: string };
  comparisonTimePeriod?: { start: string; end: string };
  granularity: 'MONTHLY' | 'DAILY' | 'HOURLY';
  metric:
    | 'UnblendedCost'
    | 'BlendedCost'
    | 'AmortizedCost'
    | 'NetUnblendedCost'
    | 'NetAmortizedCost'
    | 'UsageQuantity'
    | 'NormalizedUsageAmount';
  groupBy: Array<{
    type: 'DIMENSION' | 'TAG' | 'COST_CATEGORY';
    key: string;
  }>;
  filter?: CostExplorerExpression;
  chartStyle: 'BAR' | 'STACK' | 'LINE';
  showForecast: boolean;
  showOnlyUntagged: boolean;
  showOnlyUncategorized: boolean;
}
```

The schema enforces maximum group count, valid ISO dates, start-inclusive/end-exclusive intervals, mode-specific date limits, hourly/resource restrictions, comparison restrictions, filter depth, filter count, string length, and supported match options before an AWS call is attempted.

A canonical serializer sorts commutative filter values and keys. Its SHA-256 digest becomes the query-cache key; raw tag names, tag values, cost-category values, and account values never appear in cache keys, logs, metrics, or traces.

### AD-008: Cache paid Cost Explorer reads without hiding freshness

AWS charges for paginated Cost Explorer API requests and refreshes source data less frequently than a typical interactive UI. The backend therefore caches normalized complete results in DynamoDB:

- Queries containing the current or future period: one-hour TTL.
- Queries containing only closed historical periods: 24-hour TTL.
- Dimension/tag/cost-category value lists: one-hour TTL.
- A manual refresh may bypass a result once per workspace per five minutes.
- Concurrent requests for the same canonical query use one in-flight execution path.
- A cache entry is returned only after all AWS pages succeed and the complete normalized response passes schema validation.
- Partial results are never cached or rendered as complete totals.
- Every response reports `source: 'AWS' | 'CACHE'` and an ISO `asOf` timestamp.

Saved report definitions are separate DynamoDB records and never contain cached response data or credentials.

### AD-009: Reuse the upload pattern with an isolated invoice queue and worker

Invoice PDFs use the existing browser-to-S3 presigned upload model but remain isolated from bank parsing:

1. The browser calls `POST /aws/invoices/uploads` with name, MIME type, byte size, SHA-256, and `force`.
2. `aws-invoices-api` creates an owner-scoped job and returns a five-minute presigned PUT URL for `uploads/aws-invoices/{workspaceId}/{jobId}.pdf`.
3. S3 sends objects under that prefix to a dedicated invoice SQS queue.
4. `invoice-parser-worker` downloads one PDF, parses the known layout, strips private header/account data, reconciles totals, validates `AwsInvoiceSchema`, persists JSON and metadata, and deletes the raw PDF.
5. The SPA polls `GET /aws/invoices/uploads/{jobId}` until a terminal state.

The invoice queue has batch size one, partial batch responses, a visibility timeout greater than Lambda timeout, three bounded receives, a dedicated DLQ, and alarms for oldest-message age and DLQ depth. Bank parser jobs and invoice parser jobs cannot be routed to each other's worker.

The raw upload bucket lifecycle remains at most one day. Successful, conflicting, unsupported, and terminally failed jobs delete the raw PDF immediately when safe.

### AD-010: Support one known invoice layout through an extensible parser interface

The first parser supports the user-supplied 13-page consolidated USD invoice produced by Apache FOP and issued by Amazon Web Services, Inc. The source PDF stays outside Git.

The parser boundary is:

```ts
interface AwsInvoiceParser {
  readonly id: string;
  canParse(document: ExtractedPdfDocument): boolean;
  parse(document: ExtractedPdfDocument): AwsInvoice;
}
```

`parseAwsInvoicePdf()` extracts the PDF once, evaluates registered parsers in deterministic order, and throws `UnsupportedAwsInvoiceError` when none match. The architecture permits later seller/layout parsers without weakening the first parser's markers or reconciliation rules.

The parser must:

- Recognize stable seller, summary, billing-period, consolidated-bill, and linked-account-allocation markers.
- Parse all pages, including service sections continued across page boundaries.
- Parse USD values with comma thousands and dot decimals only inside the AWS invoice parser module.
- Normalize AWS service names without inventing aliases that change invoice meaning.
- Aggregate service charges and tax components.
- Parse linked-account allocations but retain only account last four digits.
- Reconcile each service total, linked-account total, consolidated total, charges, credits, tax, and amount due.
- Reject missing required sections, duplicated ambiguous sections, non-USD currency, unsupported seller/layout, or any reconciliation mismatch.

Before the parsed value leaves the parser boundary, remove:

- Bill-to name and address.
- Full payer and linked AWS account IDs.
- Invoice number and full invoice filename.
- Contact text and arbitrary raw PDF lines.
- Any linked-account label containing a person's or organization's name.

### AD-011: Persist a minimal privacy-safe invoice model

Add `AwsInvoiceSchema` in `packages/domain/src/aws-invoices.ts`:

```ts
interface AwsInvoice {
  seller: 'Amazon Web Services, Inc.';
  billingPeriod: { start: string; end: string };
  invoiceDate: string;
  dueDate: string;
  currency: 'USD';
  totals: {
    charges: number;
    credits: number;
    tax: number;
    amountDue: number;
  };
  services: Array<{
    name: string;
    charges: number;
    tax: number;
    total: number;
  }>;
  linkedAccounts: Array<{
    accountLast4: string;
    charges: number;
    credits: number;
    tax: number;
    total: number;
    services: Array<{
      name: string;
      charges: number;
      tax: number;
      total: number;
    }>;
  }>;
  source: {
    parserId: string;
    parserVersion: number;
    sha256: string;
    uploadedAt: string;
  };
}
```

Numbers are stored as validated finite decimal currency values and reconciled with integer minor-unit arithmetic internally. Floating-point equality is not used for reconciliation.

Persist one current invoice per billing month at:

```text
users/{workspaceId}/aws-invoices/{year}/{year}-{mm}.json
```

S3 versioning preserves previous object versions. DynamoDB metadata uses `PK = WORKSPACE#{workspaceId}` and `SK = AWS_INVOICE#{year}-{mm}`. Re-uploading an existing month returns a conflict unless the user explicitly confirms force replacement.

### AD-012: Make the Billing Invoice dashboard period-aware

`/aws/billing-invoice/` renders:

- Month selector and previous/next controls.
- Upload action, upload progress, conflict confirmation, parser error, and retry states.
- KPI cards for amount due, service charges, credits, tax, linked-account count, and billed-service count.
- Service-cost donut chart.
- Top-services horizontal bar chart.
- Charges-versus-tax composition chart.
- Masked linked-account allocation chart/table.
- Multi-invoice monthly total trend.
- Service breakdown table with charges, tax, and total.
- Invoice list and delete action with confirmation.
- Click-to-generate AI summary.

The selected month lives in URL parameters. The dashboard never combines invoice currency values from different currencies; the first parser supports USD only.

### AD-013: Preserve a strict AI privacy boundary

Add `buildAwsInvoiceSummaryPayload()` as a pure domain helper. It accepts one selected invoice plus historical monthly totals and returns only:

- Billing month and currency.
- Charges, credits, tax, and amount due.
- Month-over-month total and percentage change when available.
- Top service names with aggregate totals and percentages.
- Masked linked-account allocation percentages.
- Tax ratio.

The helper must not include raw PDF text, bill-to data, seller address, invoice identifiers, full account IDs, account labels, upload keys, SHA-256, or raw line descriptions. The summary Lambda validates this reduced payload immediately before constructing the Gemini prompt. The UI never auto-generates a summary.

### AD-014: Use typed, privacy-safe failure behavior

| Error code | HTTP/job state | Meaning and UI behavior |
| --- | --- | --- |
| `COGNITO_REAUTH_REQUIRED` | 403 | Show Cognito warning and return-to sign-in action; do not call AWS. |
| `COST_EXPLORER_DISABLED` | 424 | Explain that Cost Explorer must be enabled; never render zero-cost charts. |
| `AWS_COST_ACCESS_DENIED` | 403 | Explain deployment-role permissions; log only sanitized AWS error code/request ID. |
| `AWS_COST_THROTTLED` | 503 | Retry with bounded jitter, then preserve parameters and offer retry. |
| `GRANULARITY_NOT_AVAILABLE` | 422 | Disable unsupported hourly/resource combination with AWS rule explanation. |
| `INVALID_COST_QUERY` | 400 | Highlight the invalid report parameter; no AWS request occurs. |
| `UNSUPPORTED_AWS_INVOICE` | failed job | State that the PDF layout is unsupported without echoing extracted text. |
| `INVOICE_TOTAL_MISMATCH` | failed job | State that totals could not be reconciled; persist no invoice JSON/metadata. |
| `INVOICE_CONFLICT` | conflict job | Offer explicit force replacement; keep current invoice unchanged. |
| `INVALID_PDF` | rejected/failed job | Explain signature, MIME, size, checksum, encryption, or structural failure generically. |

Logs, traces, metrics, and alarms may include error code, request ID, job ID, counts, durations, cache hit/miss, AWS page count, masked account last four, and aggregate totals. They must not include tokens, email, names, addresses, full account IDs, invoice IDs, report tag/filter values, raw PDF text, raw service-line descriptions, presigned URLs, or secrets.

### AD-015: Gate paid granular data explicitly

Cost Explorer programmatic requests and granular/resource data can incur charges. Terraform exposes `enable_cost_explorer_granular_data` with default `false`.

- Full-parity controls are implemented regardless of the flag.
- Hourly/resource controls remain disabled with an explanation until the operator deliberately enables the required AWS Cost Explorer data preference.
- Enabling the preference is a separate apply-time decision documented with current AWS pricing and rollback/disable instructions.
- The application never changes Cost Explorer data preferences at runtime.

## 6. API surface

All routes require the existing Cognito User Pool authorizer and exact `cashight/read` or `cashight/write` scope.

| Method and path | Scope | Responsibility |
| --- | --- | --- |
| `GET /session/capabilities` | read | Return provider-derived application capabilities without PII. |
| `POST /aws/cost-explorer/query` | read + native provider | Run/cache a validated standard or resource cost query. |
| `POST /aws/cost-explorer/comparisons` | read + native provider | Return normalized month comparison and drivers. |
| `POST /aws/cost-explorer/dimensions` | read + native provider | Search/page dimension, tag, or cost-category values. |
| `POST /aws/cost-explorer/forecast` | read + native provider | Return forecast values allowed by the active report. |
| `POST /aws/cost-explorer/export` | read + native provider | Return complete active-query CSV without logging parameters. |
| `GET /aws/cost-explorer/reports` | read + native provider | List saved Cashight report definitions. |
| `POST /aws/cost-explorer/reports` | write + native provider | Create or replace a validated saved report definition. |
| `DELETE /aws/cost-explorer/reports/{reportId}` | write + native provider | Delete an owned saved report definition. |
| `POST /aws/invoices/uploads` | write | Create an AWS invoice upload job and presigned PUT URL. |
| `GET /aws/invoices/uploads/{jobId}` | read | Return owned invoice upload job state. |
| `GET /aws/invoices` | read | List paginated invoice metadata. |
| `GET /aws/invoices/{yearMonth}` | read | Return one validated owned invoice. |
| `DELETE /aws/invoices/{yearMonth}` | write | Delete one owned invoice after UI confirmation. |
| `GET /aws/invoices/dashboard` | read | Return selected-month KPIs/charts and historical trend aggregates. |
| `POST /aws/invoices/summaries` | read | Stream a Gemini summary built from anonymized invoice aggregates. |

OpenAPI request validators, Zod parsing, exact CORS, WAF rate rules, API Gateway throttles, and Lambda reserved concurrency apply in addition to handler validation.

## 7. Data records

New DynamoDB item families:

| PK | SK | Purpose |
| --- | --- | --- |
| `AUTHZ#{sub}` | `PROFILE` | Provider-to-workspace authorization record. |
| `WORKSPACE#{workspaceId}` | `AWS_INVOICE#{yyyy-mm}` | Invoice metadata and owned S3 object key. |
| `WORKSPACE#{workspaceId}` | `AWS_REPORT#{reportId}` | Saved Cost Explorer report definition. |
| `WORKSPACE#{workspaceId}` | `AWS_QUERY_CACHE#{sha256}` | Complete normalized query result with TTL. |
| `WORKSPACE#{workspaceId}` | `AWS_REFRESH#{sha256}` | Manual-refresh cooldown record with TTL. |
| `JOB#{jobId}` | `META` | Typed invoice upload job with workspace ownership and TTL. |

No DynamoDB record stores raw PDF text, bill-to data, invoice IDs, full account IDs, transaction arrays, presigned URLs, OAuth tokens, or AWS credentials.

## 8. Observability

Add structured metrics and alarms for:

- Cost query count, AWS page count, cache hit/miss, duration, throttles, access errors, invalid requests, comparison errors, and CSV exports.
- Invoice upload creation, parse success/failure by sanitized code, reconciliation failures, parse duration, queue age, retries, and DLQ depth.
- AI summary requests, configuration failures, upstream failures, and stream duration without prompt content.
- Workspace migration counts, validation failures, and legacy-fallback reads during rollout.

CloudWatch dashboards use counts and durations only. Cost Explorer request parameters, tag values, cost-category values, account values, invoice contents, and prompts are not metric dimensions or log fields.

## 9. Verification strategy

### Domain and parser tests

- Schema acceptance/rejection for every Cost Explorer mode, metric, granularity, group, filter, and advanced option.
- Canonical query serialization produces identical digests for semantically identical expressions and different digests for different reports.
- Invoice amount/date/service parsing from synthetic redacted extracted rows.
- Page-boundary service continuation and linked-account allocation grouping.
- Minor-unit reconciliation for service, linked-account, and invoice totals.
- Unsupported seller/layout, non-USD, missing section, duplicate ambiguous section, and mismatch rejection.
- AI summary payload excludes every prohibited field.

The user-supplied invoice remains local and uncommitted. A self-skipping local integration test may load a gitignored path from `AWS_INVOICE_FIXTURE` and assert aggregate values only. CI uses synthetic/redacted fixture-free inputs and never prints private expected values.

### Backend tests

- Google authorization returns `COGNITO_REAUTH_REQUIRED` before AWS client creation.
- Cognito-native authorization reaches the injected Cost Explorer client.
- Pagination succeeds only after all pages validate; a later-page error returns no partial total and writes no cache.
- Current/historical TTLs, cache key hashing, manual refresh cooldown, and in-flight deduplication.
- AWS disabled/access-denied/throttle/validation error mapping.
- Saved report ownership, validation, name uniqueness, update, and delete.
- Invoice upload ownership, prefix isolation, checksum, conflict/force, idempotency, raw-PDF deletion, worker retry, and DLQ behavior.
- Workspace migration/fallback never exposes one provider subject's data to an unauthorized workspace.

### Frontend tests

- Desktop collapsed/expanded, flyout, mobile, keyboard, and active nested navigation states.
- Google warning and Cognito return-to flow.
- All four Cost Explorer panels render loading, success, empty, cached, stale, estimated, unavailable, and error states.
- Parameter incompatibilities disable invalid choices before submission.
- Graph style, legend, comparison, breakdown pagination/sorting, saved reports, URL state, and CSV download.
- Invoice upload progress, conflict, unsupported layout, mismatch, empty month, period selection, charts, table, delete, and AI summary states.
- No full account or invoice identifier appears in rendered output.

### Infrastructure and release checks

- `pnpm lint`
- `pnpm tsc --noEmit`
- `pnpm test`
- `pnpm build`
- `pnpm exec playwright test`
- `terraform fmt -check -recursive`
- `terraform validate`
- `tflint --recursive`
- `uvx checkov -d terraform`
- Terraform tests assert API routes, Lambda aliases/permissions, queue/DLQ isolation, upload prefixes, log groups, alarms, IAM action allowlists, and the default-disabled granular-data flag.

## 10. Rollout and migration

1. Add domain schemas, provider/workspace authorization fields, and tests without changing production reads.
2. Deploy workspace migration tooling and run dry-run inventory.
3. Copy and validate existing data into workspace-scoped keys; keep legacy objects.
4. Deploy capabilities and nested navigation with AWS routes feature-disabled.
5. Deploy Cost Explorer API/IAM/cache and verify native-provider gating against a mocked then real deployment account.
6. Deploy invoice upload/parser/storage APIs and validate the local sample without committing it.
7. Deploy both dashboards behind independently controlled feature flags.
8. Run production smoke tests for Google and native Cognito sessions, cached/uncached cost queries, invoice upload, and AI privacy.
9. Enable dashboard feature flags after alarms and rollback paths are confirmed.
10. Enable granular/resource Cost Explorer data only through an explicit later Terraform apply after reviewing current charges.

Rollback disables the two AWS dashboard feature flags and leaves existing bank functionality intact. It does not delete workspace-migrated or legacy financial objects.

## 11. Acceptance criteria

- The active Git branch is `feat/aws-cost-billing-dashboards`.
- Dashboard navigation matches the approved Bank statements and AWS budget hierarchy on desktop and mobile.
- TPB/VIB links preserve the existing one-bank-at-a-time dashboard behavior.
- Cost Explorer renders the four required panels with the full dated parameter/graph/table/report contract.
- A Google session sees a Cognito re-authentication warning and cannot cause any Cost Explorer AWS API request.
- A Cognito-native session can query only the deployment account through the dedicated read-only Lambda role.
- No AWS credentials are present in frontend code, browser storage, API responses, or logs.
- Cost query caching is complete-result-only, hashed, freshness-labelled, and respects the defined TTL/cooldown rules.
- Paid granular/resource data remains default-disabled until explicitly enabled.
- The supplied known invoice layout parses all pages and reconciles service, account, tax, credit, and amount-due totals.
- Unknown invoice layouts and reconciliation mismatches persist no invoice data.
- Invoice charts, period selection, history, conflict replacement, deletion, and AI summary work responsively.
- Bill-to data, full account IDs, invoice IDs, and raw PDF text never enter persisted JSON, DynamoDB, logs, API responses, charts, or Gemini payloads.
- Google and Cognito-native identities resolve to the same stable workspace after re-authentication.
- Existing bank statement behavior and data remain available throughout rollout and rollback.
- All unit, component, backend, browser, build, and Terraform checks in Section 9 pass.

## 12. Source references

- [AWS Cost Explorer overview and API pricing](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)
- [Exploring Cost Explorer dashboard data](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-exploring-data.html)
- [Modifying Cost Explorer charts and report parameters](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-modify.html)
- [Cost Explorer filters and logical behavior](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-filtering.html)
- [Cost Explorer advanced options](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-advanced.html)
- [Cost comparisons](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-cost-comparison.html)
- [CSV export behavior](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-download-csv.html)
- [Resource-level Cost Explorer API restrictions](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsageWithResources.html)
- [Cost Explorer IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ce.html)
- [AWS Billing view IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_billing.html)
- [Understanding AWS monthly invoices](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/getting-viewing-bill.html)
