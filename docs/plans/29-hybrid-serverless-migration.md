---
goal: Migrate Cashight from Amplify-hosted Next.js SSR to a Terraform-managed static Next.js SPA and serverless AWS backend
version: 1.0
date_created: 2026-06-27
last_updated: 2026-06-27
owner: Cashight maintainer
status: 'Planned'
tags:
  - architecture
  - migration
  - terraform
  - nextjs
  - lambda
  - cognito
  - cloudfront
  - api-gateway
---

# Hybrid Serverless Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Amplify `WEB_COMPUTE` deployment with a static Next.js SPA on private S3/CloudFront and move authenticated backend logic to API Gateway, Lambda, SQS, DynamoDB, and S3 without changing Cashight's financial results or privacy guarantees.

**Architecture:** CloudFront serves immutable Next.js static exports from a private S3 origin. Cognito managed login issues PKCE tokens and federates Google; a Regional REST API validates access tokens and invokes domain-specific Lambda functions. Statement JSON remains in S3, while DynamoDB indexes statement metadata, upload jobs, authorized subjects, and idempotency state; SQS isolates PDF parsing from HTTP timeouts.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript, `oidc-client-ts`, Zod, Vitest, Playwright, AWS Lambda Node.js 22, Lambda Powertools, API Gateway REST API, Cognito, S3, SQS, DynamoDB, CloudFront, WAF, CloudWatch/X-Ray, CodeDeploy, Terraform 1.11+, AWS provider 6.x, GitHub Actions OIDC.

---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan implements the approved [hybrid serverless architecture specification](../superpowers/specs/2026-06-27-hybrid-serverless-architecture-design.md). It is intentionally staged so the existing Amplify deployment remains usable until backend parity, Cognito authentication, static hosting, DNS cutover, rollback, and production observation have all passed.

The plan is a migration contract. A phase is not complete because resources exist; it is complete only after its tests, reconciliation checks, and rollback gate pass. Do not remove Amplify, Auth.js, existing S3 keys, SSM parameters, or the confidential Cognito app client before Phase 10.

## 1. Requirements & Constraints

- **REQ-001**: Build the frontend with `next.config.ts` values `output: 'export'` and `trailingSlash: true`; production must have no Next.js server runtime.
- **REQ-002**: Host frontend artifacts in a private S3 bucket reachable only through CloudFront Origin Access Control.
- **REQ-003**: Preserve Google sign-in by configuring Google as a Cognito User Pool social identity provider.
- **REQ-004**: Use a public Cognito SPA app client with Authorization Code flow, PKCE, no client secret, and exact callback/logout URLs.
- **REQ-005**: Use Cognito access tokens for API calls. API Gateway validates tokens and required OAuth scopes before Lambda invocation.
- **REQ-006**: Move all current backend logic from Next.js route handlers and dynamic server components into Lambda functions.
- **REQ-007**: Upload PDFs directly to S3 with a five-minute presigned PUT URL; PDF bytes must never pass through API Gateway.
- **REQ-008**: Process uploaded PDFs through S3 notification, SQS, and `parser-worker`; use batch size one, partial batch responses, bounded retries, and a DLQ.
- **REQ-009**: Preserve parser output, categorization, aggregation, overwrite-conflict behavior, and UI-visible results.
- **REQ-010**: Keep statement JSON as the transaction-level source of truth in S3. DynamoDB must not store raw transaction descriptions or transaction arrays.
- **REQ-011**: Store statement metadata, upload jobs, authorized subjects, and idempotency records in one on-demand DynamoDB table.
- **REQ-012**: Migrate statement keys to `users/{sub}/statements/{cardLast4}/{year}/{year}-{mm}.json` without deleting legacy keys during the rollback window.
- **REQ-013**: Preserve streamed Gemini summaries through a Regional API Gateway REST API integration configured with `responseTransferMode: STREAM`.
- **REQ-014**: Keep `buildSummaryPayload()` as the mandatory privacy boundary before Gemini invocation.
- **REQ-015**: Manage AWS resources, IAM policies, DNS records, certificates, observability, deployment roles, and rollback resources with Terraform.
- **REQ-016**: Use separate CI, infrastructure deployment, and application deployment workflows.
- **REQ-017**: Keep Amplify available as a rollback target until seven consecutive healthy production days have elapsed after CloudFront DNS cutover.
- **SEC-001**: Mask PAN to `cardLast4` inside the parser before data leaves parser memory. Full PAN must not enter responses, storage, DynamoDB, logs, traces, metrics, or AI payloads.
- **SEC-002**: Lambda logs must exclude email, names, tokens, secrets, PDF bytes, and raw transaction descriptions.
- **SEC-003**: Cognito triggers enforce `ALLOWED_EMAIL`; API Lambdas authorize the stable Cognito `sub` against an active DynamoDB authorization record and enforce ownership.
- **SEC-004**: Derive S3 and DynamoDB partition keys from validated JWT claims and server-validated data, never from client-supplied owner identifiers or object keys.
- **SEC-005**: Validate API JSON, SQS events, S3 JSON, parser output, and Gemini input with Zod.
- **SEC-006**: Configure exact CORS origins, headers, and methods. Never use `*` with bearer-token requests.
- **SEC-007**: Encrypt frontend artifacts, PDFs, statements, DynamoDB, Lambda artifacts, logs, Secrets Manager values, and Terraform state at rest; deny insecure transport to S3.
- **SEC-008**: Use dedicated IAM roles per Lambda. IAM resources must be exact bucket prefixes, table/index ARNs, queue ARNs, log groups, and secret ARNs.
- **SEC-009**: Terraform may manage the Cognito Google IdP only after the remote-state KMS and access controls are applied because `provider_details.client_secret` is stored in Terraform state.
- **SEC-010**: Configure CloudFront and Regional API WAF ACLs with AWS managed rules, known-bad-input rules, IP reputation, request-size handling, and rate-based rules.
- **SEC-011**: Use Secrets Manager for `GEMINI_API_KEY`, `PDF_PASSWORD`, and Google OAuth secret metadata. Never commit secret values or output them from Terraform.
- **SEC-012**: Run `pnpm security:scan-logs` against exported production Lambda/API logs before decommissioning Amplify.
- **CON-001**: Application resources remain in `ap-southeast-1`; CloudFront certificate and CloudFront-scope WAF remain in `us-east-1` through the `aws.global` provider alias.
- **CON-002**: The browser upload size stays at 5 MiB. S3 enforces the exact signed content length, MIME type, and checksum headers.
- **CON-003**: The parser Lambda uses Node.js 22, includes the existing PDF DOM polyfill and `pdf.worker.mjs`, has a 120-second timeout, 1536 MiB memory, ephemeral storage of 1024 MiB, and reserved concurrency of 2.
- **CON-004**: `summary-api` uses Node.js 22, a 120-second timeout, 1024 MiB memory, and reserved concurrency of 2.
- **CON-005**: The SQS visibility timeout is 360 seconds, `maxReceiveCount` is 3, and the DLQ retention period is 14 days.
- **CON-006**: Upload objects expire after one day; upload job records expire after seven days through DynamoDB TTL.
- **CON-007**: Keep `pnpm@11.2.2` in `packageManager`.
- **CON-008**: Upgrade Terraform to `>= 1.11, < 2.0` and the HashiCorp AWS provider to `~> 6.0` as a separately reviewed state-safe change.
- **CON-009**: Do not place Lambda functions in a VPC; all required AWS services and Gemini are public service endpoints, and a VPC would add NAT cost and cold-start complexity.
- **PAT-001**: Domain code has no Next.js, browser, Lambda, or AWS SDK dependencies.
- **PAT-002**: Lambda handlers remain thin and call focused modules in `backend/shared/` and `packages/domain/`.
- **PAT-003**: Use one Lambda per bounded capability, not a catch-all router Lambda.
- **PAT-004**: Every behavior change starts with a failing focused test; every migration phase ends with parity and rollback verification.
- **PAT-005**: Use Conventional Commits and keep each commit deployable and green.

