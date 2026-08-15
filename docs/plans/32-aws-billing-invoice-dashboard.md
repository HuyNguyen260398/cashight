---
goal: Implement known-layout AWS monthly invoice ingestion, dashboards, history, and privacy-safe AI summaries
version: 1.0
date_created: 2026-08-03
last_updated: 2026-08-03
owner: Huy
status: 'Planned'
tags:
  - feature
  - aws
  - invoice
  - pdf
  - dashboard
  - ai
  - terraform
---

# AWS Billing Invoice Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized Cashight user upload the approved AWS consolidated monthly invoice PDF layout, persist a reconciled privacy-safe monthly model, explore it through charts/history, and request an aggregate-only Gemini summary.

**Architecture:** A dedicated invoice upload prefix routes to an isolated SQS queue and `invoice-parser-worker`. The worker extracts positioned PDF rows once, selects the known-layout parser, converts USD fields to integer cents, removes bill-to/account/invoice identifiers, reconciles service/account/invoice totals, validates the domain schema, and persists one versioned JSON record per workspace/month. One invoice API serves uploads, history, records, deletion, and dashboard aggregates; a separate summary API owns the Gemini privacy boundary.

**Tech Stack:** TypeScript 5, Zod 4, pdfjs-dist 5, pdf-parse 2, React 19, Next.js 16, Recharts 3, S3, SQS/DLQ, DynamoDB, Lambda Node.js 22, Gemini, Terraform, Vitest, Testing Library, Playwright.

## Global Constraints

- Step 30 must be complete; all invoice ownership uses `authorization.workspaceId = 'primary'`.
- Accept Google or Cognito-native authorized sessions for invoices; only Cost Explorer requires native Cognito.
- Support only the approved Amazon Web Services, Inc. consolidated USD invoice layout represented by the local sample.
- Keep the user-supplied source PDF outside Git and never copy its filename, identifiers, names, addresses, account numbers, or exact totals into committed tests/docs.
- Import `pdf-dom-polyfill` before every `pdfjs-dist` or `pdf-parse` import.
- Copy `pdf.worker.mjs` beside both PDF parser Lambda artifacts.
- Extract PDF layout once; do not run separate text and layout extraction passes.
- Reconcile currency with integer cents; never compare financial totals through floating-point equality.
- Strip private header/account fields before parser output crosses into storage, metadata, logs, APIs, or AI shaping.
- Keep raw upload lifecycle at one day maximum and delete terminal raw PDFs immediately when safe.

---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This is Step 32 in `docs/plans/00-INDEX.md`. It depends on Step 30 but not Step 31, so invoice work may proceed in parallel with Cost Explorer after workspace ownership lands.

## 1. Requirements & Constraints

- **REQ-3201**: Upload one PDF through presigned S3 and poll a typed invoice job to a terminal state.
- **REQ-3202**: Parse all pages of the known consolidated invoice, including continued services and linked-account allocation sections.
- **REQ-3203**: Persist only the approved privacy-safe `AwsInvoice` model and one current record per billing month.
- **REQ-3204**: Detect month conflicts and require explicit force replacement while S3 versioning preserves prior data.
- **REQ-3205**: Render KPIs, service donut, top-services bars, charge/tax composition, masked account allocation, monthly trend, and service detail table.
- **REQ-3206**: Support month URL state, invoice history/list, delete confirmation, loading/empty/error states, and responsive rendering.
- **REQ-3207**: Generate a click-triggered AI summary from anonymized aggregates only.
- **REQ-3208**: Return explicit `UNSUPPORTED_AWS_INVOICE`, `INVOICE_TOTAL_MISMATCH`, `INVOICE_CONFLICT`, `INVALID_PDF`, and checksum errors.
- **SEC-3201**: Never persist or return bill-to data, invoice IDs, full account IDs, personal/account labels, contact text, or raw PDF lines.
- **SEC-3202**: Never include prohibited fields in Gemini payloads, prompts, logs, metrics, traces, or test snapshots.
- **SEC-3203**: Derive S3/DynamoDB keys only from validated workspace, parser dates, and generated job IDs.
- **CON-3201**: The sample contains multi-page service sections and multiple linked accounts, including zero-valued entries.
- **CON-3202**: Unknown AWS seller/tax invoice variants must fail closed rather than partially parse.
- **PAT-3201**: Use fixture-free synthetic positioned rows in CI and a self-skipping gitignored PDF integration test locally.

## 2. File Structure

| Path | Responsibility |
| --- | --- |
| `packages/domain/src/aws-invoices.ts` | Invoice, metadata, dashboard, job, error, and AI payload schemas. |
| `packages/domain/src/parsers/aws-invoice/fields.ts` | Date/USD/minor-unit/row field parsing and scrubbing. |
| `packages/domain/src/parsers/aws-invoice/known-layout.ts` | Known seller/layout markers, page sections, totals, accounts, reconciliation. |
| `packages/domain/src/parsers/aws-invoice/index.ts` | Parser registry and extract-once dispatch. |
| `packages/domain/src/aws-invoice-aggregations.ts` | KPI/chart/history aggregation helpers. |
| `packages/domain/src/aws-invoice-summary-payload.ts` | Aggregate-only Gemini payload boundary. |
| `backend/functions/aws-invoices-api/handler.ts` | Upload/status/list/get/delete/dashboard HTTP operations. |
| `backend/functions/invoice-parser-worker/` | SQS event parsing and idempotent PDF job processor. |
| `backend/functions/aws-invoice-summary-api/` | Prompt shaping and Gemini response. |
| `frontend/hooks/use-pdf-upload-job.ts` | Shared presigned-PDF upload state machine. |
| `frontend/hooks/use-aws-invoices.ts` | Invoice history/record/dashboard/delete operations. |
| `app/aws/billing-invoice/page.tsx` | Protected month-driven route. |
| `app/components/aws-invoices/` | Upload, KPI, chart, table, list, and AI components. |
| `terraform/data.tf`, `terraform/compute.tf`, `terraform/api*.tf*` | Queue/DLQ, notification, Lambdas, IAM, routes, permissions. |
| `terraform/monitoring.tf` | Invoice API, worker, queue, reconciliation, and summary alarms. |

