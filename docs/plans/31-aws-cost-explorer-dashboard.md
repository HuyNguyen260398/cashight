---
goal: Implement the full-parity AWS Cost Explorer dashboard for Cognito-native Cashight sessions
version: 1.0
date_created: 2026-08-03
last_updated: 2026-08-03
owner: Huy
status: 'Planned'
tags:
  - feature
  - aws
  - cost-explorer
  - billing
  - dashboard
  - terraform
---

# AWS Cost Explorer Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the AWS Cost Explorer report experience available on 2026-08-03 inside Cashight's shell for the deployment AWS account and Cognito-native sessions.

**Architecture:** A dedicated `cost-explorer-api` Lambda validates canonical report requests, enforces native-provider capability, calls only read-only AWS Cost Explorer/Billing APIs, fetches every AWS page before publishing a result, stores complete results as a DynamoDB manifest plus bounded chunks, and creates short-lived private CSV exports. The static React page owns URL report state and renders the four required panels from normalized domain contracts.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Zod 4, Recharts 3, AWS SDK v3 Cost Explorer and Billing clients, API Gateway REST API, Lambda Node.js 22, DynamoDB, private S3 exports, CloudWatch, Terraform, Vitest, Testing Library, Playwright.

## Global Constraints

- Step 30 must be complete; consume `authorization.workspaceId`, `authorization.authProvider`, and `useSessionCapabilities()` without changing their interfaces.
- Every Cost Explorer backend operation must reject Google sessions before constructing or invoking an AWS client.
- Query only the Terraform deployment account; do not accept account IDs, role ARNs, access keys, regions, or credentials from the client.
- Pin functional parity to the four requested Cost Explorer panels as of 2026-08-03.
- Exclude Amazon Q, RI/Savings Plans recommendations, Budgets, Anomaly Detection, and AWS settings administration.
- Fetch and validate every AWS page before returning or caching financial totals.
- Never log report filters, tag keys/values, cost-category names/values, linked-account values, tokens, credentials, or raw AWS responses.
- Keep granular/resource data default-disabled through Terraform until explicitly enabled after cost review.
- Explicitly configure Cost Explorer and Billing clients for `us-east-1`; keep the Lambda deployment in `ap-southeast-1`.
- Keep `pnpm` at 11.2.2 and align new AWS SDK packages with the repository's existing AWS SDK v3 range.

---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This is Step 31 in `docs/plans/00-INDEX.md`. It depends on Step 30 and is independently releasable behind `NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER=false` until its production smoke checks pass.

## 1. Requirements & Constraints

- **REQ-3101**: Render Cost and usage overview, graph, breakdown, and Report parameters panels.
- **REQ-3102**: Support standard, resource, forecast, and comparison API operations defined in the approved specification.
- **REQ-3103**: Support AWS chart styles, metrics, granularities, two group definitions, filters, tags, cost categories, advanced options, billing views, saved reports, URL state, and CSV export.
- **REQ-3104**: Preserve complete breakdown data even though the graph plots only top nine groups plus Other.
- **REQ-3105**: Cache complete validated results with one-hour current-period and 24-hour historical TTLs.
- **REQ-3106**: Permit one manual cache bypass per canonical query per workspace per five minutes.
- **REQ-3107**: Label AWS/cache source, freshness, estimated values, and unavailable combinations.
- **REQ-3108**: Save, rename, list, load, and delete owned Cashight report definitions.
- **SEC-3101**: Enforce Cognito-native provider in every handler branch.
- **SEC-3102**: Grant only the explicit read actions listed in the specification; never grant `ce:*`.
- **SEC-3103**: Hash canonical queries before using them in keys, logs, metrics, or traces.
- **SEC-3104**: Generate CSV in a private encrypted bucket and return a five-minute presigned GET URL.
- **CON-3101**: Cost Explorer APIs charge per paginated request and source data is not real-time.
- **CON-3102**: DynamoDB items are limited to 400 KiB, so cached results require a manifest and bounded chunks.
- **CON-3103**: Resource data supports AWS-defined service/date/granularity restrictions and must be enabled at the account level.
- **PAT-3101**: Keep AWS SDK adapters dependency-injected and domain normalization pure.

## 2. File Structure