## 2. Implementation Steps

### Implementation Phase 0 — Baseline and migration safety

- GOAL-001: Capture current behavior and create gates that prevent privacy, data, and deployment regressions.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add migration runbook, current-state snapshot script, privacy regression tests, and browser smoke-test foundation. | | |

### Task 1: Baseline safety gates

**Files:**
- Create: `docs/runbooks/hybrid-serverless-migration.md`
- Create: `scripts/snapshot-current-state.ts`
- Create: `lib/__tests__/architecture-privacy.test.ts`
- Create: `playwright.config.ts`
- Create: `tests/e2e/current-production.spec.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add failing privacy-boundary tests**

  Create `lib/__tests__/architecture-privacy.test.ts` with tests that pass a full `Statement` containing sentinel values `4111111111111111`, `HUY TEST USER`, and `PRIVATE MERCHANT DESCRIPTION` through `buildSummaryPayload()` and `redactForLog()`. Assert that serialized outputs do not contain any sentinel, while totals and safe merchant aggregates remain present.

- [ ] **Step 2: Run the privacy test and record its initial result**

  Run: `pnpm test lib/__tests__/architecture-privacy.test.ts`  
  Expected: FAIL until the fixture and any required exported redaction helpers are wired correctly; no sentinel may be printed by the test runner.

- [ ] **Step 3: Implement the privacy fixture and assertions without changing production behavior**

  Reuse `StatementSchema`, `buildSummaryPayload`, `aggregate`, and `redactForLog`. Keep the fixture in test memory; do not write it to disk or log it.

- [ ] **Step 4: Add the read-only state snapshot script**

  `scripts/snapshot-current-state.ts` must call `ListObjectsV2` with pagination, validate each downloaded object with `StatementSchema`, and write only this safe JSON structure to a gitignored operator-selected path:

  ```ts
  interface StateSnapshot {
    generatedAt: string;
    bucket: string;
    objectCount: number;
    versioningStatus: string;
    statements: Array<{
      key: string;
      cardLast4: string;
      statementDate: string;
      totalSpend: number;
      transactionCount: number;
      sha256: string;
    }>;
  }
  ```

  Require `--output .migration-private/current-state.json` or another explicit path under `.migration-private/`; reject every output path outside that gitignored directory.

- [ ] **Step 5: Add Playwright without production credentials in source**

  Add `@playwright/test` as a dev dependency and scripts `test:e2e` and `test:e2e:current`. Configure `BASE_URL`, `E2E_USERNAME`, and `E2E_PASSWORD` from environment only. The initial test must verify `/signin` loads and all application deep links return non-5xx responses; authenticated scenarios use a stored state supplied through `E2E_STORAGE_STATE` and self-skip when absent.

- [ ] **Step 6: Verify and commit**

  Run:

  ```bash
  pnpm test lib/__tests__/architecture-privacy.test.ts
  pnpm lint
  pnpm tsc --noEmit
  ```

  Expected: all commands pass.  
  Commit: `test: add hybrid migration safety gates`

### Implementation Phase 1 — Extract portable domain code and Lambda build system

- GOAL-002: Make business logic reusable by the static frontend and Lambda functions without changing results in the Amplify deployment.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-002 | Create `@cashight/domain`, compatibility re-exports, and deterministic Lambda bundles including the pdfjs worker. | | |

### Task 2: Domain package and backend build

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/`
- Create: `packages/domain/src/api.ts`
- Create: `backend/tsconfig.json`
- Create: `scripts/build-lambdas.mjs`
- Create: `lib/__tests__/domain-package-parity.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `next.config.ts`
- Modify: existing `lib/*.ts`, `lib/parsers/tpbank.ts`, and their tests to import package subpaths

- [ ] **Step 1: Write a failing package-parity test**

  The test must import schemas, period parsing, aggregation, categorization, formatting, and summary-payload functions from `@cashight/domain/*` and compare their output against the current `@/lib/*` imports using the existing deterministic fixtures.

- [ ] **Step 2: Confirm the package does not exist**

  Run: `pnpm test lib/__tests__/domain-package-parity.test.ts`  
  Expected: FAIL with unresolved `@cashight/domain` imports.

- [ ] **Step 3: Create the workspace package**

  Add `packages: ['packages/*']` to `pnpm-workspace.yaml`. Define explicit package exports for `./schemas`, `./api`, `./period`, `./aggregations`, `./categorize`, `./format`, `./summary-payload`, `./security/*`, and `./parsers/tpbank`; do not create a broad barrel export that can pull the PDF parser into the browser bundle.

- [ ] **Step 4: Move pure modules and preserve compatibility**

  Move the implementation of these files into `packages/domain/src/`: `schemas.ts`, `period.ts`, `aggregations.ts`, `dashboard-aggregations.ts`, `categorize.ts`, `format.ts`, `summary-payload.ts`, `upload-error.ts`, `security/logging.ts`, `security/upload.ts`, `pdf-dom-polyfill.ts`, and `parsers/tpbank.ts`. Replace the original `lib/` files with explicit re-exports so the current app remains buildable during migration.

- [ ] **Step 5: Define shared API schemas**

  Add these discriminated and validated models to `packages/domain/src/api.ts`:

  ```ts
  export const UploadJobStateSchema = z.enum([
    'PENDING_UPLOAD',
    'PROCESSING',
    'CONFLICT',
    'SUCCEEDED',
    'FAILED',
  ]);

  export const CreateUploadRequestSchema = z.object({
    fileName: z.string().min(1).max(255),
    contentType: z.literal('application/pdf'),
    size: z.number().int().positive().max(5 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    force: z.boolean().default(false),
  });

  export const UploadJobSchema = z.object({
    jobId: z.string().uuid(),
    state: UploadJobStateSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    errorCode: z.string().optional(),
    statementId: z.string().optional(),
    conflict: z.object({
      cardLast4: z.string().regex(/^\d{4}$/),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
    }).optional(),
  });
  ```

- [ ] **Step 6: Add deterministic Lambda bundling**

  `scripts/build-lambdas.mjs` must discover `backend/functions/*/handler.ts`, bundle each entry with esbuild for `platform: 'node'`, `target: 'node22'`, `format: 'cjs'`, include source maps, and write `dist/lambdas/${functionName}/index.js`. For `parser-worker`, copy `node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs` to the same artifact directory and fail if it is absent.

- [ ] **Step 7: Verify production compatibility**

  Run:

  ```bash
  pnpm test
  pnpm lint
  pnpm tsc --noEmit
  pnpm build
  pnpm run build:lambdas
  ```

  Expected: current Amplify build and all tests pass; each Lambda artifact directory exists; parser artifact contains `pdf.worker.mjs`.  
  Commit: `refactor: extract portable cashight domain package`

### Implementation Phase 2 — Shared Lambda adapters and authorization

- GOAL-003: Establish one tested contract for API responses, claims, authorization, DynamoDB records, storage keys, secrets, and redacted observability.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-003 | Implement and test backend shared adapters and the Cognito auth-guard function. | | |

### Task 3: Backend shared layer and auth guard

**Files:**
- Create: `backend/shared/api-response.ts`
- Create: `backend/shared/auth-claims.ts`
- Create: `backend/shared/clients.ts`
- Create: `backend/shared/config.ts`
- Create: `backend/shared/metadata.ts`
- Create: `backend/shared/storage.ts`
- Create: `backend/shared/secrets.ts`
- Create: `backend/shared/observability.ts`
- Create: `backend/functions/auth-guard/handler.ts`
- Create: `backend/__tests__/shared.test.ts`
- Create: `backend/__tests__/auth-guard.test.ts`

- [ ] **Step 1: Write failing shared-adapter tests**

  Cover missing `sub`, wrong `token_use`, inactive authorization record, mismatched owner, malformed DynamoDB item, invalid S3 JSON, safe error serialization, and key traversal attempts. Use dependency injection for AWS clients; tests must not call AWS.

- [ ] **Step 2: Define exact shared records and key functions**

  Implement these interfaces and pure key builders:

  ```ts
  interface AuthorizedUserRecord {
    PK: `AUTHZ#${string}`;
    SK: 'PROFILE';
    active: true;
    createdAt: string;
    updatedAt: string;
  }

  interface StatementMetadataRecord {
    PK: `USER#${string}`;
    SK: `STATEMENT#${string}#${string}`;
    statementId: string;
    objectKey: string;
    cardLast4: string;
    statementDate: string;
    totalSpend: number;
    transactionCount: number;
    sha256: string;
    uploadedAt: string;
  }

  export function statementObjectKey(
    sub: string,
    cardLast4: string,
    year: number,
    month: number,
  ): string;

  export function statementId(
    cardLast4: string,
    year: number,
    month: number,
  ): string;
  ```

  `statementId()` returns `${year}-${mm}-${cardLast4}`. `statementObjectKey()` returns `users/${sub}/statements/${cardLast4}/${year}/${year}-${mm}.json` after strict validation.

- [ ] **Step 3: Implement access-token claim extraction**

  Read claims from `event.requestContext.authorizer.claims`. Require non-empty `sub`, `token_use === 'access'`, and a scope containing the route's required `cashight/read` or `cashight/write` value. Query `AUTHZ#{sub}/PROFILE`; return 403 if it is absent or inactive.