## 3. Implementation Steps

### Task 1: Define invoice, job, dashboard, and error contracts

- **GOAL-3201**: Establish one privacy-safe domain model before parser or storage code exists.

**Files:**

- Create: `packages/domain/src/aws-invoices.ts`
- Modify: `packages/domain/package.json`
- Create: `lib/__tests__/aws-invoices.test.ts`

**Interfaces:**

- Produces: `AwsInvoiceSchema`, `AwsInvoiceMetadataSchema`, `AwsInvoiceDashboardSchema`, `AwsInvoiceUploadJobSchema`, `AwsInvoiceSummaryPayloadSchema`.
- Produces: `AwsInvoiceErrorCodeSchema` with the exact approved error codes.

- [ ] **Step 1: Write failing privacy-safe schema tests**

  ```ts
  const invoice = AwsInvoiceSchema.parse({
    seller: 'Amazon Web Services, Inc.',
    billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
    invoiceDate: '2026-08-01',
    dueDate: '2026-08-01',
    currency: 'USD',
    totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
    services: [{ name: 'Example Service', charges: 100, tax: 10, total: 110 }],
    linkedAccounts: [{
      accountLast4: '1234', charges: 100, credits: 0, tax: 10, total: 110,
      services: [{ name: 'Example Service', charges: 100, tax: 10, total: 110 }],
    }],
    source: { parserId: 'aws-inc-consolidated-usd', parserVersion: 1,
      sha256: 'a'.repeat(64), uploadedAt: '2026-08-03T00:00:00.000Z' },
  });
  expect(invoice.totals.amountDue).toBe(110);
  ```

  Add `.strict()` rejection tests for `billTo`, `address`, `invoiceNumber`, `accountId`, `accountLabel`, and `rawText` at every nested level.

- [ ] **Step 2: Define exact month/job/dashboard contracts**

  Month IDs use `/^\d{4}-(0[1-9]|1[0-2])$/`. Upload conflict contains `{ year, month }` only. Dashboard response includes selected invoice, monthly trend, and precomputed chart arrays.

- [ ] **Step 3: Enforce money/date/cardinality boundaries**

  Require finite two-decimal currency values, nonnegative tax, credits represented as nonnegative subtraction values, four-digit masked accounts, nonempty service arrays after zero-only filtering, and ISO dates.