| Path | Responsibility |
| --- | --- |
| `packages/domain/src/aws-cost-explorer.ts` | Report, filter, normalized response, saved report, and cache schemas. |
| `packages/domain/src/aws-cost-canonical.ts` | Semantic validation, canonical sorting, hashing input, and URL-safe state. |
| `backend/shared/cost-explorer-clients.ts` | Lazy Cost Explorer and Billing SDK clients. |
| `backend/functions/cost-explorer-api/aws-adapter.ts` | SDK command mapping, all-page retrieval, error normalization. |
| `backend/functions/cost-explorer-api/cache.ts` | DynamoDB manifest/chunk cache and manual-refresh cooldown. |
| `backend/functions/cost-explorer-api/reports.ts` | Saved report ownership and validation. |
| `backend/functions/cost-explorer-api/csv.ts` | AWS-compatible CSV generation and private S3 export. |
| `backend/functions/cost-explorer-api/handler.ts` | Route dispatch, auth gate, validation, response mapping, metrics. |
| `frontend/lib/aws-cost-explorer-url.ts` | URL/report round-trip without credentials. |
| `frontend/hooks/use-cost-explorer.ts` | Query/cancel/cache-refresh/report operations. |
| `app/aws/cost-explorer/page.tsx` | Protected static route and capability warning. |
| `app/components/aws-cost-explorer/` | Four panels and focused controls/charts/table components. |
| `terraform/compute.tf`, `terraform/api*.tf*` | Lambda, IAM, API methods, alias, permissions. |
| `terraform/data.tf` | Private export bucket and lifecycle. |
| `terraform/monitoring.tf` | Cost API/cache/export metrics and alarms. |

## 3. Implementation Steps

### Task 1: Add Cost Explorer SDK dependencies and domain contracts

- **GOAL-3101**: Define the exact validated language shared by the frontend and backend.

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/domain/src/aws-cost-explorer.ts`
- Modify: `packages/domain/package.json`
- Create: `lib/__tests__/aws-cost-explorer.test.ts`

**Interfaces:**

- Produces: `CostExplorerReportRequestSchema`, `CostExplorerExpressionSchema`, `CostExplorerResultSchema`, `SavedCostReportSchema`, `CostDimensionRequestSchema`.
- Produces error code union including `COGNITO_REAUTH_REQUIRED`, `INVALID_COST_QUERY`, `GRANULARITY_NOT_AVAILABLE`, `COST_EXPLORER_DISABLED`, `AWS_COST_ACCESS_DENIED`, `AWS_COST_QUERY_BUSY`, and `AWS_COST_THROTTLED`.

- [ ] **Step 1: Install exact AWS clients**

  Run: `pnpm add @aws-sdk/client-cost-explorer@^3.1101.0 @aws-sdk/client-billing@^3.1101.0`

  Expected: `package.json` and `pnpm-lock.yaml` update; no other package-manager files appear.

- [ ] **Step 2: Write failing schema tests**

  ```ts
  expect(CostExplorerReportRequestSchema.parse({
    mode: 'STANDARD',
    timePeriod: { start: '2026-01-01', end: '2026-08-01' },
    granularity: 'MONTHLY',
    metric: 'UnblendedCost',
    groupBy: [{ type: 'DIMENSION', key: 'SERVICE' }],
    chartStyle: 'STACK',
    showForecast: false,
    showOnlyUntagged: false,
    showOnlyUncategorized: false,
  }).groupBy).toHaveLength(1);
  ```

  Add rejection cases for three groups, invalid dates, excessive filter depth/count, unsupported match options, resource mode without ResourceId, and comparison mode with hourly/resource grouping.

- [ ] **Step 3: Implement recursive expression and report schemas**

  Use `z.lazy()` for `And`, `Or`, and `Not`; limit depth to five and selected values to 1,024 after parsing. Define discriminated mode refinements with `.superRefine()`.

- [ ] **Step 4: Define normalized response schemas**

  Include `source`, `asOf`, `currencyOrUnit`, `estimated`, `overview`, `series`, at most 50 `breakdown` rows, `comparisonDrivers`, and `nextBreakdownCursor`. Encode the cursor as a base64url validated `{ version: 1, digest, offset }` payload tied to the canonical query; never expose AWS `NextPageToken`.

- [ ] **Step 5: Export and run tests**

  Add package exports for `./aws-cost-explorer`.

  Run: `pnpm test lib/__tests__/aws-cost-explorer.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit domain contracts**

  ```bash
  git add package.json pnpm-lock.yaml packages/domain/src/aws-cost-explorer.ts packages/domain/package.json lib/__tests__/aws-cost-explorer.test.ts
  git commit -m "feat(costs): define Cost Explorer report contracts"
  ```

### Task 2: Implement semantic validation and canonical report hashing

- **GOAL-3102**: Make equivalent reports share cache keys and invalid AWS combinations fail before paid calls.

**Files:**

- Create: `packages/domain/src/aws-cost-canonical.ts`
- Modify: `packages/domain/package.json`
- Create: `lib/__tests__/aws-cost-canonical.test.ts`