- [ ] **Step 4: Implement standard responses**

  Use the shape below for every non-streaming error:

  ```ts
  interface ApiErrorBody {
    error: {
      code: string;
      message: string;
      requestId: string;
    };
  }
  ```

  Set `content-type: application/json`, never reflect arbitrary exception text, and map Zod errors to `INVALID_REQUEST` without returning field values.

- [ ] **Step 5: Implement the Cognito trigger**

  `auth-guard` handles `PreSignUp_ExternalProvider` and pre-token-generation events. Normalize email with `trim().toLowerCase()`, require `email_verified === 'true'`, compare with normalized `ALLOWED_EMAIL`, throw `AccessDenied` on mismatch, and upsert `AUTHZ#{sub}/PROFILE` only during pre-token generation. Do not persist the email.

- [ ] **Step 6: Verify**

  Run: `pnpm test backend/__tests__/shared.test.ts backend/__tests__/auth-guard.test.ts && pnpm tsc --noEmit && pnpm run build:lambdas`  
  Expected: tests pass and `dist/lambdas/auth-guard/index.js` exists.  
  Commit: `feat(backend): add shared lambda adapters and auth guard`

### Implementation Phase 3 — Asynchronous upload and parsing

- GOAL-004: Replace synchronous `/api/parse` behavior with direct S3 upload, durable job state, idempotent SQS parsing, conflict handling, and safe retries.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Implement `uploads-api`, `upload-status-api`, and `parser-worker` with focused tests and parity checks. | | |

### Task 4: Upload APIs and parser worker

**Files:**
- Create: `backend/functions/uploads-api/handler.ts`
- Create: `backend/functions/upload-status-api/handler.ts`
- Create: `backend/functions/parser-worker/handler.ts`
- Create: `backend/functions/parser-worker/process-job.ts`
- Create: `backend/__tests__/uploads-api.test.ts`
- Create: `backend/__tests__/upload-status-api.test.ts`
- Create: `backend/__tests__/parser-worker.test.ts`
- Create: `backend/__tests__/parser-parity.test.ts`

- [ ] **Step 1: Write failing upload API tests**

  Assert rejection of invalid MIME, size over 5 MiB, invalid SHA-256, unauthorized subject, and unknown job ownership. Assert successful creation writes `PENDING_UPLOAD` with a seven-day TTL and returns `{ job, upload: { url, method: 'PUT', headers, expiresAt } }` without exposing the S3 key.

- [ ] **Step 2: Implement presigned upload creation**

  Create UUID v4 job IDs with `crypto.randomUUID()`. Sign only `uploads/{sub}/{jobId}.pdf`, `application/pdf`, exact checksum header, and five-minute expiration. Persist the `force` flag and expected checksum before returning the URL.

- [ ] **Step 3: Write failing worker tests**

  Cover success, wrong password, invalid PDF, schema failure, missing job, checksum mismatch, duplicate delivery, conflict without force, force overwrite, S3 write failure, DynamoDB update retry, and redacted logs. Assert the worker deletes the temporary PDF for all terminal outcomes and retains it only while a retryable failure remains.

- [ ] **Step 4: Implement idempotent worker transitions**

  Use DynamoDB conditional expressions:

  - `PENDING_UPLOAD -> PROCESSING` only when the checksum and owner match.
  - Create `JOB#{jobId}/CHECKSUM#{sha256}` with `attribute_not_exists(PK)`.
  - Duplicate completed messages return success without another S3 write.
  - `PROCESSING -> SUCCEEDED|CONFLICT|FAILED` records only safe codes and timestamps.

- [ ] **Step 5: Preserve parser and overwrite semantics**

  Retrieve `PDF_PASSWORD` from Secrets Manager, download the PDF, validate magic bytes and size again, call `parseTPBankStatement()`, then call `StatementSchema.parse()`. Check the deterministic destination with `HeadObject`; if it exists and `force` is false, mark `CONFLICT`. Otherwise write JSON and metadata, relying on existing statement-bucket versioning for recovery.

- [ ] **Step 6: Implement partial-batch behavior**

  Return `{ batchItemFailures: [{ itemIdentifier: messageId }] }` only for retryable infrastructure failures. Invalid PDFs and business conflicts are terminal job outcomes and must not be retried.

- [ ] **Step 7: Verify parser parity**

  Run:

  ```bash
  pnpm test backend/__tests__/uploads-api.test.ts backend/__tests__/upload-status-api.test.ts backend/__tests__/parser-worker.test.ts backend/__tests__/parser-parity.test.ts
  pnpm tsx scripts/test-parser.ts
  pnpm run build:lambdas
  ```

  Expected: tests pass; local parser fixture output matches existing documented values; all three artifacts exist.  
  Commit: `feat(upload): add asynchronous lambda parsing pipeline`

### Implementation Phase 4 — Statement, dashboard, and AI APIs

- GOAL-005: Reproduce current read, delete, aggregation, and streaming summary behavior behind authenticated Lambda APIs.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Implement statements and dashboard APIs with pagination, ownership, Zod validation, and output parity. | | |
| TASK-006 | Implement the Gemini response-streaming Lambda while preserving the anonymized payload boundary. | | |

### Task 5: Statements and dashboard APIs

**Files:**
- Create: `backend/functions/statements-api/handler.ts`
- Create: `backend/functions/dashboard-api/handler.ts`
- Create: `backend/__tests__/statements-api.test.ts`
- Create: `backend/__tests__/dashboard-api.test.ts`

- [ ] **Step 1: Write failing API tests**

  Cover cursor pagination, year/month filtering, invalid statement IDs, cross-user access, invalid S3 JSON, idempotent delete, partial delete failure, invalid period parameters, empty period, and exact `AggregatedView` parity.

- [ ] **Step 2: Implement metadata queries**

  Query `PK = USER#{sub}` with `begins_with(SK, 'STATEMENT#')`, a maximum page size of 50, and base64url-encoded `LastEvaluatedKey` cursors validated by Zod. Never scan the table.

- [ ] **Step 3: Implement read and delete ownership**

  Resolve `statementId` through the caller's metadata partition. Read and validate its S3 object. Delete S3 first, then metadata; treat missing S3 objects and missing metadata as successful idempotent deletion only when neither belongs to another user.