- [ ] **Step 4: Export package subpath and run tests**

  Add `"./aws-invoices": "./src/aws-invoices.ts"`.

  Run: `pnpm test lib/__tests__/aws-invoices.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit contracts**

  ```bash
  git add packages/domain/src/aws-invoices.ts packages/domain/package.json lib/__tests__/aws-invoices.test.ts
  git commit -m "feat(invoices): define privacy-safe AWS invoice contracts"
  ```

### Task 2: Implement invoice field parsing, scrubbing, and minor-unit math

- **GOAL-3202**: Isolate every seller-specific conversion and privacy transformation.

**Files:**

- Create: `packages/domain/src/parsers/aws-invoice/fields.ts`
- Create: `lib/__tests__/aws-invoice-fields.test.ts`

**Interfaces:**

- Produces: `parseAwsInvoiceDate`, `parseUsdCents`, `centsToUsdNumber`, `maskAwsAccountId`, `safeServiceName`, `reconcileCents`.

- [ ] **Step 1: Write failing date and amount tests**

  Cover `USD 1,234.56`, `USD 0.00`, whitespace splits across cells, invalid currency, more than two decimals, negative/parenthesized values, malformed dates, and billing period range parsing.

- [ ] **Step 2: Implement integer-cent conversion**

  ```ts
  export function parseUsdCents(value: string): number {
    const match = /^USD\s+([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\.([0-9]{2})$/.exec(value.trim());
    if (!match) throw new AwsInvoiceParseError('INVALID_USD_AMOUNT');
    return Number(match[1].replaceAll(',', '')) * 100 + Number(match[2]);
  }
  ```

  Guard with `Number.isSafeInteger` and maximum invoice cents.

- [ ] **Step 3: Implement strict account masking and service scrubbing**

  Accept only 12-digit AWS account IDs at the parser boundary and return last four. Reject service names containing account IDs, email, street/address markers, or invoice-number markers.

- [ ] **Step 4: Implement reconciliation helper**

  `reconcileCents(label, expected, actual)` throws typed `InvoiceTotalMismatchError` with a sanitized label enum, never source text or amounts in the message.

- [ ] **Step 5: Run tests and commit**

  Run: `pnpm test lib/__tests__/aws-invoice-fields.test.ts`

  ```bash
  git add packages/domain/src/parsers/aws-invoice/fields.ts lib/__tests__/aws-invoice-fields.test.ts
  git commit -m "feat(invoices): parse and reconcile AWS invoice fields"
  ```

### Task 3: Implement the known-layout parser and registry

- **GOAL-3203**: Parse every approved section from synthetic positioned rows and fail closed on variants.

**Files:**

- Create: `packages/domain/src/parsers/aws-invoice/known-layout.ts`
- Create: `packages/domain/src/parsers/aws-invoice/index.ts`
- Modify: `packages/domain/package.json`
- Create: `lib/__tests__/aws-invoice-parser.test.ts`

**Interfaces:**

- Produces: `AwsInvoiceParser` interface with `id`, `canParse(document)`, and `parse(document)`.
- Produces: `parseAwsInvoiceDocument({ pages, sha256, uploadedAt }): AwsInvoice`.
- Produces: `UnsupportedAwsInvoiceError` and `InvoiceTotalMismatchError`.

- [ ] **Step 1: Build synthetic redacted layout fixtures**

  Construct `LayoutPage[]` in test code with fake account IDs, service names, dates, and amounts. Cover invoice summary, consolidated service detail across page boundaries, linked-account allocation, per-account detail, repeated footer text, and zero-value services.

- [ ] **Step 2: Write failing recognition tests**

  Require exact seller heading plus invoice summary, billing period, detail for consolidated bill, and linked account allocation markers. Missing or conflicting markers must not match.

- [ ] **Step 3: Write failing section/state-machine tests**

  Assert headers start sections, continued pages append to the current section, footers are ignored only through exact safe markers, and a service row cannot be assigned to two sections.

- [ ] **Step 4: Implement known-layout parsing**

  Parse layout rows top-to-bottom using x-coordinate bands for label/value cells. Aggregate `Charges`, `Credits`, and recognized tax labels into cents. Remove zero-only services from chart lists only after they participate in reconciliation.

- [ ] **Step 5: Reconcile all levels**

  Validate service total = charges + tax, linked-account total = charges - credits + tax, consolidated service sum = invoice charges/tax, linked-account sum = invoice amount, and invoice amount due = charges - credits + tax.

- [ ] **Step 6: Scrub before returning**

  Return only the `AwsInvoice` fields from Task 1. Do not retain source rows in the parser object, thrown errors, snapshots, or debug values.

- [ ] **Step 7: Export and run tests**

  Add `"./parsers/aws-invoice": "./src/parsers/aws-invoice/index.ts"`.

  Run: `pnpm test lib/__tests__/aws-invoice-parser.test.ts`

  Expected: PASS for all approved and fail-closed fixtures.

- [ ] **Step 8: Commit parser**

  ```bash
  git add packages/domain/src/parsers/aws-invoice packages/domain/package.json lib/__tests__/aws-invoice-parser.test.ts
  git commit -m "feat(invoices): parse known AWS consolidated invoices"
  ```

### Task 4: Add extract-once PDF dispatch and secure local fixture verification

- **GOAL-3204**: Connect the pure parser to PDF bytes without committing private fixtures.

**Files:**

- Modify: `packages/domain/src/parsers/pdf-layout.ts`
- Modify: `packages/domain/src/parsers/aws-invoice/index.ts`
- Create: `lib/__tests__/aws-invoice-pdf.test.ts`
- Create: `scripts/test-aws-invoice-parser.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `scripts/build-lambdas.mjs`
- Modify: `scripts/__tests__/build-lambdas.test.ts`

**Interfaces:**

- Produces: `parseAwsInvoicePdf(buffer, { sha256, uploadedAt }): Promise<AwsInvoice>`.
- Consumes optional local `AWS_INVOICE_FIXTURE` environment path.

- [ ] **Step 1: Write a self-skipping local fixture test**

  The test skips when `AWS_INVOICE_FIXTURE` is absent. When present, it reads the PDF, parses it, runs `AwsInvoiceSchema.parse()`, reruns reconciliation from persisted aggregates, and asserts no prohibited keys through a recursive key scan. It does not snapshot or print values.

- [ ] **Step 2: Implement extract-once dispatch**

  Call `extractPdfLayout(buffer)` exactly once and pass `{ pages }` to the registry. Preserve the existing `pdf-dom-polyfill` import before `pdfjs-dist` in `pdf-layout.ts`.

- [ ] **Step 3: Add a safe manual CLI**

  `pnpm test:aws-invoice-parser` requires `AWS_INVOICE_FIXTURE`, prints parser ID/version, billing month, currency, service count, linked-account count, reconciliation success, and prohibited-field scan success. It never prints source path, totals, IDs, names, addresses, services, or raw text.

- [ ] **Step 4: Protect fixture paths**

  Add `test-pdfs/aws-invoices/` to `.gitignore`; do not add or copy the user's source PDF.

- [ ] **Step 5: Ship the pdfjs worker for both parser Lambdas**

  Change the build condition to:

  ```js
  const pdfWorkerFunctions = new Set(['parser-worker', 'invoice-parser-worker']);
  if (pdfWorkerFunctions.has(functionName)) {
    await copyFile(workerSource, path.join(outputDirectory, 'pdf.worker.mjs'));
  }
  ```

- [ ] **Step 6: Run fixture-free and build tests**

  Run: `pnpm test lib/__tests__/aws-invoice-pdf.test.ts scripts/__tests__/build-lambdas.test.ts`

  Expected: CI test skips local PDF and build test proves both artifacts receive a worker.

- [ ] **Step 7: Run the private local fixture manually**

  Run with `AWS_INVOICE_FIXTURE` already populated out of band: `pnpm test:aws-invoice-parser`

  Expected: PASS with sanitized structural output only.

- [ ] **Step 8: Commit PDF integration without the fixture**

  ```bash
  git add packages/domain/src/parsers packages/domain/package.json lib/__tests__/aws-invoice-pdf.test.ts scripts/test-aws-invoice-parser.ts scripts/build-lambdas.mjs scripts/__tests__/build-lambdas.test.ts package.json .gitignore
  git commit -m "feat(invoices): integrate secure AWS invoice PDF parsing"
  ```

### Task 5: Add invoice storage, metadata, upload jobs, and aggregation helpers

- **GOAL-3205**: Define owned monthly persistence and pure dashboard calculations.

**Files:**

- Modify: `backend/shared/storage.ts`
- Modify: `backend/shared/metadata.ts`
- Create: `packages/domain/src/aws-invoice-aggregations.ts`
- Modify: `packages/domain/package.json`
- Create: `lib/__tests__/aws-invoice-aggregations.test.ts`
- Create: `backend/__tests__/aws-invoice-metadata.test.ts`

**Interfaces:**

- Produces: `awsInvoiceObjectKey('primary', year, month)`.
- Produces metadata/query methods for `WORKSPACE#primary` / `AWS_INVOICE#yyyy-mm`.
- Produces `aggregateAwsInvoiceDashboard(selected, history)`.

- [ ] **Step 1: Write failing key and ownership tests**

  ```ts
  expect(awsInvoiceObjectKey('primary', 2026, 7)).toBe(
    'users/primary/aws-invoices/2026/2026-07.json',
  );
  ```

  Assert foreign partition/object keys fail and month IDs reject path traversal or extra segments.

- [ ] **Step 2: Define invoice metadata and typed jobs**

  Metadata includes month, objectKey, currency, amountDue, service/account counts, SHA-256, parser ID/version, uploadedAt. Invoice jobs include `documentType: 'AWS_INVOICE'`, workspace owner, state, force, dates, error code, and month conflict only.

- [ ] **Step 3: Implement list/get/put/delete/query helpers**

  Use consistent reads for one record, paginated reverse chronological queries for history, condition expressions for ownership, and metadata deletion only after S3 deletion succeeds.

- [ ] **Step 4: Write and implement aggregations**

  Calculate six KPIs, service totals/percentages, top services, tax composition, masked account allocations, monthly trend, and detail rows. Sort deterministic ties by normalized label.

- [ ] **Step 5: Export and run tests**

  Add `"./aws-invoice-aggregations": "./src/aws-invoice-aggregations.ts"`.

  Run: `pnpm test lib/__tests__/aws-invoice-aggregations.test.ts backend/__tests__/aws-invoice-metadata.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit persistence contracts**

  ```bash
  git add backend/shared/storage.ts backend/shared/metadata.ts packages/domain/src/aws-invoice-aggregations.ts packages/domain/package.json lib/__tests__/aws-invoice-aggregations.test.ts backend/__tests__/aws-invoice-metadata.test.ts
  git commit -m "feat(invoices): add monthly invoice storage and aggregates"
  ```

### Task 6: Implement invoice upload/status/list/get/delete/dashboard APIs

- **GOAL-3206**: Expose the complete owned invoice HTTP surface without PDF bytes crossing API Gateway.

**Files:**

- Create: `backend/functions/aws-invoices-api/handler.ts`
- Create: `backend/__tests__/aws-invoices-api.test.ts`
- Modify: `frontend/api/contracts.ts`
- Modify: `scripts/local/handlers.ts`
- Modify: `scripts/dev-server.ts`

**Interfaces:**

- Handles all `/aws/invoices` routes except summaries.
- Presigns only `uploads/aws-invoices/primary/{jobId}.pdf` for five minutes.

- [ ] **Step 1: Write failing upload tests**

  Cover scope, workspace owner, PDF content type, 5 MiB size, SHA-256, generated job ID, exact S3 prefix, no returned bucket/key, force flag, and job TTL.

- [ ] **Step 2: Write failing status/list/get/delete/dashboard tests**

  Cover owned success, foreign job/record, invalid month, missing record, pagination cursor validation, S3 schema validation, delete ordering, historical trend, and response privacy scan.

- [ ] **Step 3: Implement route dispatch and injected adapters**

  Authorize before parsing owner-specific paths. Return exact typed envelopes. Delete S3 object first, metadata second; a failed S3 delete leaves metadata intact.

- [ ] **Step 4: Implement local API/storage paths**

  Route invoice upload PUTs to the invoice processor only when the key starts `uploads/aws-invoices/primary/`. Provide synthetic, non-private sample data for UI development.

- [ ] **Step 5: Add frontend response contracts**

  Re-export domain schemas and define presign/list/detail/dashboard envelopes. Reject unknown response fields where they could reveal storage keys.

- [ ] **Step 6: Run tests and commit**

  Run: `pnpm test backend/__tests__/aws-invoices-api.test.ts frontend/__tests__/api-client.test.ts`

  ```bash
  git add backend/functions/aws-invoices-api backend/__tests__/aws-invoices-api.test.ts frontend/api/contracts.ts scripts/local/handlers.ts scripts/dev-server.ts
  git commit -m "feat(invoices): expose AWS invoice APIs"
  ```

### Task 7: Implement the isolated invoice parser worker

- **GOAL-3207**: Process invoice jobs idempotently without affecting bank parser throughput or data.

**Files:**

- Create: `backend/functions/invoice-parser-worker/process-job.ts`
- Create: `backend/functions/invoice-parser-worker/handler.ts`
- Create: `backend/__tests__/invoice-parser-worker.test.ts`

**Interfaces:**

- Consumes S3 notification for `uploads/aws-invoices/primary/{jobId}.pdf` only.
- Writes `AwsInvoiceSchema` JSON then metadata and terminal job state.

- [ ] **Step 1: Write failing path/job/idempotency tests**

  Reject bank upload prefixes, malformed workspace/job IDs, missing/wrong document type, foreign owner, duplicate worker claim, checksum mismatch, and already-terminal delivery.

- [ ] **Step 2: Write failing parser-outcome tests**

  Map unsupported layout, total mismatch, invalid PDF, schema failure, and unexpected retryable S3/DynamoDB failures to the exact terminal/retry behavior. Sanitized error records must contain codes only.

- [ ] **Step 3: Implement deterministic processing order**

  Transition/claim idempotency, download, PDF magic, checksum, parse, schema validate, derive month/key, conflict, write JSON, write metadata, mark success, delete raw PDF.

- [ ] **Step 4: Preserve retry safety**

  Do not delete the PDF after retryable destination/metadata/job-state failures. On retry, validate an existing identical destination by SHA-256/parser version before continuing.

- [ ] **Step 5: Implement SQS partial batch response**

  Process records sequentially at batch size one and return only retryable message IDs. Unsupported/mismatch/invalid documents are terminal job failures and successful SQS records.

- [ ] **Step 6: Run tests and commit**

  Run: `pnpm test backend/__tests__/invoice-parser-worker.test.ts`

  ```bash
  git add backend/functions/invoice-parser-worker backend/__tests__/invoice-parser-worker.test.ts
  git commit -m "feat(invoices): process invoice uploads asynchronously"
  ```

### Task 8: Build the aggregate-only Gemini summary boundary

- **GOAL-3208**: Generate useful invoice insight without transmitting invoice/account identity.

**Files:**

- Create: `packages/domain/src/aws-invoice-summary-payload.ts`
- Modify: `packages/domain/package.json`
- Create: `lib/__tests__/aws-invoice-summary-payload.test.ts`
- Create: `backend/functions/aws-invoice-summary-api/prompt.ts`
- Create: `backend/functions/aws-invoice-summary-api/handler.ts`
- Create: `backend/__tests__/aws-invoice-summary-api.test.ts`

**Interfaces:**

- Produces: `buildAwsInvoiceSummaryPayload(invoice, history)`.
- Handles: `POST /aws/invoices/summaries` with selected month only; backend loads owned invoice/history rather than trusting client aggregates.

- [ ] **Step 1: Write a recursive privacy-failure test**

  Seed the source object with sentinel strings in every prohibited field and assert serialized payload/prompt excludes all sentinels, account last four, source SHA-256, object keys, and raw descriptions.

- [ ] **Step 2: Implement the exact aggregate payload**

  Include month/currency, totals, month-over-month delta, top five services with amount/percentage, account allocation percentages without identifiers, and tax ratio.

- [ ] **Step 3: Implement prompt construction**

  Ask for concise cost drivers, unusual changes, tax context, and actionable review questions. State that inputs are aggregates and prohibit invented causes/resources/accounts.

- [ ] **Step 4: Implement authenticated summary handler**

  Parse `{ yearMonth }`, authorize workspace, load and validate invoice/history from storage, build payload, get Gemini key from the existing SSM parameter, and use the existing buffered text-response pattern with rate-limit/upstream mapping.

- [ ] **Step 5: Run tests and commit**

  Run: `pnpm test lib/__tests__/aws-invoice-summary-payload.test.ts backend/__tests__/aws-invoice-summary-api.test.ts`

  ```bash
  git add packages/domain/src/aws-invoice-summary-payload.ts packages/domain/package.json lib/__tests__/aws-invoice-summary-payload.test.ts backend/functions/aws-invoice-summary-api backend/__tests__/aws-invoice-summary-api.test.ts
  git commit -m "feat(invoices): add privacy-safe AI invoice summaries"
  ```

### Task 9: Provision invoice queues, workers, APIs, IAM, and alarms

- **GOAL-3209**: Deploy an isolated least-privilege invoice backend.

**Files:**

- Modify: `terraform/data.tf`
- Modify: `terraform/compute.tf`
- Modify: `terraform/api-openapi.yaml.tftpl`
- Modify: `terraform/api.tf`
- Modify: `terraform/monitoring.tf`
- Modify: `terraform/outputs.tf`
- Modify: `terraform/tests/data_compute.tftest.hcl`
- Modify: `terraform/tests/auth_api_edge.tftest.hcl`

**Interfaces:**

- Produces Lambdas `cashight-aws-invoices-api`, `cashight-invoice-parser-worker`, `cashight-aws-invoice-summary-api` with live aliases.
- Produces SQS `cashight-invoice-parse` and DLQ with S3 notification prefix isolation.

- [ ] **Step 1: Write failing Terraform tests**

  Assert separate queue/DLQ, maxReceiveCount 3, batch size 1, partial batch response, worker visibility timeout greater than Lambda timeout, exact S3 prefixes, exact DynamoDB actions, Gemini parameter only on summary Lambda, and no Cost Explorer permission.

- [ ] **Step 2: Add S3 notification and queue policy**

  Add a second notification entry for prefix `uploads/aws-invoices/` and suffix `.pdf`. Keep the existing bank prefix routed only to the bank queue.

- [ ] **Step 3: Add API Lambda resources**

  Configure Node.js 22, 512 MiB, 30-second timeout, `TABLE_NAME`, upload/statements bucket names, active tracing, 30-day logs, live alias, and exact upload/statements prefix permissions.

- [ ] **Step 4: Add parser worker resources**

  Configure Node.js 22, 2048 MiB, 300-second timeout, reserved concurrency 1, SQS receive/delete, invoice upload read/delete, invoice JSON read/write, DynamoDB job/metadata, and no PDF password/Gemini/Cost Explorer permissions.

- [ ] **Step 5: Add summary Lambda resources**

  Configure Node.js 22, 512 MiB, 60-second timeout, statement invoice-prefix read, DynamoDB read, Gemini SSM read/decrypt, no upload write/delete, and no Cost Explorer permissions.

- [ ] **Step 6: Add OpenAPI routes and permissions**

  Define exact read/write scopes and CORS for upload/status/list/get/delete/dashboard/summary routes. Keep summary on the repository's existing buffered Lambda proxy response contract.

- [ ] **Step 7: Add alarms**

  Cover API/summary errors, parser errors/duration/throttles, total mismatch metric, queue age, DLQ depth, and missing invocations. Dimensions contain function/error code only.

- [ ] **Step 8: Run infrastructure checks and commit**

  Run: `cd terraform && terraform fmt -check -recursive && terraform validate && terraform test`

  Run: `tflint --recursive`

  Run: `uvx checkov -d terraform`

  ```bash
  git add terraform
  git commit -m "infra(invoices): provision AWS invoice pipeline"
  ```

### Task 10: Extract a reusable presigned-PDF upload hook and add invoice data hooks

- **GOAL-3210**: Reuse the proven upload lifecycle without coupling bank and invoice error models.

**Files:**

- Create: `frontend/hooks/use-pdf-upload-job.ts`
- Modify: `frontend/hooks/use-upload-job.ts`
- Create: `frontend/hooks/use-aws-invoice-upload.ts`
- Create: `frontend/hooks/use-aws-invoices.ts`
- Modify: `frontend/__tests__/upload-flow.test.tsx`
- Create: `frontend/__tests__/aws-invoice-flow.test.tsx`

**Interfaces:**

- Produces generic `usePdfUploadJob({ createPath, statusPath, parseJob, mapError, labels })`.
- Preserves existing `useUploadJob()` public interface.
- Produces invoice upload and dashboard/history/delete hooks.

- [ ] **Step 1: Lock existing bank upload behavior with regression tests**

  Assert current endpoint paths, SHA-256, plain presigned PUT without Authorization, polling cadence, conflict force, error mapping, cancellation, and toast labels before refactoring.

- [ ] **Step 2: Extract the generic internal state machine**

  Parameterize endpoints, job parser, conflict payload, error mapper, and user-facing labels. Keep hashing, generation cancellation, timeout, and plain S3 PUT shared.

- [ ] **Step 3: Rebuild `useUploadJob()` as a wrapper**

  Ensure all existing tests pass without changing component callers.

- [ ] **Step 4: Add invoice upload wrapper tests/implementation**

  Use `/aws/invoices/uploads`, invoice job schema, month-only conflict, invoice error text, and success label `Invoice saved`.

- [ ] **Step 5: Add invoice query hooks**

  Load selected detail/dashboard and history concurrently with AbortController, parse contracts, preserve previous successful data during delete errors, and invalidate the selected month after upload/delete.

- [ ] **Step 6: Run tests and commit**

  Run: `pnpm test frontend/__tests__/upload-flow.test.tsx frontend/__tests__/aws-invoice-flow.test.tsx`

  ```bash
  git add frontend/hooks frontend/__tests__
  git commit -m "refactor(upload): share the presigned PDF workflow"
  ```

### Task 11: Build invoice upload, KPIs, charts, table, and history components

- **GOAL-3211**: Render every approved invoice visualization responsively and privately.

**Files:**

- Create: `app/components/aws-invoices/aws-invoice-upload.tsx`
- Create: `app/components/aws-invoices/invoice-kpi-cards.tsx`
- Create: `app/components/aws-invoices/invoice-service-pie.tsx`
- Create: `app/components/aws-invoices/invoice-top-services.tsx`
- Create: `app/components/aws-invoices/invoice-tax-composition.tsx`
- Create: `app/components/aws-invoices/invoice-account-allocation.tsx`
- Create: `app/components/aws-invoices/invoice-monthly-trend.tsx`
- Create: `app/components/aws-invoices/invoice-services-table.tsx`
- Create: `app/components/aws-invoices/invoice-history.tsx`
- Create: `app/__tests__/aws-invoice-components.test.tsx`

**Interfaces:**

- Consumes only `AwsInvoiceDashboard` and typed callbacks; components do not parse API or raw invoice data.

- [ ] **Step 1: Write failing KPI/chart/table tests**

  Assert six KPIs, exact chart labels/values, zero/empty states, masked account labels `•••• 1234`, deterministic service ordering, accessible chart summaries, table sorting/pagination, and no prohibited identifiers in `document.body.textContent` or aria attributes.

- [ ] **Step 2: Implement upload and conflict UI**

  Use PDF-only 5 MiB dropzone, progress labels, exact invoice errors, month replacement dialog, and statement-upload visual conventions with AWS-specific copy.

- [ ] **Step 3: Implement KPI and chart components**

  Reuse Card, chart colors, tooltip, Recharts, and number formatting patterns. Use currency from the invoice and prevent chart overlap at mobile widths.

- [ ] **Step 4: Implement detail/history tables**

  Use existing Table/Pagination/AlertDialog patterns. History shows month, total, tax, service count, account count, uploaded date, view, and delete—never invoice ID or full account.

- [ ] **Step 5: Run component tests and commit**

  Run: `pnpm test app/__tests__/aws-invoice-components.test.tsx`

  ```bash
  git add app/components/aws-invoices app/__tests__/aws-invoice-components.test.tsx
  git commit -m "feat(invoices): add invoice charts and history components"
  ```

### Task 12: Compose the month-driven page and AI summary card

- **GOAL-3212**: Deliver the complete protected invoice dashboard route.

**Files:**

- Create: `app/aws/billing-invoice/page.tsx`
- Create: `app/components/aws-invoices/aws-invoice-dashboard.tsx`
- Create: `app/components/aws-invoices/aws-invoice-ai-summary.tsx`
- Create: `app/__tests__/aws-invoice-dashboard.test.tsx`
- Modify: `app/loading.tsx`
- Modify: `app/globals.css`

**Interfaces:**

- URL state: `?year=YYYY&month=M`; missing parameters select the latest invoice or current month when none exist.
- Summary request body: `{ yearMonth: 'YYYY-MM' }` only.

- [ ] **Step 1: Write failing period/state tests**

  Cover valid URL, malformed fallback, latest-invoice default, previous/next month, upload refresh, history selection, delete navigation, no invoice, loading, API error, parse failure, and responsive panel order.

- [ ] **Step 2: Write failing AI-card tests**

  Verify idle click-to-generate, `{ yearMonth }` body only, loading text, buffered/stream-compatible response read, rate-limit/upstream errors, abort on month change, per-month in-memory cache, and no auto-fetch.

- [ ] **Step 3: Implement page composition**

  Use `ProtectedRoute` and Suspense. Order: header/period/upload, KPI grid, AI card, monthly trend, service/account/tax charts, service table, history. Use the existing RevealPanel pattern without hiding errors.

- [ ] **Step 4: Implement empty/error/loading boundaries**

  Empty month offers upload and history selection. Unsupported/mismatch jobs remain in upload UI and never create a dashboard record. Preserve last valid data during retryable refresh.

- [ ] **Step 5: Run component and static build tests**

  Run: `pnpm test app/__tests__/aws-invoice-dashboard.test.tsx`

  Run: `pnpm build`

  Expected: PASS and `out/aws/billing-invoice/index.html` exists.

- [ ] **Step 6: Commit the route**

  ```bash
  git add app/aws/billing-invoice app/components/aws-invoices app/__tests__/aws-invoice-dashboard.test.tsx app/loading.tsx app/globals.css
  git commit -m "feat(invoices): add monthly AWS invoice dashboard"
  ```

### Task 13: Add end-to-end, privacy, operations, and production verification

- **GOAL-3213**: Prove the invoice feature is correct and private before enabling it.

**Files:**

- Create: `tests/e2e/aws-billing-invoice.spec.ts`
- Create: `docs/runbooks/aws-invoice-processing.md`
- Modify: `scripts/security-scan-logs.ts`
- Modify: `scripts/smoke-serverless.mjs`
- Modify: `.env.example`

**Interfaces:**

- Adds `NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE` default `false`.
- Adds `AWS_INVOICE_FIXTURE` documentation for local verification only.

- [ ] **Step 1: Add mocked browser workflow**

  Exercise upload/hash/presign/PUT/poll, conflict/cancel/force, success refresh, month navigation, all charts/table/history, delete, AI summary, mobile layout, keyboard controls, and loading/error states.

- [ ] **Step 2: Add unsupported and mismatch workflow tests**

  Mock terminal jobs and assert no dashboard request returns an invoice for the failed month and no extracted text appears in the page.

- [ ] **Step 3: Extend privacy scanning**

  Add patterns for 12-digit AWS account IDs, invoice-number labels, bill-to/address headings, presigned invoice URLs, and prohibited payload keys. Scan build output, test output, and captured logs without scanning the private source fixture.

- [ ] **Step 4: Add serverless smoke coverage**

  Use a synthetic non-private PDF fixture deployed only to the smoke environment. Verify job success, monthly dashboard schema, masked account IDs, delete, and absence of prohibited keys. Do not upload the user's PDF in CI.

- [ ] **Step 5: Write operator runbook**

  Document supported markers, local private fixture command, sanitized expected output, upload/job lifecycle, conflict/force, S3 version recovery, queue/DLQ redrive, mismatch investigation without logging content, feature flag, rollback, and adding future parser variants.

- [ ] **Step 6: Run full verification**

  Run: `pnpm lint`

  Run: `pnpm tsc --noEmit`

  Run: `pnpm test`

  Run: `pnpm build`

  Run: `pnpm test:e2e -- tests/e2e/aws-billing-invoice.spec.ts`

  Run: `pnpm security:scan-logs`

  Run: `cd terraform && terraform fmt -check -recursive && terraform validate && terraform test`

  Expected: all commands PASS and the private PDF remains untracked.

- [ ] **Step 7: Commit verification assets**

  ```bash
  git add tests/e2e/aws-billing-invoice.spec.ts docs/runbooks/aws-invoice-processing.md scripts/security-scan-logs.ts scripts/smoke-serverless.mjs .env.example
  git commit -m "test(invoices): verify invoice privacy and workflows"
  ```

## 4. Alternatives

- **ALT-3201**: Add AWS invoice detection to the bank parser registry and queue. Rejected because invoice and bank documents have different schemas, error models, permissions, throughput, and privacy boundaries.
- **ALT-3202**: Parse only plain `pdf-parse` text. Rejected because multi-page tables and linked-account sections require positional row boundaries for deterministic reconciliation.
- **ALT-3203**: Commit the user's PDF as a regression fixture. Rejected because it contains private billing identity/account information.
- **ALT-3204**: Store raw extracted text for future reprocessing. Rejected because it expands privacy risk and is unnecessary once validated aggregates exist.

## 5. Dependencies

- **DEP-3201**: Completed Step 30 workspace ownership and nested navigation.
- **DEP-3202**: User-supplied local known-layout PDF for manual verification only.
- **DEP-3203**: Existing upload bucket, statement bucket versioning, DynamoDB table, SQS patterns, parser worker build support, Gemini parameter, and chart/UI primitives.
- **DEP-3204**: Existing DOM polyfill and `pdf.worker.mjs` source under `node_modules/pdfjs-dist/legacy/build/`.

## 6. Files

- **FILE-3201**: Invoice domain/parser/aggregation/privacy helpers under `packages/domain/src/`.
- **FILE-3202**: Invoice APIs/workers/summary under `backend/functions/`.
- **FILE-3203**: Invoice frontend hooks/page/components under `frontend/` and `app/`.
- **FILE-3204**: Invoice queues/Lambdas/API/IAM/alarms under `terraform/`.
- **FILE-3205**: Local/private verification, E2E tests, log scanner, and runbook under `scripts/`, `tests/`, and `docs/`.

## 7. Testing

- **TEST-3201**: Field/parser tests cover every known section, page continuation, amount/date conversion, scrubbing, and fail-closed marker.
- **TEST-3202**: Reconciliation tests cover service, linked account, consolidated, credit, tax, and amount-due mismatches in integer cents.
- **TEST-3203**: Worker/API tests cover ownership, idempotency, checksum, conflict/force, S3/DynamoDB ordering, retry, queue isolation, and privacy.
- **TEST-3204**: Summary tests prove prohibited data cannot cross the Gemini boundary.
- **TEST-3205**: Component/browser tests cover upload, month/history, every chart/table, delete, AI, responsive behavior, and privacy scans.
- **TEST-3206**: Terraform tests prove prefix isolation, exact IAM, worker artifact, DLQ, alarms, and secret separation.

## 8. Risks & Assumptions

- **RISK-3201**: AWS changes invoice layout. Mitigation: strict markers, parser ID/version, explicit unsupported error, and an extensible registry.
- **RISK-3202**: Repeated headers/footers are mistaken for data. Mitigation: coordinate section state machine, exact footer markers, page-boundary fixtures, and total reconciliation.
- **RISK-3203**: PII leaks through labels/errors/tests. Mitigation: parser-boundary scrubbing, strict schemas, recursive prohibited-key/sentinel tests, and log scanning.
- **RISK-3204**: Destination write succeeds before metadata/job failure. Mitigation: idempotent retry validates identical destination hash/parser version before continuing.
- **ASSUMPTION-3201**: The initial supported invoice is unencrypted, USD, consolidated, and issued by Amazon Web Services, Inc.
- **ASSUMPTION-3202**: One current consolidated invoice per workspace/month is sufficient; S3 versions provide recovery history.

## 9. Completion Criteria

- Every requirement REQ-3201 through REQ-3208 has automated coverage.
- The known local sample parses all pages, validates, reconciles, and passes the prohibited-field scan without entering Git.
- Unsupported layouts and mismatches write no invoice JSON or metadata.
- Bank and invoice S3 notifications reach separate queues/workers.
- The persisted/API model contains no bill-to data, invoice IDs, full account IDs, labels, contact text, or raw lines.
- All approved invoice KPIs/charts/table/history/upload/delete/AI states render responsively.
- Gemini receives only the aggregate payload defined in Task 8.
- `out/aws/billing-invoice/index.html` builds successfully.
- All application, browser, security, infrastructure, and private-fixture checks pass before enabling the feature flag.

## 10. Related Specifications / Further Reading

- [Approved AWS dashboards design](../superpowers/specs/2026-08-03-aws-cost-billing-dashboards-design.md)
- [Understanding AWS bills and invoice downloads](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/getting-viewing-bill.html)
- [Existing PDF runtime constraints](../../CLAUDE.md)