**Interfaces:**

- Produces: `validateCostExplorerSemantics(request, preferences): ValidationResult`.
- Produces: `canonicalizeCostExplorerRequest(request): string`.
- Produces: `costExplorerQueryDigest(request): Promise<string>` in backend/browser adapters using Web Crypto.

- [ ] **Step 1: Write failing equivalence tests**

  Verify reordered OR values and reordered object keys canonicalize identically, while reordered group definitions remain different because group order affects output.

- [ ] **Step 2: Write failing AWS-rule tests**

  Cover hourly only with eligible resource mode, 14-day resource maximum, forecast unavailable with grouping, valid start-inclusive/end-exclusive dates, NormalizedUsageAmount/UsageQuantity unit caveats, and comparison resource exclusion.

- [ ] **Step 3: Implement canonicalization without raw logging**

  Sort filter values and commutative `And`/`Or` child encodings. Preserve `Not`, group order, dates, metric, billing view, granularity, chart style, and flags.

- [ ] **Step 4: Implement semantic validation**

  Return stable field paths and error codes consumed by both the Report parameters UI and the backend handler.

- [ ] **Step 5: Run tests and commit**

  Run: `pnpm test lib/__tests__/aws-cost-canonical.test.ts`

  ```bash
  git add packages/domain/src/aws-cost-canonical.ts packages/domain/package.json lib/__tests__/aws-cost-canonical.test.ts
  git commit -m "feat(costs): canonicalize and validate cost reports"
  ```

### Task 3: Build the read-only AWS adapter and normalization layer

- **GOAL-3103**: Retrieve complete AWS datasets through dependency-injected clients and normalized error codes.

**Files:**

- Create: `backend/shared/cost-explorer-clients.ts`
- Create: `backend/functions/cost-explorer-api/aws-adapter.ts`
- Create: `backend/__tests__/cost-explorer-aws-adapter.test.ts`

**Interfaces:**

- Produces: `CostExplorerAwsAdapter` methods `query`, `forecast`, `compare`, `listValues`, and `listBillingViews`.
- Produces: `collectAwsPages(fetchPage): Promise<CompleteAwsResult>`.

- [ ] **Step 1: Write all-page and no-partial-result tests**

  Mock three pages and assert token forwarding/order. Make page three fail and assert no normalized result is returned.

- [ ] **Step 2: Write command-mapping tests**

  Assert standard requests use `GetCostAndUsageCommand`, resource requests use `GetCostAndUsageWithResourcesCommand`, cost forecasts use `GetCostForecastCommand`, usage forecasts use `GetUsageForecastCommand`, comparisons use both comparison APIs, filters use dimension/tag/cost-category APIs, and billing views use Billing client commands.

- [ ] **Step 3: Implement lazy clients**

  Instantiate `CostExplorerClient` and `BillingClient` only inside the production dependency factory after provider authorization succeeds. Configure both for `us-east-1` and use the Lambda execution role; the Lambda itself remains in `ap-southeast-1`, and the API accepts no explicit credentials or client-selected region.

- [ ] **Step 4: Normalize values with decimal strings intact**

  Keep AWS amount strings through normalization, derive display numbers only in frontend formatting helpers, preserve units/estimated flags, and calculate top-nine-plus-Other with decimal-safe addition.

- [ ] **Step 5: Map AWS errors**

  Map access denial, disabled/not-ready, validation, throttling, and transient service errors to the typed domain codes. Retain AWS request ID only in sanitized internal error metadata.

- [ ] **Step 6: Run tests and commit**

  Run: `pnpm test backend/__tests__/cost-explorer-aws-adapter.test.ts`

  ```bash
  git add backend/shared/cost-explorer-clients.ts backend/functions/cost-explorer-api/aws-adapter.ts backend/__tests__/cost-explorer-aws-adapter.test.ts
  git commit -m "feat(costs): add read-only Cost Explorer adapter"
  ```

### Task 4: Implement complete-result chunk caching and refresh cooldown

- **GOAL-3104**: Avoid duplicate paid calls without violating DynamoDB size or completeness guarantees.

**Files:**

- Create: `backend/functions/cost-explorer-api/cache.ts`
- Modify: `backend/shared/metadata.ts`
- Create: `backend/__tests__/cost-explorer-cache.test.ts`

**Interfaces:**

- Produces: `getCachedCostResult(workspaceId, digest, now)`.
- Produces: `putCachedCostResult(workspaceId, digest, result, expiresAtEpoch)`.
- Produces: `claimManualRefresh(workspaceId, digest, now): boolean`.
- Produces: `claimQueryExecution(workspaceId, digest, requestId, now): 'owner' | 'wait'`.
- Produces: `releaseQueryExecution(workspaceId, digest, requestId)`.