- [ ] **Step 4: Implement period aggregation**

  Validate query parameters with the existing period model, query only metadata in the requested year/month range, fetch matching S3 objects with bounded concurrency of 5, validate each with `StatementSchema`, and call `aggregate()`.

- [ ] **Step 5: Verify**

  Run: `pnpm test backend/__tests__/statements-api.test.ts backend/__tests__/dashboard-api.test.ts && pnpm run build:lambdas`  
  Expected: all tests pass and results match current aggregation fixtures.  
  Commit: `feat(api): add statements and dashboard lambdas`

### Task 6: Streaming summary API

**Files:**
- Create: `backend/functions/summary-api/handler.ts`
- Create: `backend/functions/summary-api/prompt.ts`
- Create: `backend/__tests__/summary-api.test.ts`
- Modify: `packages/domain/src/summary-payload.ts`

- [ ] **Step 1: Write failing streaming/privacy tests**

  Assert invalid aggregates return 400 before streaming, missing authorization returns 403, missing secret returns 503, Gemini quota errors before headers return 429, and prompt capture contains totals/top categories/top merchants but no sentinel PII or full transaction descriptions.

- [ ] **Step 2: Implement Lambda response streaming**

  Export a Node.js streaming handler through `awslambda.streamifyResponse`. Write API Gateway streaming metadata, the eight-null-byte delimiter, and UTF-8 chunks. Obtain the Gemini key from Secrets Manager and keep the current first-chunk error classification before committing 200 headers.

- [ ] **Step 3: Preserve current summary behavior**

  Reuse `AggregatedViewSchema`, `buildSummaryPayload()`, existing period instructions, `gemini-2.5-flash`, and the existing user-facing error messages. Add correlation IDs only to logs and error bodies, never to prompts.

- [ ] **Step 4: Verify**

  Run: `pnpm test backend/__tests__/summary-api.test.ts lib/__tests__/summary-payload.test.ts && pnpm run build:lambdas`  
  Expected: tests pass and `dist/lambdas/summary-api/index.js` exists.  
  Commit: `feat(ai): stream privacy-safe summaries from lambda`

### Implementation Phase 5 — Cognito SPA authentication and static frontend

- GOAL-006: Replace Auth.js/server rendering with client-side Cognito PKCE, typed API data loading, direct S3 upload, and static export without changing the UI design.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Add OIDC session management, callback, protected-route shell, and authenticated API client. | | |
| TASK-008 | Convert dashboard, statements, upload, summary, and navigation flows to static client routes. | | |
| TASK-009 | Enable static export and prove all deep links and browser flows work from a static server. | | |

### Task 7: Browser auth and API client

**Files:**
- Create: `frontend/auth/config.ts`
- Create: `frontend/auth/oidc.ts`
- Create: `frontend/auth/auth-provider.tsx`
- Create: `frontend/auth/protected-route.tsx`
- Create: `frontend/api/client.ts`
- Create: `frontend/api/contracts.ts`
- Create: `frontend/__tests__/auth-provider.test.tsx`
- Create: `frontend/__tests__/api-client.test.ts`
- Create: `app/auth/callback/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/signin/page.tsx`
- Modify: `package.json`

- [ ] **Step 1: Write failing browser auth tests**

  Use jsdom tests to cover unauthenticated redirect, callback success/failure, expired-token renewal, session restore from `sessionStorage`, logout, API 401 handling, and prevention of tokens being sent to non-API origins.

- [ ] **Step 2: Add OIDC configuration validation**

  Require these build-time public values and fail the build when any is absent:

  ```ts
  interface PublicRuntimeConfig {
    apiBaseUrl: string;
    cognitoAuthority: string;
    cognitoClientId: string;
    appOrigin: string;
  }
  ```

  Values come from `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_COGNITO_AUTHORITY`, `NEXT_PUBLIC_COGNITO_CLIENT_ID`, and `NEXT_PUBLIC_APP_ORIGIN`. Validate HTTPS in production and exact origin equality.

- [ ] **Step 3: Implement PKCE session management**

  Configure `oidc-client-ts` with `response_type: 'code'`, scopes `openid email profile cashight/read cashight/write`, `WebStorageStateStore` backed by `sessionStorage`, automatic silent renewal disabled, and explicit refresh before expiry. Never configure a client secret.

- [ ] **Step 4: Implement the API client**

  Attach `Authorization: Bearer <access_token>` only when the request URL origin equals `NEXT_PUBLIC_API_BASE_URL`. Parse standard error bodies, handle 401 by clearing the local session and redirecting to `/signin/`, and support `ReadableStream` responses for summaries.

- [ ] **Step 5: Replace sign-in and shell auth**

  The sign-in page starts Cognito managed login; include separate buttons for Cognito and Google by passing Cognito's `identity_provider=Google` authorization parameter for the Google button. `AuthProvider` supplies subject and display email to `AdminShell`; logout calls Cognito end-session and returns to `/signin/`.

- [ ] **Step 6: Verify**

  Run: `pnpm test frontend/__tests__/auth-provider.test.tsx frontend/__tests__/api-client.test.ts && pnpm lint && pnpm tsc --noEmit`  
  Expected: all tests pass.  
  Commit: `feat(auth): add cognito pkce spa session`

### Task 8: Client-side application routes

**Files:**
- Create: `frontend/hooks/use-dashboard.ts`
- Create: `frontend/hooks/use-statements.ts`
- Create: `frontend/hooks/use-upload-job.ts`
- Modify: `app/page.tsx`
- Modify: `app/statements/page.tsx`
- Modify: `app/upload/page.tsx`
- Delete after static parity: `app/upload/layout.tsx`
- Modify: `app/components/upload-dropzone.tsx`
- Modify: `app/components/ai-summary-card.tsx`
- Modify: `app/components/nav.tsx`
- Modify: `app/components/admin-shell.tsx`
- Create: `frontend/__tests__/upload-flow.test.tsx`

- [ ] **Step 1: Write failing client-flow tests**

  Cover dashboard loading/error/empty/success, statements pagination/delete, upload hashing, presigned PUT, polling transitions, conflict confirmation, force retry, terminal parser failure, and streamed summary chunks.

- [ ] **Step 2: Convert dashboard and statement pages**

  Mark runtime pages as client components, read period state from `useSearchParams()`, fetch `GET /dashboard`, and fetch paginated `GET /statements`. Preserve URL period behavior, existing cards/charts/tables, loading skeletons, pagination, and error states.

- [ ] **Step 3: Convert upload flow**

  Compute SHA-256 with `crypto.subtle.digest`, call `POST /uploads`, PUT the PDF to the presigned URL with exactly the signed headers, then poll status after 1, 2, 4, and 5 seconds repeatedly with a five-second ceiling and a two-minute client timeout. For `CONFLICT`, reuse the current confirmation dialog and create a new job with `force: true`.

- [ ] **Step 4: Convert AI summary flow**

  Replace `/api/summarize` with the typed API client pointed at `/summaries`; preserve abort, chunk decoding, period cache, retry, and UI messages.

- [ ] **Step 5: Remove server-only frontend dependencies**

  Remove imports of `auth.ts`, `lib/require-session.ts`, `lib/storage.ts`, `lib/server-secrets.ts`, Next.js `redirect()`, and server actions from files reachable by `app/`. Keep old route handlers and Auth.js files temporarily for Amplify rollback, but exclude them from the static export in Task 9 by moving them under `legacy/amplify/` in one commit.

- [ ] **Step 6: Verify UI behavior**

  Run: `pnpm test frontend/__tests__/upload-flow.test.tsx && pnpm lint && pnpm tsc --noEmit`  
  Expected: all tests pass.  
  Commit: `refactor(frontend): consume serverless api from client routes`

### Task 9: Static export

**Files:**
- Modify: `next.config.ts`
- Modify: `app/layout.tsx`
- Move: `app/api/**` to `legacy/amplify/app-api/**`
- Move: `auth.ts` to `legacy/amplify/auth.ts`
- Move: `proxy.ts` to `legacy/amplify/proxy.ts`
- Create: `scripts/verify-static-export.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add a failing static-export verifier**

  `scripts/verify-static-export.mjs` must fail unless `out/index.html`, `out/signin/index.html`, `out/auth/callback/index.html`, `out/upload/index.html`, and `out/statements/index.html` exist; it must also fail if `.next/server/app` contains runtime route-handler artifacts after the export build.

- [ ] **Step 2: Enable export mode**

  Set `output: 'export'`, `trailingSlash: true`, and `images: { unoptimized: true }`. Remove runtime `headers()` because CloudFront owns response headers. Keep `poweredByHeader: false` and PDF server packaging only in the legacy rollback build config, not the static config.

- [ ] **Step 3: Make layout deterministic at build time**

  Replace `next/font/google` with locally bundled font files or system font stacks so the build needs no Google font network request. Ensure every browser-only API is accessed inside a client component after hydration.

- [ ] **Step 4: Build and serve static output**

  Run:

  ```bash
  NEXT_PUBLIC_API_BASE_URL=https://api.cashight.nghuy.link \
  NEXT_PUBLIC_COGNITO_AUTHORITY=https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_STATICEXPORT \
  NEXT_PUBLIC_COGNITO_CLIENT_ID=static-export-verification-client \
  NEXT_PUBLIC_APP_ORIGIN=https://cashight.nghuy.link \
  pnpm build
  pnpm run verify:static
  pnpm dlx serve out -l 4173
  ```

  Expected: build and verification pass; `/`, `/signin/`, `/auth/callback/`, `/upload/`, and `/statements/` return HTML from port 4173. Stop the local static server after verification.

- [ ] **Step 5: Run browser tests against static output**

  Run: `BASE_URL=http://localhost:4173 pnpm test:e2e`  
  Expected: public/deep-link tests pass; authenticated tests self-skip without storage state.  
  Commit: `feat(frontend): build cashight as static nextjs spa`

### Implementation Phase 6 — Terraform foundation, data plane, compute, and API

- GOAL-007: Add state-safe Terraform modules for all target resources while keeping existing production resources and rollback paths intact.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Upgrade Terraform/provider, secure remote state, modularize existing retained resources with `moved` blocks, and prove a no-replacement plan. | | |
| TASK-011 | Provision DynamoDB, SQS/DLQ, upload controls, artifacts, secrets metadata, Lambda roles/functions/aliases, and observability. | | |
| TASK-012 | Provision Cognito SPA/Google federation, REST API, streaming integration, WAF, CloudFront/S3 edge, DNS, and deployment roles. | | |

### Task 10: Terraform state safety and module skeleton

**Files:**
- Create: `terraform/versions.tf`
- Create: `terraform/variables.tf`
- Create: `terraform/outputs.tf`
- Create: `terraform/moved.tf`
- Create: `terraform/modules/{auth,data,api,compute,edge,observability,cicd}/`
- Create: `terraform/state-security.tf`
- Create: `terraform/tests/state_and_modules.tftest.hcl`
- Modify: `terraform/main.tf`
- Modify: `terraform/backend.tf`
- Modify: `terraform/.terraform.lock.hcl`

- [ ] **Step 1: Back up and inspect state**

  Run:

  ```bash
  cd terraform
  terraform state pull > ../.migration-private/terraform-state-2026-06-27.json
  terraform state list > ../.migration-private/terraform-addresses-2026-06-27.txt
  terraform plan -out=../.migration-private/pre-migration.tfplan
  terraform show -json ../.migration-private/pre-migration.tfplan > ../.migration-private/pre-migration-plan.json
  ```

  Expected: no unreviewed destroy or replacement actions.

- [ ] **Step 2: Upgrade tooling in isolation**

  Set `required_version = ">= 1.11, < 2.0"` and AWS provider `version = "~> 6.0"`; run `terraform init -upgrade`, `terraform fmt -recursive`, and `terraform validate`. Commit only lockfile/provider compatibility changes after a plan shows no resource changes.

- [ ] **Step 3: Import and secure the backend bucket**

  Declare the existing `cashight-tfstate` bucket, versioning, public-access block, ownership controls, access-log destination, KMS key/alias, encryption configuration, TLS-only policy, and least-privilege bucket policy. Import existing resources instead of recreating them. Apply KMS encryption and then set `kms_key_id` in `backend.tf`; run `terraform init -reconfigure` and confirm state remains readable.

- [ ] **Step 4: Add module skeletons and exact moved blocks**

  Move retained S3 resources to `module.data`, Cognito pool/domain/legacy client to `module.auth`, SNS resources to `module.observability`, GitHub deploy role to `module.cicd`, and the CloudFront WAF ACL to `module.edge`. Keep Amplify resources and their role attachments at root until decommission. Add one `moved` block per existing address; do not use `terraform state mv` for declared moves.

- [ ] **Step 5: Prove no replacement**

  Run:

  ```bash
  terraform fmt -check -recursive
  terraform validate
  terraform test
  terraform plan -detailed-exitcode
  ```

  Expected: exit 0 after only address moves; no retained resource replacement or deletion.  
  Commit: `refactor(terraform): add state-safe serverless modules`

### Task 11: Data, compute, and observability infrastructure

**Files:**
- Create: `terraform/modules/data/main.tf`
- Create: `terraform/modules/compute/main.tf`
- Create: `terraform/modules/observability/main.tf`
- Create: `terraform/lambda-artifacts.tf`
- Create: `terraform/tests/data_compute.tftest.hcl`
- Modify: `terraform/iam.tf`
- Modify: `terraform/monitoring.tf`

- [ ] **Step 1: Add Terraform tests before resources**

  Assert the DynamoDB table uses PAY_PER_REQUEST, PITR, TTL, encryption, and deletion protection; SQS has the exact visibility/redrive settings; buckets block public access and deny insecure transport; parser/summary concurrency and timeout values match constraints; each function has a dedicated role; and no policy grants `s3:*`, `dynamodb:*`, `secretsmanager:*`, or `Resource = "*"` except X-Ray actions that require it.

- [ ] **Step 2: Provision the data plane**

  Add the DynamoDB table with `PK` and `SK`, TTL attribute `expiresAtEpoch`, PITR, deletion protection, and KMS encryption. Create the dedicated upload bucket with HCL name `"cashight-uploads-${data.aws_caller_identity.current.account_id}"`; configure its lifecycle, CORS, notification, public-access block, ownership controls, KMS encryption, and TLS-only policy independently from the statement bucket.

- [ ] **Step 3: Provision SQS**

  Create standard parse queue and DLQ, SSE-KMS, 360-second visibility timeout, 14-day DLQ retention, `maxReceiveCount = 3`, and an S3 queue policy restricted by source bucket ARN/account. Configure S3 notification for `.pdf` objects under `uploads/`.

- [ ] **Step 4: Provision artifacts and secrets metadata**

  Create a versioned, private, KMS-encrypted artifact bucket. Create Secrets Manager resources named `/cashight/prod/pdf-password`, `/cashight/prod/gemini-api-key`, and `/cashight/prod/google-oauth`; do not create secret versions from committed Terraform values.

- [ ] **Step 5: Provision functions and least-privilege IAM**

  Define all seven functions, explicit log groups with 30-day retention, X-Ray, environment variables containing only resource names/ARNs and `ALLOWED_EMAIL`, aliases named `live`, CodeDeploy applications/groups, reserved concurrency, SQS event mapping with `ReportBatchItemFailures`, and Lambda invoke permissions. Use artifact object version plus SHA-256 as deployment inputs.