- [ ] **Step 1: Write failing chunk-boundary tests**

  Serialize results into UTF-8 chunks no larger than 300 KiB. Assert one manifest plus deterministic `CHUNK#000001` records and exact round-trip equality.

- [ ] **Step 2: Write completeness and expiry tests**

  Missing, extra, expired, hash-mismatched, or invalid chunks must produce a cache miss and metric reason; they must never return partial financial data.

- [ ] **Step 3: Implement transactional publish semantics**

  Write chunks first with TTL, then conditionally write a manifest containing chunk count, payload SHA-256, schema version, `asOf`, and TTL. Readers require the manifest and every matching chunk.

- [ ] **Step 4: Implement TTL selection**

  Use one hour when the query end date is after the current UTC date or includes the current month; otherwise use 24 hours.

- [ ] **Step 5: Implement distributed query execution locking**

  Conditionally create a workspace-and-digest lock containing the owner request ID and a 35-second expiry. The owner calls AWS and publishes the complete manifest. A non-owner polls for that manifest with bounded jitter for at most 20 seconds, then returns retryable `AWS_COST_QUERY_BUSY`. Permit takeover only when a condition confirms the stored expiry is in the past; do not rely on DynamoDB TTL deletion or process-local promises.

- [ ] **Step 6: Implement five-minute refresh claims**

  Use a conditional DynamoDB put keyed by workspace and digest. Rejected claims return cached data with a cooldown timestamp rather than executing AWS.

- [ ] **Step 7: Run tests and commit**

  Run: `pnpm test backend/__tests__/cost-explorer-cache.test.ts`

  ```bash
  git add backend/functions/cost-explorer-api/cache.ts backend/shared/metadata.ts backend/__tests__/cost-explorer-cache.test.ts
  git commit -m "feat(costs): cache complete cost reports in chunks"
  ```

### Task 5: Implement owned saved reports and private CSV exports

- **GOAL-3105**: Reproduce report persistence and complete CSV download safely.

**Files:**

- Create: `backend/functions/cost-explorer-api/reports.ts`
- Create: `backend/functions/cost-explorer-api/csv.ts`
- Create: `backend/__tests__/cost-explorer-reports.test.ts`
- Create: `backend/__tests__/cost-explorer-csv.test.ts`

**Interfaces:**

- Produces: `listSavedReports`, `putSavedReport`, `deleteSavedReport` scoped to `WORKSPACE#primary`.
- Produces: `createCostCsv(result): Uint8Array`.
- Produces export response `{ downloadUrl, expiresAt, fileName }`.

- [ ] **Step 1: Write failing saved-report tests**

  Cover UUID report IDs, trimmed 1-80 character names, case-insensitive name uniqueness, schema validation, owner partition, deterministic ordering, replace, and foreign/missing delete.

- [ ] **Step 2: Implement saved-report metadata operations**

  Store the validated report request plus `createdAt`/`updatedAt`. Do not store AWS result data, credentials, tokens, or unvalidated JSON.

- [ ] **Step 3: Write failing CSV tests**

  Assert UTF-8 with BOM, CSV escaping, `YYYY-MM-DD` dates, transposed AWS-style period columns, complete breakdown rows, decimal-string precision, and no cache/provider/internal fields.

- [ ] **Step 4: Implement private export creation**

  Write `exports/primary/{digest}/{uuid}.csv` with `text/csv; charset=utf-8`, server-side encryption, and metadata limited to schema version/expiry. Return a five-minute presigned GET URL; never return the S3 bucket/key.

- [ ] **Step 5: Run tests and commit**

  Run: `pnpm test backend/__tests__/cost-explorer-reports.test.ts backend/__tests__/cost-explorer-csv.test.ts`

  ```bash
  git add backend/functions/cost-explorer-api/reports.ts backend/functions/cost-explorer-api/csv.ts backend/__tests__/cost-explorer-reports.test.ts backend/__tests__/cost-explorer-csv.test.ts
  git commit -m "feat(costs): save reports and export private CSV files"
  ```

### Task 6: Implement the Cost Explorer API router and typed failure behavior

- **GOAL-3106**: Expose the complete backend API behind one strict provider gate.

**Files:**

- Create: `backend/functions/cost-explorer-api/handler.ts`
- Create: `backend/__tests__/cost-explorer-api.test.ts`
- Modify: `backend/shared/api-response.ts`
- Modify: `scripts/local/handlers.ts`
- Modify: `scripts/dev-server.ts`

**Interfaces:**