- [ ] **Step 6: Add dashboards and alarms**

  Add API/Lambda/SQS/DLQ/DynamoDB/CloudFront/WAF metrics, parser business metrics, stuck-job metric filter, and SNS alarm actions. Every alarm uses `treat_missing_data` deliberately and documents whether missing data is breaching.

- [ ] **Step 7: Verify**

  Run: `terraform fmt -check -recursive && terraform validate && terraform test && tflint --no-color -f compact`  
  Expected: all checks pass. Plan must contain additions and in-place policy updates only.  
  Commit: `feat(terraform): add serverless data and compute platform`

### Task 12: Auth, API, edge, and deployment infrastructure

**Files:**
- Create: `terraform/api-openapi.yaml.tftpl`
- Create: `terraform/modules/auth/main.tf`
- Create: `terraform/modules/api/main.tf`
- Create: `terraform/modules/edge/main.tf`
- Create: `terraform/modules/cicd/main.tf`
- Create: `terraform/tests/auth_api_edge.tftest.hcl`
- Modify: `terraform/cognito.tf`
- Modify: `terraform/waf.tf`
- Modify: `terraform/github-oidc.tf`

- [ ] **Step 1: Add Terraform tests before resources**

  Assert the SPA client has `generate_secret = false`, code flow only, exact callbacks/logout URLs, scopes, token revocation, and Google/Cognito providers; REST methods have Cognito authorization/scopes; CORS has one origin; streaming integration uses `/response-streaming-invocations` and `STREAM`; CloudFront uses OAC and no public S3 website endpoint; DNS initially uses a temporary hostname.

- [ ] **Step 2: Add Cognito resource server and SPA client**

  Define `cashight/read` and `cashight/write` scopes. Create the public client with callback `https://cashight.nghuy.link/auth/callback/`, temporary callback `https://${module.edge.cloudfront_domain_name}/auth/callback/`, localhost callback `http://localhost:3000/auth/callback/`, and corresponding logout URLs. Attach auth-guard triggers through `lambda_config` and grant Cognito invoke permission.

- [ ] **Step 3: Add Google federation**

  Create `aws_cognito_identity_provider.google` with scopes `openid email profile`, `email = email`, `username = sub`, and sensitive variables `google_oauth_client_id`/`google_oauth_client_secret`. Apply only through the protected production environment after KMS state encryption is active. Make the SPA client depend on the IdP.

- [ ] **Step 4: Define the REST API from OpenAPI**

  Define `/health`, `/statements`, `/statements/{statementId}`, `/dashboard`, `/uploads`, `/uploads/{jobId}`, and `/summaries`. Require `cashight/read` or `cashight/write` per method. Configure `/summaries` with `responseTransferMode: STREAM`; configure all other integrations buffered. Add exact OPTIONS responses, request validators, access logs, X-Ray, throttling, custom domain, ACM certificate, Route 53 alias, and Regional WAF.

- [ ] **Step 5: Provision static edge resources**

  Create frontend bucket, OAC, bucket policy, CloudFront Function for route-to-`index.html` mapping, cache policies, response-headers policy, certificate, distribution, logging, and temporary `next.cashight.nghuy.link` Route 53 alias. Associate the existing CloudFront WAF ACL with the new distribution while retaining Amplify protection until cutover.

- [ ] **Step 6: Expand GitHub OIDC deployment permissions**

  Restrict trust to the repository and protected `production` environment or `main` branch. Grant only artifact writes, Lambda update/publish, CodeDeploy deployment, CloudFront invalidation, S3 frontend deployment, Terraform-managed resource operations required by the workflow, and read access to Terraform state. Keep GitHub credentials short-lived.

- [ ] **Step 7: Verify plan and apply non-cutover resources**

  Run `terraform plan -out=.migration-private/hybrid-phase6.tfplan` and inspect JSON for deletes/replacements. Apply only additions and in-place updates. Verify temporary frontend and API domains, Cognito issuer, and output values.  
  Commit: `feat(terraform): add cognito api gateway and cloudfront edge`

### Implementation Phase 7 — Data migration and reconciliation

- GOAL-008: Backfill authorized ownership and metadata without mutating legacy objects, then prove new APIs return identical results.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | Implement idempotent statement migration, dry-run/reporting, checksum reconciliation, and API parity tests. | | |

### Task 13: Statement migration

**Files:**
- Create: `scripts/migrate-statements.ts`
- Create: `scripts/reconcile-statements.ts`
- Create: `scripts/__tests__/migrate-statements.test.ts`
- Create: `docs/runbooks/statement-data-migration.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing migration tests**

  Cover dry run, absent authorization record, invalid legacy object, duplicate destination with same checksum, destination checksum conflict, interrupted rerun, pagination over 1000 keys, metadata conditional write, and report redaction.

- [ ] **Step 2: Implement dry-run-first migration**

  Require `--user-sub`, `--source-prefix statements/`, `--report .migration-private/statement-migration.json`, and either `--dry-run` or `--apply`. Verify `AUTHZ#{sub}/PROFILE` is active before any write. Copy each validated object to the user-prefixed key with `CopyObject`, preserving source; write metadata conditionally; never delete source keys.

- [ ] **Step 3: Implement reconciliation**

  Compare source/destination counts, SHA-256, `cardLast4`, statement dates, totals, transaction counts, metadata count, and aggregate output hashes for every month/quarter/year represented. Exit non-zero on any mismatch.

- [ ] **Step 4: Run migration in production**

  Execute snapshot, dry run, review report, apply, and reconciliation in that order. Store reports in `.migration-private/` and an encrypted operator backup, not Git.

- [ ] **Step 5: Verify API parity**

  Invoke new dashboard/statements APIs with an authenticated test token and compare normalized JSON to the current Amplify pages/API for the same periods. No frontend switch occurs until all comparisons pass.  
  Commit: `feat(migration): add idempotent statement backfill`

### Implementation Phase 8 — CI/CD and pre-cutover verification

- GOAL-009: Build reproducible artifacts, apply reviewed Terraform, deploy Lambda canaries, deploy frontend atomically, and execute automated smoke tests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Split GitHub Actions into CI, infrastructure, and application workflows with immutable artifacts and rollback controls. | | |

### Task 14: Deployment workflows

**Files:**
- Modify: `.github/workflows/ci.yaml`
- Create: `.github/workflows/infrastructure-deploy.yaml`
- Create: `.github/workflows/application-deploy.yaml`
- Retain until decommission: `.github/workflows/deploy.yaml`
- Create: `scripts/deploy-frontend.mjs`
- Create: `scripts/create-release-manifest.mjs`
- Create: `scripts/smoke-serverless.mjs`
- Create: `docs/DEPLOYMENT_SERVERLESS.md`

- [ ] **Step 1: Expand CI**

  Run dependency audit, domain/backend/frontend tests, parser fixture self-skip test, privacy tests, typecheck, lint, Lambda build, static export, static verifier, Terraform fmt/init/validate/test/TFLint, and Playwright static deep-link tests. Upload Lambda zips and frontend `out/` as SHA-addressed workflow artifacts.

- [ ] **Step 2: Add reviewed Terraform deployment**

  On `workflow_dispatch`, download the exact application artifact manifest, run plan, upload the binary plan as an artifact, require `production` environment approval, and apply that exact saved plan. Never run an unreviewed second plan during apply.

- [ ] **Step 3: Add backend canary deployment**

  Upload SHA-addressed zips to the artifact bucket, update functions, publish versions, create CodeDeploy AppSpec revisions, and shift each `live` alias with `CodeDeployDefault.LambdaCanary10Percent5Minutes`. Stop and roll back on alarms before deploying dependent frontend code.

- [ ] **Step 4: Add atomic frontend deployment**

  Upload `out/_next/static/` with one-year immutable cache headers, upload non-HTML assets, upload route HTML with 60-second cache headers, and upload root `index.html` last. Create invalidations for `/`, `/index.html`, `/signin/*`, `/auth/*`, `/upload/*`, and `/statements/*`, not `/*`.

- [ ] **Step 5: Add release manifests and smoke tests**

  Manifest fields are Git SHA, build timestamp, Lambda artifact keys/version IDs, frontend object checksums, CloudFront distribution ID, API deployment ID, and previous release manifest key. Smoke tests cover health, rejected unauthenticated API, Cognito redirect, static deep links, authenticated list/dashboard/upload/conflict/delete, and summary first-byte/chunk completion.

- [ ] **Step 6: Verify in temporary production topology**

  Deploy to `next.cashight.nghuy.link` and `api.cashight.nghuy.link`, run all smoke tests, inspect CloudWatch/X-Ray, export logs to `.migration-private/serverless-production.log`, and run `pnpm security:scan-logs .migration-private/serverless-production.log`.  
  Commit: `ci: add serverless deployment and rollback pipelines`

### Implementation Phase 9 — Production cutover and observation

- GOAL-010: Move `cashight.nghuy.link` to CloudFront with an exercised DNS rollback path while retaining Amplify unchanged.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-015 | Execute staged DNS cutover, production verification, rollback drill, and seven-day observation. | | |

### Task 15: Cutover

**Files:**
- Modify: `terraform/modules/edge/main.tf`
- Modify: `terraform/modules/auth/main.tf`
- Modify: `docs/DEPLOYMENT_SERVERLESS.md`
- Modify: `docs/AWS_ARCHITECTURE_DIAGRAMS.md`
- Modify: `docs/codebase/ARCHITECTURE.md`
- Modify: `docs/codebase/DIAGRAMS.md`

- [ ] **Step 1: Prepare cutover**

  Reduce the current production DNS TTL to 60 seconds at least one prior TTL interval before cutover. Record the Amplify target, CloudFront target, current Cognito client configuration, current release manifest, and rollback commands in the runbook.

- [ ] **Step 2: Add production callback before DNS change**

  Ensure the SPA client and Google OAuth configuration allow `https://cashight.nghuy.link/auth/callback/`, deploy, and verify Cognito redirects to the temporary frontend without changing production DNS.

- [ ] **Step 3: Apply the Route 53 alias change**

  Update Terraform so `cashight.nghuy.link` aliases the CloudFront distribution. Do not delete the Amplify domain association or application. Apply the reviewed plan and wait for DNS propagation.

- [ ] **Step 4: Run production acceptance tests**

  Verify both Cognito credentials and Google federation, refresh/reload session, all deep links, upload success, conflict overwrite, statements pagination/delete, month/quarter/year parity, AI stream, headers, WAF, alarms, and log privacy.

- [ ] **Step 5: Exercise rollback**

  During the maintenance window, reapply the saved DNS rollback configuration to Amplify, verify the legacy app, then reapply CloudFront production DNS and re-run smoke tests. A rollback procedure that has not been exercised does not satisfy this task.

- [ ] **Step 6: Observe for seven days**

  Check alarms, DLQ, stuck jobs, Lambda errors/duration, API 4xx/5xx/throttles, DynamoDB throttles, CloudFront error rates, WAF blocks, and Gemini failures daily. Reset the seven-day window after any severity-1 or severity-2 migration defect.

- [ ] **Step 7: Update architecture documents**

  Replace current-state Amplify diagrams with CloudFront/API/Lambda diagrams, retain a migration-history note, and document actual deployed resource names and runbooks.  
  Commit: `docs: record serverless production cutover`

### Implementation Phase 10 — Decommission legacy runtime

- GOAL-011: Remove Amplify SSR and Auth.js only after the rollback window closes, while retaining recoverable data versions and migration evidence.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | Remove legacy application code, Amplify resources, obsolete IAM/SSM configuration, and deployment workflow through reviewed changes. | | |

### Task 16: Decommission Amplify and Auth.js

**Files:**
- Delete: `legacy/amplify/`
- Delete: `amplify.yml`
- Delete: `.github/workflows/deploy.yaml`
- Delete: `terraform/amplify.tf`
- Modify: `terraform/cognito.tf`
- Modify: `terraform/iam.tf`
- Modify: `terraform/waf.tf`
- Modify: `terraform/monitoring.tf`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Modify: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Prove decommission prerequisites**

  Require signed-off acceptance results, seven healthy days, empty DLQ, zero stuck jobs, successful rollback drill, log scan pass, migration reconciliation pass, and current release/rollback manifests.

- [ ] **Step 2: Remove application dependencies**

  Remove `next-auth`, server-only Auth.js files, Amplify-specific PDF worker copy behavior, and old `/api` route handlers. Keep `pdf-parse` and `pdfjs-dist` only in backend/domain dependencies required by `parser-worker`.

- [ ] **Step 3: Remove legacy infrastructure through Terraform**

  Remove Amplify app/branch/domain, service and compute roles, attachments, Amplify alarms, Amplify WAF association, confidential Cognito client, and obsolete IAM policies. Review the plan to ensure it does not delete the Cognito pool/domain, public SPA client, statement/upload/artifact/state buckets, DynamoDB table, queues, functions, API, CloudFront, WAF ACLs, secrets, or logs.

- [ ] **Step 4: Remove obsolete secrets only after runtime proof**

  Delete Auth.js/Amplify environment secrets and old SSM parameters only after CloudTrail/CloudWatch show no reads for seven days. Retain Secrets Manager resources used by Lambdas.

- [ ] **Step 5: Final verification**

  Run:

  ```bash
  pnpm audit --audit-level moderate
  pnpm test
  pnpm lint
  pnpm tsc --noEmit
  pnpm build
  pnpm run build:lambdas
  cd terraform
  terraform fmt -check -recursive
  terraform validate
  terraform test
  terraform plan -detailed-exitcode
  ```

  Expected: application and infrastructure checks pass; final plan exit code is 0 after decommission apply.  
  Commit: `chore: remove legacy amplify runtime`

## 3. Alternatives

- **ALT-001**: Keep Amplify SSR and move only PDF parsing to Lambda. Rejected because frontend/backend deployment, Auth.js runtime secrets, dynamic S3 reads, and Amplify adapter coupling would remain.
- **ALT-002**: Use API Gateway HTTP API. Rejected because the approved design preserves Gemini response streaming, which requires REST API response streaming support.
- **ALT-003**: Send PDFs through API Gateway to a synchronous parser Lambda. Rejected because request payload encoding and fixed integration timeouts create avoidable size and latency failure modes.
- **ALT-004**: Store every transaction as a DynamoDB item. Rejected because S3 JSON already provides correct versioned source documents and duplicating transaction-level PII increases migration and privacy risk.
- **ALT-005**: Keep S3 as both document store and metadata index. Rejected because LIST plus parallel GET creates linear latency and lacks durable upload-job state.
- **ALT-006**: Implement login in Lambda. Rejected because Cognito must own credential handling, Google federation, PKCE, and token issuance; Lambda owns application authorization only.
- **ALT-007**: Put CloudFront in front of authenticated API routes. Rejected because authenticated responses are not cacheable and direct Regional API Gateway keeps CORS, WAF, logging, throttling, and failure scope explicit.
- **ALT-008**: Delete legacy keys during migration. Rejected because non-destructive copy and reconciliation are required for rollback.

## 4. Dependencies

- **DEP-001**: Approved architecture specification at `docs/superpowers/specs/2026-06-27-hybrid-serverless-architecture-design.md`.
- **DEP-002**: AWS account `010382427026`, Region `ap-southeast-1`, and Route 53 zone for `nghuy.link`.
- **DEP-003**: Existing S3 buckets `cashight-statements` and `cashight-tfstate`, with current Terraform state readable.
- **DEP-004**: Existing Cognito User Pool and domain, Google OAuth application, Gemini key, and PDF password.
- **DEP-005**: GitHub OIDC provider already present in the AWS account.
- **DEP-006**: Protected GitHub `production` environment with required reviewers and secrets for Google OAuth, Gemini, PDF password, and authenticated smoke tests.
- **DEP-007**: Terraform CLI `>= 1.11`, AWS provider 6.x, TFLint, AWS CLI, Node.js 24 for CI, and Lambda Node.js 22 runtime.
- **DEP-008**: Canonical local PDF fixture `test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf` for parser parity; tests self-skip when absent.