- Handles: query, comparisons, dimensions, forecast, export, and saved-report routes from the specification.
- Consumes: Tasks 1-5 interfaces and Step 30 authorization.

- [ ] **Step 1: Write provider-gate tests for every route branch**

  Inject an AWS client factory spy and assert a Google authorization returns 403 `COGNITO_REAUTH_REQUIRED` with zero factory calls for query, dimensions, forecast, comparisons, reports, and export.

- [ ] **Step 2: Write validation, cache, refresh, and error tests**

  Prove invalid requests make zero AWS calls; cache hits bypass AWS; cache misses write only complete results; refresh cooldown prevents duplicate calls; concurrent misses elect one AWS caller; lock wait timeout maps to retryable `AWS_COST_QUERY_BUSY`; mapped errors preserve no raw filter data.

- [ ] **Step 3: Implement route dispatch by method/path**

  Reject unknown subpaths/methods. Parse bodies before business calls, but authorize provider before any AWS construction. Use one request ID and sanitized error envelope.

- [ ] **Step 4: Implement local deterministic fixtures**

  Add an in-memory adapter with fixed non-production service names/amounts, pagination, forecast, comparisons, dimensions, billing views, saved reports, and exports. Local logs print route/status only.

- [ ] **Step 5: Run the handler suite**

  Run: `pnpm test backend/__tests__/cost-explorer-api.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit API behavior**

  ```bash
  git add backend/functions/cost-explorer-api/handler.ts backend/__tests__/cost-explorer-api.test.ts backend/shared/api-response.ts scripts/local/handlers.ts scripts/dev-server.ts
  git commit -m "feat(costs): expose authenticated Cost Explorer APIs"
  ```

### Task 7: Provision Cost Explorer, cache, export, API, and observability infrastructure

- **GOAL-3107**: Deploy exact read-only permissions and default-disabled paid features.

**Files:**

- Modify: `terraform/versions.tf`
- Modify: `terraform/variables.tf`
- Modify: `terraform/terraform.tfvars.example`
- Modify: `terraform/data.tf`
- Modify: `terraform/compute.tf`
- Modify: `terraform/api-openapi.yaml.tftpl`
- Modify: `terraform/api.tf`
- Modify: `terraform/monitoring.tf`
- Modify: `terraform/outputs.tf`
- Modify: `terraform/tests/data_compute.tftest.hcl`
- Modify: `terraform/tests/auth_api_edge.tftest.hcl`

**Interfaces:**

- Produces Lambda `cashight-cost-explorer-api` and live alias.
- Produces private export bucket with one-day lifecycle and exact GET CORS origin.
- Produces variable `enable_cost_explorer_granular_data` default `false`.

- [ ] **Step 1: Write failing Terraform assertions**

  Assert the exact `ce`, `billing`, and `aws-portal:ViewBilling` action allowlist, absence of wildcard actions, export prefix-only S3 permissions, DynamoDB item permissions, no Secrets/SSM permission, and provider route methods.

- [ ] **Step 2: Add export bucket controls**

  Block public access, BucketOwnerEnforced, AES256 or repository-standard encryption, HTTPS-only bucket policy, exact app-origin GET CORS, versioning disabled, and one-day lifecycle under `exports/`.

- [ ] **Step 3: Add Lambda resources**

  Configure Node.js 22, 1024 MiB, 28-second timeout, reserved concurrency 2, active tracing, environment `TABLE_NAME`, `EXPORT_BUCKET`, and `GRANULAR_DATA_ENABLED`, 30-day logs, live alias, and API invocation permission.

- [ ] **Step 4: Add OpenAPI routes**

  Add exact GET/POST/DELETE and OPTIONS methods, Cognito scopes, request validation, and CORS for every Cost Explorer path. Pass one Lambda alias ARN to all route integrations.

- [ ] **Step 5: Add metrics and alarms**

  Alarm on errors, duration, throttles, AWS access/disabled errors, cache corruption, and export failures. Metrics dimensions contain operation/result only, never report values.

- [ ] **Step 6: Keep granular preference operator-controlled**

  Terraform never mutates the Cost Explorer account preference. When `enable_cost_explorer_granular_data=true`, a precondition also requires `cost_explorer_granular_data_enabled_out_of_band=true`, confirming an operator already enabled the required preference in the AWS Billing console.

- [ ] **Step 7: Run infrastructure checks**

  Run: `cd terraform && terraform fmt -check -recursive && terraform validate && terraform test`

  Run: `tflint --recursive`

  Run: `uvx checkov -d terraform`

  Expected: PASS with no high/critical findings introduced.

- [ ] **Step 8: Commit infrastructure**

  ```bash
  git add terraform
  git commit -m "infra(costs): provision Cost Explorer dashboard backend"
  ```

### Task 8: Add frontend contracts, URL state, and report data hook

- **GOAL-3108**: Give the static route a typed, cancellable report state machine.

**Files:**

- Modify: `frontend/api/contracts.ts`
- Create: `frontend/lib/aws-cost-explorer-url.ts`
- Create: `frontend/hooks/use-cost-explorer.ts`
- Create: `frontend/__tests__/aws-cost-explorer-url.test.ts`
- Create: `frontend/__tests__/use-cost-explorer.test.tsx`

**Interfaces:**

- Produces URL functions `parseCostReportSearch()` and `serializeCostReportSearch()`.
- Produces hook methods `run`, `refresh`, `saveReport`, `deleteReport`, `exportCsv`, and `cancel`.

- [ ] **Step 1: Write URL round-trip tests**

  Cover all report fields, repeated filter values, two groups, comparison periods, absent defaults, malformed input fallback, and proof that token/credential/account-role keys are discarded.

- [ ] **Step 2: Implement compact versioned URL state**

  Use readable query parameters for dates/metric/granularity/style and one base64url-encoded validated filter JSON parameter prefixed with schema version `v1`. Enforce maximum decoded length before JSON parse.

- [ ] **Step 3: Write hook state tests**

  Cover idle/loading/success/error, abort superseded query, stale-response suppression, cached freshness, refresh cooldown, report CRUD, and programmatic download URL click without forwarding Authorization to S3.

- [ ] **Step 4: Implement API response contracts and hook**

  Parse every response with domain schemas. Use `apiFetch` only for API-origin requests and native `fetch(downloadUrl)`/anchor navigation without bearer headers for the presigned S3 URL.

- [ ] **Step 5: Run tests and commit**

  Run: `pnpm test frontend/__tests__/aws-cost-explorer-url.test.ts frontend/__tests__/use-cost-explorer.test.tsx`

  ```bash
  git add frontend/api/contracts.ts frontend/lib/aws-cost-explorer-url.ts frontend/hooks/use-cost-explorer.ts frontend/__tests__
  git commit -m "feat(costs): add Cost Explorer client state"
  ```

### Task 9: Build Report parameters and saved-report controls

- **GOAL-3109**: Implement every approved report control with AWS compatibility feedback.

**Files:**

- Create: `app/components/aws-cost-explorer/report-parameters.tsx`
- Create: `app/components/aws-cost-explorer/filter-builder.tsx`
- Create: `app/components/aws-cost-explorer/saved-reports.tsx`
- Create: `app/__tests__/cost-explorer-parameters.test.tsx`
- Create: `components/ui/input.tsx`
- Create: `components/ui/checkbox.tsx`
- Create: `components/ui/collapsible.tsx`

**Interfaces:**

- Consumes domain semantic validation from Task 2.
- Emits one complete `CostExplorerReportRequest` through `onApply(request)`.

- [ ] **Step 1: Write failing control-coverage tests**

  Assert relative/custom dates, compare mode, billing view, metric, granularity, two group slots, chart style, every filter dimension, tags, cost categories, forecast, untagged, and uncategorized controls.

- [ ] **Step 2: Write incompatible-state tests**

  Verify grouped forecast, resource comparison, disabled granular data, invalid resource service/date, and normalized-usage warnings are disabled with exact explanatory text.

- [ ] **Step 3: Implement lazy paginated filter selectors**

  Load values only when a selector opens or search changes after 250 ms. Preserve selected values not present on the current page. Apply OR within one filter and AND across filter cards.

- [ ] **Step 4: Implement report apply/reset/share behavior**

  Do not query on every keystroke. Apply validates once, writes URL state, and calls `onApply`. Reset restores the AWS-style default report. Copy-link copies the current same-origin URL only.

- [ ] **Step 5: Implement saved report CRUD UI**

  Add save-as, rename, load, delete confirmation, loading/error states, and case-insensitive duplicate-name feedback.

- [ ] **Step 6: Run tests and commit**

  Run: `pnpm test app/__tests__/cost-explorer-parameters.test.tsx`

  ```bash
  git add app/components/aws-cost-explorer components/ui app/__tests__/cost-explorer-parameters.test.tsx
  git commit -m "feat(costs): build Cost Explorer report parameters"
  ```

### Task 10: Build the four panels and protected Cost Explorer page

- **GOAL-3110**: Deliver the complete responsive dashboard surface and warning flow.

**Files:**

- Create: `app/aws/cost-explorer/page.tsx`
- Create: `app/components/aws-cost-explorer/cost-overview.tsx`
- Create: `app/components/aws-cost-explorer/cost-usage-graph.tsx`
- Create: `app/components/aws-cost-explorer/cost-breakdown.tsx`
- Create: `app/components/aws-cost-explorer/cost-explorer-dashboard.tsx`
- Create: `app/components/aws-cost-explorer/cognito-reauth-warning.tsx`
- Create: `app/__tests__/cost-explorer-dashboard.test.tsx`
- Modify: `app/loading.tsx`
- Modify: `app/globals.css`
- Modify: `app/signin/page.tsx`

**Interfaces:**

- Consumes `useSessionCapabilities()`, `useCostExplorer()`, and `CostExplorerResult`.
- Re-auth action calls Cognito managed login without `identity_provider=Google` and preserves `returnTo=/aws/cost-explorer/` in OIDC state.

- [ ] **Step 1: Write failing capability-state tests**

  Google capability renders the persistent warning and no report hook invocation. Native capability renders parameters and runs the URL/default request. Loading/error states do not flash protected data.

- [ ] **Step 2: Write failing panel-state tests**

  Cover exact titles, estimated/final/freshness labels, AWS/cache banner, empty data, forecast unavailable, graph style switch, top-nine-plus-Other, legend toggles, tooltips, complete table, sorting/pagination, comparison columns/drivers, refresh cooldown, and export.

- [ ] **Step 3: Implement overview and graph**

  Use existing Card and chart tooltip conventions, tabular numeric formatting, decimal-string display conversion, Recharts Bar/Area/Line primitives, and accessible summary text for screen readers.

- [ ] **Step 4: Implement breakdown table**

  Render server-normalized breakdown pages, sticky period headers on wide screens, mobile cards on narrow screens, deterministic sorting, and no full linked-account values in DOM or aria labels.

- [ ] **Step 5: Compose the page**

  Use `ProtectedRoute`, Suspense for `useSearchParams`, the approved Cashight/AWS hybrid layout, and responsive 12-column composition. Keep Report parameters visible beside or below the graph based on viewport.

- [ ] **Step 6: Implement native re-auth return flow**

  Extend OIDC redirect state rather than trusting a free-form return URL. Callback accepts only the exact in-app allowlist and returns to Cost Explorer after native sign-in.

- [ ] **Step 7: Run component and static build tests**

  Run: `pnpm test app/__tests__/cost-explorer-dashboard.test.tsx`

  Run: `pnpm build`

  Expected: PASS and `out/aws/cost-explorer/index.html` exists.

- [ ] **Step 8: Commit the dashboard**

  ```bash
  git add app/aws app/components/aws-cost-explorer app/__tests__/cost-explorer-dashboard.test.tsx app/loading.tsx app/globals.css app/signin/page.tsx
  git commit -m "feat(costs): add full Cost Explorer dashboard"
  ```

### Task 11: Add end-to-end, cost-safety, and production verification

- **GOAL-3111**: Prove parity, security, and cost controls before enabling the route.

**Files:**

- Create: `tests/e2e/aws-cost-explorer.spec.ts`
- Modify: `scripts/smoke-serverless.mjs`
- Create: `docs/runbooks/aws-cost-explorer.md`
- Modify: `.env.example`

**Interfaces:**

- Adds feature flag `NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER` default `false` in production configuration.

- [ ] **Step 1: Add mocked browser parity flow**

  Exercise every report parameter family, all three chart styles, comparisons, saved reports, URL reload, cache/refresh status, CSV download, responsive layouts, and keyboard navigation.

- [ ] **Step 2: Add Google-session denial flow**

  Mock a Google capability and backend 403; assert no cost data appears, no AWS query request is sent by the page, and Cognito re-auth preserves the allowlisted return route.

- [ ] **Step 3: Extend serverless smoke checks**

  With an authenticated native token, run one bounded historical service-group query twice and assert first response `AWS`, second response `CACHE`, identical totals, and no sensitive fields. Skip with an explicit environment result when Cost Explorer is not enabled in the target account.

- [ ] **Step 4: Write operator runbook**

  Document IAM actions, Cost Explorer enablement, current API pricing link, cache TTL/cooldown, alarms, feature flag, smoke query, granular-data opt-in and charges, rollback, and export-bucket inspection.

- [ ] **Step 5: Run full verification**

  Run: `pnpm lint`

  Run: `pnpm tsc --noEmit`

  Run: `pnpm test`

  Run: `pnpm build`

  Run: `pnpm test:e2e -- tests/e2e/aws-cost-explorer.spec.ts`

  Run: `cd terraform && terraform fmt -check -recursive && terraform validate && terraform test`

  Expected: all commands PASS.

- [ ] **Step 6: Commit verification assets**

  ```bash
  git add tests/e2e/aws-cost-explorer.spec.ts scripts/smoke-serverless.mjs docs/runbooks/aws-cost-explorer.md .env.example
  git commit -m "test(costs): verify Cost Explorer parity and safeguards"
  ```

## 4. Alternatives

- **ALT-3101**: Give the browser Cognito Identity Pool credentials. Rejected because it exposes AWS capability to the browser and conflicts with the selected backend-role trust model.
- **ALT-3102**: Ingest CUR/Data Exports into Athena. Rejected because it does not reproduce the Cost Explorer API/console report behavior and adds an independent warehouse.
- **ALT-3103**: Cache one result per DynamoDB item. Rejected because full grouped/resource responses can exceed the 400 KiB item limit.
- **ALT-3104**: Return CSV directly through API Gateway. Rejected because complete exports can exceed synchronous response limits and would hold Lambda/API connections unnecessarily.

## 5. Dependencies

- **DEP-3101**: Completed Step 30 workspace/provider/capabilities interfaces.
- **DEP-3102**: AWS Cost Explorer enabled in the deployment account for production smoke validation.
- **DEP-3103**: Existing API Gateway, DynamoDB, Lambda bundling/deployment, CloudWatch, WAF, and static frontend infrastructure.
- **DEP-3104**: Existing Recharts, Card, Table, Select, Pagination, Tooltip, Theme, and ProtectedRoute patterns.

## 6. Files

- **FILE-3101**: Cost domain and canonicalization under `packages/domain/src/`.
- **FILE-3102**: Cost backend under `backend/functions/cost-explorer-api/`.
- **FILE-3103**: Cost frontend under `app/aws/cost-explorer/`, `app/components/aws-cost-explorer/`, and `frontend/`.
- **FILE-3104**: Cost infrastructure and monitoring under `terraform/`.
- **FILE-3105**: Cost verification and operations under `tests/e2e/` and `docs/runbooks/`.

## 7. Testing

- **TEST-3101**: Domain tests cover every mode, control, restriction, canonicalization rule, and normalized response.
- **TEST-3102**: Adapter tests cover SDK commands, pagination, decimal precision, complete-result behavior, and typed errors.
- **TEST-3103**: Cache tests cover chunks, manifests, corruption, TTL, cooldown, and deduplication.
- **TEST-3104**: Handler tests prove provider enforcement before AWS construction and no partial totals.
- **TEST-3105**: Component/browser tests cover all four panels, parameters, URL state, saved reports, exports, re-auth, responsive layout, and accessibility.
- **TEST-3106**: Terraform tests prove exact IAM, API, S3, Lambda, concurrency, granular-data default, logs, and alarms.

## 8. Risks & Assumptions

- **RISK-3101**: Full filter/resource queries can create many paid pages. Mitigation: strict validation, complete-result cache, refresh cooldown, reserved concurrency, and request/page metrics.
- **RISK-3102**: AWS changes console behavior after the pin date. Mitigation: scope parity to 2026-08-03 and update spec/tests deliberately for future changes.
- **RISK-3103**: Decimal conversion changes financial display. Mitigation: preserve AWS amount strings and use decimal-safe aggregation/formatting.
- **RISK-3104**: Query chunks become inconsistent after interrupted writes. Mitigation: chunks-first manifest-last publication and full payload hash validation.
- **ASSUMPTION-3101**: The deployment account grants the documented Cost Explorer/Billing read actions and has billing data available.
- **ASSUMPTION-3102**: Resource/hourly data remains disabled until Huy explicitly enables the charged account preference.

## 9. Completion Criteria

- Every requirement REQ-3101 through REQ-3108 has automated coverage.
- A Google session cannot instantiate an AWS billing client or receive cached cost data.
- A native session can use every approved report control against only the deployment account.
- The graph plots top nine plus Other while the breakdown/export retains complete data.
- Cache manifests/chunks never return partial or invalid totals.
- CSV downloads use five-minute presigned URLs from the private lifecycle bucket.
- Terraform contains no wildcard Cost Explorer action and granular data defaults to disabled.
- `out/aws/cost-explorer/index.html` builds successfully.
- All application, browser, infrastructure, and security checks pass before the feature flag is enabled.

## 10. Related Specifications / Further Reading

- [Approved AWS dashboards design](../superpowers/specs/2026-08-03-aws-cost-billing-dashboards-design.md)
- [AWS Cost Explorer report controls](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-modify.html)
- [AWS Cost Explorer filtering](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-filtering.html)
- [Cost Explorer API reference](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html)
- [Cost Explorer IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ce.html)