## 5. Files

- **FILE-001**: `packages/domain/` — portable schemas, parsing, categorization, period, aggregation, formatting, privacy payload, and API contracts.
- **FILE-002**: `backend/functions/auth-guard/handler.ts` — Cognito allowlist and authorized-subject registration.
- **FILE-003**: `backend/functions/uploads-api/handler.ts` — validated upload job and presigned URL creation.
- **FILE-004**: `backend/functions/upload-status-api/handler.ts` — owned job status reads.
- **FILE-005**: `backend/functions/parser-worker/` — SQS PDF parsing, conflict handling, S3 persistence, metadata, and idempotency.
- **FILE-006**: `backend/functions/statements-api/handler.ts` — paginated statement reads and deletes.
- **FILE-007**: `backend/functions/dashboard-api/handler.ts` — period-specific S3 fetch and aggregation.
- **FILE-008**: `backend/functions/summary-api/` — privacy-safe Gemini streaming.
- **FILE-009**: `backend/shared/` — configuration, clients, claims, authorization, responses, storage, metadata, secrets, and observability.
- **FILE-010**: `frontend/auth/` — Cognito OIDC/PKCE session handling.
- **FILE-011**: `frontend/api/` and `frontend/hooks/` — typed API calls and UI data state.
- **FILE-012**: `app/` — static client routes and existing UI components adapted to API data.
- **FILE-013**: `scripts/build-lambdas.mjs` and `scripts/deploy-frontend.mjs` — deterministic build/deployment mechanics.
- **FILE-014**: `scripts/migrate-statements.ts` and `scripts/reconcile-statements.ts` — non-destructive data migration and parity proof.
- **FILE-015**: `terraform/modules/` — target AWS architecture modules.
- **FILE-016**: `terraform/api-openapi.yaml.tftpl` — REST routes, authorizer, CORS, and streaming integration.
- **FILE-017**: `terraform/moved.tf` — declarative resource-address migrations.
- **FILE-018**: `.github/workflows/` — CI, infrastructure apply, application deployment, and legacy deploy removal.
- **FILE-019**: `docs/DEPLOYMENT_SERVERLESS.md` and `docs/runbooks/` — deploy, migration, cutover, rollback, and decommission operations.
- **FILE-020**: `docs/AWS_ARCHITECTURE_DIAGRAMS.md` and `docs/codebase/` — post-cutover current-state documentation.

## 6. Testing

- **TEST-001**: Existing Vitest suite remains green after every compatibility change.
- **TEST-002**: Package parity tests prove extracted domain functions return current results.
- **TEST-003**: Handler unit tests cover validation, authorization, ownership, error mapping, and dependency failures without AWS calls.
- **TEST-004**: Parser parity uses the canonical fixture and proves Lambda packaging includes the worker and produces current values.
- **TEST-005**: Privacy tests prove PAN, names, raw descriptions, tokens, and secrets do not enter logs or Gemini prompts.
- **TEST-006**: Upload integration tests prove presigned PUT, SQS delivery, idempotency, conflict, overwrite, cleanup, retry, and DLQ behavior.
- **TEST-007**: API contract tests prove missing/invalid tokens get 401, unauthorized subjects get 403, and cross-user resources are inaccessible.
- **TEST-008**: Aggregation reconciliation proves month/quarter/year JSON matches the current implementation.
- **TEST-009**: Summary tests prove first-byte streaming, complete streaming, abort/retry, and privacy-safe input.
- **TEST-010**: Static export verification proves every route has generated HTML and no runtime API dependency.
- **TEST-011**: Playwright proves static deep links, Cognito/Google sign-in, reload/restore, navigation, upload, statements, dashboard, and summary flows.
- **TEST-012**: Terraform fmt, validate, test, TFLint, and reviewed plans prove security settings and no unintended replacement/destruction.
- **TEST-013**: Migration dry-run/apply/reconciliation proves source objects remain and destination data/checksums/aggregates match.
- **TEST-014**: CodeDeploy canary and frontend release-pointer rollback are exercised.
- **TEST-015**: DNS rollback to Amplify and return to CloudFront are exercised during cutover.
- **TEST-016**: Production log exports pass `pnpm security:scan-logs` before decommission.

## 7. Risks & Assumptions

- **RISK-001**: Terraform module moves can propose destructive replacement if an address is missing from `moved.tf`; every phase requires JSON plan inspection.
- **RISK-002**: The Google OAuth secret is present in encrypted Terraform state because Cognito IdP provider details have no write-only secret field; state access must be more restricted than application deployment access.
- **RISK-003**: Cognito federated and native users can have different `sub` values. Authorization is keyed by the subject issued for the actual login and data migration targets one explicitly verified subject.
- **RISK-004**: API Gateway REST response streaming is newer than the existing Terraform provider baseline. The OpenAPI extension is used so the integration does not depend on a missing first-class provider argument.
- **RISK-005**: pdfjs bundling can fail in Lambda if `pdf.worker.mjs` is absent or resolved from a different path; artifact verification and deployed parse smoke tests are mandatory.
- **RISK-006**: Asynchronous uploads change the UX from one HTTP response to job polling; UI tests must cover every state and conflict retry.
- **RISK-007**: S3 write followed by DynamoDB failure can leave a valid object without metadata; deterministic keys, idempotency records, and reconciliation repair this state.
- **RISK-008**: Static SPA token storage is exposed to successful XSS. CSP, dependency governance, short token lifetimes, session-only storage, WAF, and no untrusted HTML rendering reduce but do not eliminate the risk.
- **RISK-009**: A DNS cutover can expose callback or cache configuration mistakes. Temporary hostname validation, low TTL, dual callbacks, and exercised rollback reduce impact.
- **RISK-010**: Parallel operation can create new statements in either architecture during migration. Freeze uploads briefly for final reconciliation or dual-write metadata before read cutover.
- **ASSUMPTION-001**: Personal-use scale remains low enough that one on-demand DynamoDB table and bounded S3 reads per selected period are sufficient.
- **ASSUMPTION-002**: A five-minute presigned URL and two-minute parser client timeout are acceptable for the current 5 MiB PDF limit.
- **ASSUMPTION-003**: The existing Cognito pool can add a public client, resource server, social IdP, and triggers without replacing the pool.
- **ASSUMPTION-004**: `cashight.nghuy.link` and `api.cashight.nghuy.link` remain the production frontend and API domains.
- **ASSUMPTION-005**: GitHub Actions remains the only production deployment initiator.

## 8. Related Specifications / Further Reading

- [Approved hybrid architecture design](../superpowers/specs/2026-06-27-hybrid-serverless-architecture-design.md)
- [Current AWS architecture diagrams](../AWS_ARCHITECTURE_DIAGRAMS.md)
- [Current deployment runbook](../DEPLOYMENT.md)
- [Security hardening plan](./20-security-hardening.md)
- [Referenced production-grade serverless architecture](https://dev.to/aws-builders/production-grade-serverless-web-app-architecture-on-aws-with-cloudfront-s3-api-gateway-lambda-1646)
- [Next.js SPA and static export guide](https://nextjs.org/docs/app/guides/single-page-applications)
- [Cognito PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html)
- [Cognito social IdP configuration](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-provider.html)
- [API Gateway Cognito authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html)
- [API Gateway response streaming](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)
- [SQS partial batch response guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/lambda-event-filtering-partial-batch-responses-for-sqs/best-practices-partial-batch-responses.html)
