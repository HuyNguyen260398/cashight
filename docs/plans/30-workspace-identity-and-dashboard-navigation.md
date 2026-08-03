---
goal: Establish stable workspace ownership, provider capabilities, and nested dashboard navigation for AWS dashboard features
version: 1.0
date_created: 2026-08-03
last_updated: 2026-08-03
owner: Huy
status: 'Planned'
tags:
  - feature
  - authentication
  - migration
  - navigation
  - cognito
---

# Workspace Identity and Dashboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Google and Cognito-native identities one stable Cashight workspace, expose server-derived capabilities, and add the approved nested Dashboard navigation without changing bank-selection behavior.

**Architecture:** Cognito's trusted token-generation event records each subject's provider and maps it to workspace `primary`. API authorization returns that workspace record, storage helpers use workspace-scoped keys with a temporary legacy-subject fallback, and a dry-run-first migration copies existing data without deleting rollback sources. A dedicated capabilities Lambda drives the Cost Explorer warning, while an isolated navigation component renders the nested desktop, collapsed, and mobile menu states.

**Tech Stack:** TypeScript 5, Zod 4, React 19, Next.js 16 static export, Cognito User Pool triggers, API Gateway REST API, Lambda Node.js 22, DynamoDB, S3, Vitest, Testing Library, Playwright, Terraform 1.11+.

## Global Constraints

- Preserve `parseBankFromSearch()` and server-side `resolveBank()`; TPB and VIB remain separate dashboard views.
- Derive `workspaceId` and `authProvider` only from trusted authorization state; never accept either value from a request body, query, path, or browser claim.
- Use the literal single-user workspace ID `primary`.
- Copy and verify legacy objects during migration; do not delete legacy objects in this plan.
- Keep `cashight/read` and `cashight/write` scopes unchanged.
- Keep the static-export requirements `output: 'export'` and `trailingSlash: true`.
- Do not log email, names, tokens, provider payloads, S3 object contents, transaction descriptions, or account identifiers.

---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This is Step 30 in `docs/plans/00-INDEX.md` and the first implementation slice of the approved [AWS cost and billing dashboards specification](../superpowers/specs/2026-08-03-aws-cost-billing-dashboards-design.md). Steps 31 and 32 depend on its workspace and capability interfaces.

## 1. Requirements & Constraints

- **REQ-3001**: Map every allowlisted Cognito subject to workspace `primary` and provider `COGNITO` or `GOOGLE`.
- **REQ-3002**: Return server-derived `canViewAwsCosts` through `GET /session/capabilities`.
- **REQ-3003**: Make backend ownership checks use `workspaceId`, not raw Cognito `sub`.
- **REQ-3004**: Migrate current S3 statement objects and DynamoDB statement metadata to workspace-scoped keys through a dry-run-first, copy-only process.
- **REQ-3005**: Preserve a temporary read fallback to legacy subject-scoped data until migration validation passes.
- **REQ-3006**: Render Dashboard → Bank statements → TPB/VIB and Dashboard → AWS budget → Cost Explorer/Billing Invoice.
- **REQ-3007**: Preserve existing top-level Upload and Statements utilities.
- **SEC-3001**: Reject inactive, missing, malformed, or provider-unknown authorization records.
- **SEC-3002**: Never infer backend authorization from a frontend capability value.
- **SEC-3003**: Never delete legacy financial objects as part of migration or rollback.
- **CON-3001**: Existing production records do not contain `workspaceId` or `authProvider`.
- **CON-3002**: Existing object keys and metadata partitions use the Cognito `sub`.
- **PAT-3001**: Continue using Zod at DynamoDB, API, and local-fixture boundaries.
- **PAT-3002**: Keep route handlers thin and dependency-injected for deterministic tests.

## 2. File Structure

| Path | Responsibility |
| --- | --- |
| `packages/domain/src/workspace.ts` | Workspace/provider/capability schemas and types. |
| `packages/domain/package.json` | Export `@cashight/domain/workspace`. |
| `backend/shared/auth-claims.ts` | Return validated workspace authorization with access claims. |
| `backend/shared/metadata.ts` | Parse authorization records and query workspace-scoped statement metadata. |
| `backend/shared/storage.ts` | Build and validate workspace statement object prefixes. |
| `backend/functions/auth-guard/handler.ts` | Derive provider from trusted Cognito event data and upsert workspace mapping. |
| `backend/functions/session-capabilities-api/handler.ts` | Serve `GET /session/capabilities`. |
| `scripts/migrate-workspace-ownership.ts` | Inventory, copy, validate, and report migration without deletion. |
| `docs/runbooks/workspace-ownership-migration.md` | Exact dry-run, apply, validation, rollback, and later-cleanup procedure. |
| `app/components/dashboard-nav.tsx` | Nested dashboard navigation shared by desktop and mobile shell states. |
| `app/components/admin-shell.tsx` | Host `DashboardNav` and preserve Upload/Statements utilities. |
| `frontend/api/contracts.ts` | Parse the capabilities response. |
| `frontend/hooks/use-session-capabilities.ts` | Load and cache server-derived capabilities. |
| `terraform/api-openapi.yaml.tftpl` | Add the authenticated capabilities route. |
| `terraform/api.tf`, `terraform/compute.tf`, `terraform/variables.tf`, `terraform/terraform.tfvars.example`, `terraform/monitoring.tf` | Lambda integration, temporary migration flags, IAM, alias, permission, and alarm. |
| `scripts/dev-server.ts`, `scripts/local/handlers.ts` | Local capabilities route and workspace-shaped development authorization. |

## 3. Implementation Steps

### Task 1: Define workspace and capability contracts

- **GOAL-3001**: Create the shared types consumed by auth, APIs, migration, and frontend code.

**Files:**

- Create: `packages/domain/src/workspace.ts`
- Modify: `packages/domain/package.json`
- Create: `lib/__tests__/workspace.test.ts`

**Interfaces:**

- Produces: `AuthProviderSchema`, `WorkspaceIdSchema`, `AuthorizedWorkspaceSchema`, `SessionCapabilitiesSchema`.
- Produces: `type AuthProvider = 'COGNITO' | 'GOOGLE'` and `type WorkspaceId = 'primary'`.

- [ ] **Step 1: Write failing schema tests**

  ```ts
  expect(AuthorizedWorkspaceSchema.parse({
    workspaceId: 'primary',
    authProvider: 'COGNITO',
  })).toEqual({ workspaceId: 'primary', authProvider: 'COGNITO' });

  expect(() => AuthorizedWorkspaceSchema.parse({
    workspaceId: 'user-supplied',
    authProvider: 'GOOGLE',
  })).toThrow();
  ```

- [ ] **Step 2: Run the focused test and confirm missing-module failure**

  Run: `pnpm test lib/__tests__/workspace.test.ts`

  Expected: FAIL because `@cashight/domain/workspace` is not exported.

- [ ] **Step 3: Implement the exact schemas**

  ```ts
  export const AuthProviderSchema = z.enum(['COGNITO', 'GOOGLE']);
  export const WorkspaceIdSchema = z.literal('primary');
  export const AuthorizedWorkspaceSchema = z.object({
    workspaceId: WorkspaceIdSchema,
    authProvider: AuthProviderSchema,
  });
  export const SessionCapabilitiesSchema = z.object({
    canViewAwsCosts: z.boolean(),
    reason: z.literal('COGNITO_REAUTH_REQUIRED').optional(),
  });
  ```

- [ ] **Step 4: Export the package subpath and rerun tests**

  Add `"./workspace": "./src/workspace.ts"` to `packages/domain/package.json`.

  Run: `pnpm test lib/__tests__/workspace.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the contract**

  ```bash
  git add packages/domain/src/workspace.ts packages/domain/package.json lib/__tests__/workspace.test.ts
  git commit -m "feat(auth): define stable workspace capabilities"
  ```

### Task 2: Record and authorize trusted provider/workspace state

- **GOAL-3002**: Make Cognito trigger events create complete authorization records and make APIs consume them.

**Files:**

- Modify: `backend/functions/auth-guard/handler.ts`
- Modify: `backend/shared/auth-claims.ts`
- Modify: `backend/shared/metadata.ts`
- Modify: `backend/__tests__/auth-guard.test.ts`
- Modify: `backend/__tests__/shared.test.ts`

**Interfaces:**

- Consumes: `AuthorizedWorkspaceSchema` from Task 1.
- Changes: `AuthorizedUserRecord` adds `workspaceId: 'primary'` and `authProvider`.
- Changes: trusted `AccessClaims` parsing retains the signed Cognito `username` solely for the temporary legacy-record compatibility decision.
- Changes: `authorizeRequest()` returns `{ claims, authorization }` where `authorization` contains the workspace/provider fields.

- [ ] **Step 1: Add failing native and Google trigger tests**

  ```ts
  expect(upsertAuthorizedUser).toHaveBeenCalledWith(expect.objectContaining({
    workspaceId: 'primary',
    authProvider: 'GOOGLE',
  }));
  ```

  Add a native event assertion for `authProvider: 'COGNITO'` and a malformed `identities` test that throws `AccessDenied` rather than guessing.

- [ ] **Step 2: Add failing authorization-record parsing and compatibility tests**

  Verify a legacy record without workspace/provider is rejected by the strict parser. Under `ENABLE_LEGACY_AUTHZ_FALLBACK=true`, accept it only through an explicit compatibility helper that maps to workspace `primary` and derives provider from the signed API Gateway authorizer `username` claim (`Google_` prefix means `GOOGLE`; a valid native Cognito username means `COGNITO`). Reject absent, ambiguous, or unsupported usernames. Browser fields and unsigned request input must never participate.

- [ ] **Step 3: Derive provider from trusted Cognito event data**

  Add `deriveAuthProvider(event)` that returns `GOOGLE` when the trusted `identities` user attribute contains provider name `Google`; it returns `COGNITO` for a native user with no external identity and throws for malformed or unsupported external providers.

- [ ] **Step 4: Upsert, parse, and temporarily bridge the complete record**

  Add `workspaceId: 'primary'` and `authProvider` to the auth-guard write. Extend `authorizationRecordSchema` and `AuthorizedUserRecord` with the shared domain schemas. Keep the signed-claim compatibility path behind `ENABLE_LEGACY_AUTHZ_FALLBACK`; emit a count-only metric when it is used, and document removal after all authorization records are backfilled.

- [ ] **Step 5: Prove requests receive trusted workspace data**

  Update `backend/__tests__/shared.test.ts` to assert `authorizeRequest()` returns the expected workspace/provider and continues to reject missing read/write scopes. Cover fallback enabled/disabled, Google/native signed usernames, unsupported federated prefixes, and the guarantee that request body/query provider fields are ignored.

- [ ] **Step 6: Run the auth suites**

  Run: `pnpm test backend/__tests__/auth-guard.test.ts backend/__tests__/shared.test.ts`

  Expected: PASS.

- [ ] **Step 7: Commit trusted authorization state**

  ```bash
  git add backend/functions/auth-guard/handler.ts backend/shared/auth-claims.ts backend/shared/metadata.ts backend/__tests__/auth-guard.test.ts backend/__tests__/shared.test.ts
  git commit -m "feat(auth): map providers to the primary workspace"
  ```

### Task 3: Add workspace storage helpers and legacy read compatibility

- **GOAL-3003**: Centralize workspace ownership while keeping pre-migration reads available.

**Files:**

- Modify: `backend/shared/storage.ts`
- Modify: `backend/shared/metadata.ts`
- Modify: `backend/functions/dashboard-api/handler.ts`
- Modify: `backend/functions/statements-api/handler.ts`
- Modify: `backend/functions/uploads-api/handler.ts`
- Modify: `backend/functions/upload-status-api/handler.ts`
- Modify: `backend/functions/parser-worker/process-job.ts`
- Modify: `backend/functions/parser-worker/handler.ts`
- Modify: `backend/__tests__/dashboard-api.test.ts`
- Modify: `backend/__tests__/statements-api.test.ts`
- Modify: `backend/__tests__/uploads-api.test.ts`
- Modify: `backend/__tests__/upload-status-api.test.ts`
- Modify: `backend/__tests__/parser-worker.test.ts`

**Interfaces:**

- Produces: `workspacePartition(workspaceId): 'WORKSPACE#primary'`.
- Produces: `statementObjectKey(workspaceId, cardLast4, year, month)`.
- Produces: `legacyStatementObjectKey(sub, cardLast4, year, month)` only for migration fallback.
- Changes: `UploadJobRecord.sub` becomes `owner: { workspaceId: 'primary'; subject: string }` during the compatibility window.

- [ ] **Step 1: Write failing workspace ownership tests**

  ```ts
  expect(statementObjectKey('primary', '9674', 2026, 5)).toBe(
    'users/primary/statements/9674/2026/2026-05.json',
  );
  expect(() => assertRecordOwner('primary', {
    PK: 'WORKSPACE#other',
    objectKey: 'users/other/statements/9674/2026/2026-05.json',
  })).toThrow();
  ```

- [ ] **Step 2: Implement centralized key and partition helpers**

  Remove handler-local string construction. Keep the legacy helper explicitly named and unexported from browser-consumable modules.

- [ ] **Step 3: Change handler dependencies from subject to workspace**

  Each handler must use `authorization.workspaceId` for S3/DynamoDB ownership. `claims.sub` remains only for authorization-record lookup, auditing job ownership during migration, and legacy fallback.

- [ ] **Step 4: Add complete-result legacy read fallback**

  When the workspace partition contains no record for a requested statement, read the legacy subject record/object, validate it with existing schemas, and emit metric `LegacyWorkspaceFallback=1`. Never merge duplicate workspace and legacy records.

- [ ] **Step 5: Update job and worker ownership**

  Presigned bank upload keys become `uploads/statements/primary/{jobId}.pdf`. Parser-worker path validation must accept that exact prefix and the legacy prefix only while `ENABLE_LEGACY_WORKSPACE_FALLBACK=true`.

- [ ] **Step 6: Run all affected backend suites**

  Run: `pnpm test backend/__tests__/dashboard-api.test.ts backend/__tests__/statements-api.test.ts backend/__tests__/uploads-api.test.ts backend/__tests__/upload-status-api.test.ts backend/__tests__/parser-worker.test.ts`

  Expected: PASS with explicit tests for workspace-first, legacy-only, duplicate, and foreign-owner states.

- [ ] **Step 7: Commit workspace ownership adapters**

  ```bash
  git add backend/shared backend/functions backend/__tests__
  git commit -m "refactor(storage): authorize financial data by workspace"
  ```

### Task 4: Build the copy-only workspace migration tool

- **GOAL-3004**: Migrate existing data with deterministic inventory and rollback evidence.

**Files:**

- Create: `scripts/migrate-workspace-ownership.ts`
- Create: `scripts/__tests__/migrate-workspace-ownership.test.ts`
- Modify: `package.json`
- Create: `docs/runbooks/workspace-ownership-migration.md`

**Interfaces:**

- Produces CLI: `pnpm migrate:workspace --dry-run --source-sub <sub>`.
- Produces CLI: `pnpm migrate:workspace --apply --source-sub <sub> --confirm-copy-to-primary`.
- Does not produce or expose a delete mode.

- [ ] **Step 1: Write failing plan-generation tests**

  Use injected S3/DynamoDB adapters and assert the dry run returns sorted operations with source key, destination key, SHA-256, metadata key, and validation status without calling any write method.

- [ ] **Step 2: Implement strict CLI parsing**

  Reject missing mode, both modes together, malformed subject, apply without the exact confirmation flag, and any unknown option.

- [ ] **Step 3: Implement inventory and copy planning**

  List only `users/{sourceSub}/statements/`, parse every JSON document with `StatementSchema`, load matching metadata, and build destination keys through Task 3 helpers.

- [ ] **Step 4: Implement idempotent apply**

  Copy an object only when the destination is absent or has the same SHA-256. Refuse to overwrite a different destination. Write workspace metadata conditionally, then reread and validate destination object, metadata, and hash.

- [ ] **Step 5: Add machine-readable and human summaries**

  Print counts and sanitized keys only. Never print statement contents, transaction descriptions, email, or the authorization record.

- [ ] **Step 6: Write the runbook**

  Document prerequisites, dry run, apply, count/hash/dashboard reconciliation, feature-flag enablement, rollback to legacy fallback, and the prohibition on deletion in this step.

- [ ] **Step 7: Add scripts and run tests**

  Add:

  ```json
  "migrate:workspace": "tsx scripts/migrate-workspace-ownership.ts"
  ```

  Run: `pnpm test scripts/__tests__/migrate-workspace-ownership.test.ts`

  Expected: PASS.

- [ ] **Step 8: Commit migration tooling**

  ```bash
  git add scripts/migrate-workspace-ownership.ts scripts/__tests__/migrate-workspace-ownership.test.ts docs/runbooks/workspace-ownership-migration.md package.json
  git commit -m "feat(migration): copy data into the primary workspace"
  ```

### Task 5: Add the server-derived session capabilities API

- **GOAL-3005**: Give the SPA a non-authoritative capability view while preserving backend enforcement.

**Files:**

- Create: `backend/functions/session-capabilities-api/handler.ts`
- Create: `backend/__tests__/session-capabilities-api.test.ts`
- Modify: `frontend/api/contracts.ts`
- Create: `frontend/hooks/use-session-capabilities.ts`
- Create: `frontend/__tests__/session-capabilities.test.tsx`
- Modify: `scripts/local/handlers.ts`
- Modify: `scripts/dev-server.ts`

**Interfaces:**

- Produces: `GET /session/capabilities` response parsed by `SessionCapabilitiesSchema`.
- Produces hook: `useSessionCapabilities(): { data; loading; error; reload }`.

- [ ] **Step 1: Write failing handler tests**

  ```ts
  expect(body).toEqual({ canViewAwsCosts: true });
  expect(googleBody).toEqual({
    canViewAwsCosts: false,
    reason: 'COGNITO_REAUTH_REQUIRED',
  });
  ```

- [ ] **Step 2: Implement the dependency-injected Lambda handler**

  Call `authorizeRequest(event, 'cashight/read')`, map only the validated provider to the response, and return no email, subject, workspace ID, scopes, or raw authorization record.

- [ ] **Step 3: Add frontend contract and hook tests**

  Verify successful parse, 401 redirect through `apiFetch`, retryable network error, and component unmount cancellation.

- [ ] **Step 4: Implement the hook with session-lifetime caching**

  Cache one resolved response in module memory and clear it when the OIDC user changes or signs out. Do not persist it to local storage.

- [ ] **Step 5: Add the local route**

  Local bypass returns `{ canViewAwsCosts: true }` and seeds an authorization record with `workspaceId: 'primary'`, `authProvider: 'COGNITO'`.

- [ ] **Step 6: Run focused tests**

  Run: `pnpm test backend/__tests__/session-capabilities-api.test.ts frontend/__tests__/session-capabilities.test.tsx`

  Expected: PASS.

- [ ] **Step 7: Commit capabilities behavior**

  ```bash
  git add backend/functions/session-capabilities-api backend/__tests__/session-capabilities-api.test.ts frontend/api/contracts.ts frontend/hooks/use-session-capabilities.ts frontend/__tests__/session-capabilities.test.tsx scripts/local/handlers.ts scripts/dev-server.ts
  git commit -m "feat(auth): expose server-derived session capabilities"
  ```

### Task 6: Implement accessible nested Dashboard navigation

- **GOAL-3006**: Render the approved hierarchy across every shell mode.

**Files:**

- Create: `app/components/dashboard-nav.tsx`
- Create: `app/__tests__/dashboard-nav.test.tsx`
- Modify: `app/components/admin-shell.tsx`

**Interfaces:**

- Produces: `DashboardNav({ pathname, collapsed, onNavigate })`.
- Uses links: `/?bank=TPBank`, `/?bank=VIB`, `/aws/cost-explorer/`, `/aws/billing-invoice/`.

- [ ] **Step 1: Write failing hierarchy and route tests**

  Assert the exact labels/links, no “All banks” item, active bank derived from `bank` search parameter, active AWS descendant derived from pathname, and existing Upload/Statements presence.

- [ ] **Step 2: Write failing accessibility interaction tests**

  Test `aria-expanded`, Enter/Space toggle, Escape close for flyouts, focus return, automatic expansion for an active descendant, and mobile `onNavigate`.

- [ ] **Step 3: Implement a data-driven navigation tree**

  ```ts
  const dashboardGroups = [
    { label: 'Bank statements', children: [
      { label: 'TPB', href: '/?bank=TPBank' },
      { label: 'VIB', href: '/?bank=VIB' },
    ] },
    { label: 'AWS budget', children: [
      { label: 'Cost Explorer', href: '/aws/cost-explorer/' },
      { label: 'Billing Invoice', href: '/aws/billing-invoice/' },
    ] },
  ] as const;
  ```

- [ ] **Step 4: Integrate expanded and collapsed desktop states**

  Expanded mode uses nested disclosure controls. Collapsed mode uses keyboard-accessible flyouts anchored to the Dashboard icon and never relies on hover alone.

- [ ] **Step 5: Integrate mobile drawer behavior**

  Render the same tree and close the drawer only after leaf navigation. Preserve the existing Escape/backdrop behavior.

- [ ] **Step 6: Run component tests**

  Run: `pnpm test app/__tests__/dashboard-nav.test.tsx app/__tests__/bank-selector.test.tsx app/__tests__/period-selector.test.tsx`

  Expected: PASS.

- [ ] **Step 7: Commit nested navigation**

  ```bash
  git add app/components/dashboard-nav.tsx app/components/admin-shell.tsx app/__tests__/dashboard-nav.test.tsx
  git commit -m "feat(navigation): add nested dashboard menu"
  ```

### Task 7: Provision and route capabilities infrastructure

- **GOAL-3007**: Deploy the capabilities Lambda with exact API and IAM boundaries.

**Files:**

- Modify: `terraform/api-openapi.yaml.tftpl`
- Modify: `terraform/api.tf`
- Modify: `terraform/compute.tf`
- Modify: `terraform/variables.tf`
- Modify: `terraform/terraform.tfvars.example`
- Modify: `terraform/monitoring.tf`
- Modify: `terraform/outputs.tf`
- Modify: `terraform/tests/auth_api_edge.tftest.hcl`
- Modify: `scripts/build-lambdas.mjs`
- Modify: `scripts/__tests__/build-lambdas.test.ts`

**Interfaces:**

- Consumes Lambda artifact `dist/lambdas/session-capabilities-api/index.js`.
- Produces API operation `getSessionCapabilities` with `cashight/read`.

- [ ] **Step 1: Add failing Terraform assertions**

  Assert a dedicated Lambda role, DynamoDB `GetItem` only, 30-day log group, X-Ray write policy, live alias, API permission scoped to `GET /session/capabilities`, and error alarm. Assert temporary `enable_legacy_authz_fallback` and `enable_legacy_workspace_fallback` variables are explicit booleans and reach only the Lambdas that consume their corresponding shared compatibility path.

- [ ] **Step 2: Add the OpenAPI route and template input**

  Define GET and OPTIONS operations with exact CORS and the existing Cognito authorizer. Pass `session_capabilities_api_arn` through `terraform/api.tf`.

- [ ] **Step 3: Add Lambda resources and rollout flags**

  Use Node.js 22, 256 MiB, 10-second timeout, `TABLE_NAME`, active tracing, ignored deployed artifact hash, live alias, and no S3/SSM permissions. Add `ENABLE_LEGACY_AUTHZ_FALLBACK` to request-authorizing Lambdas and `ENABLE_LEGACY_WORKSPACE_FALLBACK` to statement storage/parser paths. Document both temporary variables in `terraform.tfvars.example`; enable them for the migration deployment, then set them false only after authorization-record and object backfill validation.

- [ ] **Step 4: Extend build discovery tests**

  Confirm the generic handler discovery includes `session-capabilities-api` without copying `pdf.worker.mjs` into its artifact.

- [ ] **Step 5: Run infrastructure tests**

  Run: `pnpm test scripts/__tests__/build-lambdas.test.ts`

  Run: `cd terraform && terraform fmt -check -recursive && terraform validate && terraform test -filter=tests/auth_api_edge.tftest.hcl`

  Expected: PASS.

- [ ] **Step 6: Commit capabilities infrastructure**

  ```bash
  git add terraform scripts/build-lambdas.mjs scripts/__tests__/build-lambdas.test.ts
  git commit -m "infra(auth): route session capabilities"
  ```

### Task 8: Verify migration, shell, and rollback readiness

- **GOAL-3008**: Prove Step 30 is safe to enable before AWS dashboards exist.

**Files:**

- Create: `tests/e2e/dashboard-navigation.spec.ts`
- Modify: `scripts/smoke-serverless.mjs`
- Modify: `docs/runbooks/workspace-ownership-migration.md`

**Interfaces:**

- Produces smoke assertion for `/session/capabilities`.
- Produces browser coverage for all nested routes; AWS leaf pages may render their Step 31/32 placeholder shell until those plans land.

- [ ] **Step 1: Add browser navigation coverage**

  Verify expanded desktop, collapsed flyout, mobile drawer, TPB/VIB URL query retention, active descendants, keyboard toggles, and no console errors.

- [ ] **Step 2: Add serverless capability smoke coverage**

  Assert an authenticated native request returns 200 with `canViewAwsCosts: true` and no extra keys. Do not add a real Google token to CI; provider rejection remains a handler test.

- [ ] **Step 3: Run the full verification suite**

  Run: `pnpm lint`

  Run: `pnpm tsc --noEmit`

  Run: `pnpm test`

  Run: `pnpm build`

  Run: `pnpm test:e2e -- tests/e2e/dashboard-navigation.spec.ts`

  Expected: all commands PASS.

- [ ] **Step 4: Perform a migration dry run**

  Run with environment variable `CASHIGHT_SOURCE_SUB` populated out of band with the real source subject:

  ```bash
  pnpm migrate:workspace --dry-run --source-sub "$CASHIGHT_SOURCE_SUB"
  ```

  Expected: zero writes, zero invalid statements, deterministic copy counts, and no PII in output.

- [ ] **Step 5: Commit verification assets**

  ```bash
  git add tests/e2e/dashboard-navigation.spec.ts scripts/smoke-serverless.mjs docs/runbooks/workspace-ownership-migration.md
  git commit -m "test(auth): verify workspace migration and dashboard navigation"
  ```

## 4. Alternatives

- **ALT-3001**: Link Google and native users into one Cognito subject. Rejected because linking external identities during sign-up is operationally fragile and makes the storage boundary depend on identity-provider lifecycle behavior.
- **ALT-3002**: Keep ownership keyed by current Cognito subject. Rejected because re-authenticating from Google to native Cognito would hide existing financial data.
- **ALT-3003**: Trust the ID-token `identities` claim in React only. Rejected because frontend claims cannot enforce backend Cost Explorer access.
- **ALT-3004**: Move Upload and Statements under Bank statements. Rejected because the approved hierarchy concerns dashboard views, while these existing utilities serve separate workflows.

## 5. Dependencies

- **DEP-3001**: Approved design specification at `docs/superpowers/specs/2026-08-03-aws-cost-billing-dashboards-design.md`.
- **DEP-3002**: Existing Cognito auth guard, API Gateway authorizer, DynamoDB table, S3 statement bucket, and upload pipeline.
- **DEP-3003**: Existing TPB/VIB bank-domain and URL-resolution invariants.

## 6. Files

- **FILE-3001**: Domain workspace contracts in `packages/domain/src/workspace.ts`.
- **FILE-3002**: Auth and storage boundaries under `backend/shared/` and `backend/functions/auth-guard/`.
- **FILE-3003**: Migration CLI and runbook under `scripts/` and `docs/runbooks/`.
- **FILE-3004**: Nested navigation under `app/components/`.
- **FILE-3005**: Capabilities API infrastructure under `terraform/`.

## 7. Testing

- **TEST-3001**: Unit tests prove provider derivation and strict authorization-record validation.
- **TEST-3002**: Backend tests prove workspace-first ownership, legacy fallback, and foreign-owner rejection.
- **TEST-3003**: Migration tests prove dry-run purity, copy idempotency, hash validation, and no deletion.
- **TEST-3004**: Component/browser tests prove nested navigation across desktop, collapsed, mobile, and keyboard modes.
- **TEST-3005**: Terraform tests prove exact route, IAM, Lambda, logging, and alarms.

## 8. Risks & Assumptions

- **RISK-3001**: Incorrect migration could hide or duplicate statements. Mitigation: copy-only apply, hash/schema validation, dashboard reconciliation, legacy fallback, and no deletion.
- **RISK-3002**: Cognito event shapes differ for native and Google sessions. Mitigation: fixture both trusted event shapes and fail closed on malformed/unknown identity data.
- **RISK-3003**: Nested flyouts regress keyboard/mobile navigation. Mitigation: isolate `DashboardNav` and require interaction plus Playwright coverage.
- **ASSUMPTION-3001**: Cashight remains a single-user application with one allowed email and workspace ID `primary`.
- **ASSUMPTION-3002**: The existing production subject is available out of band when the migration command runs.

## 9. Completion Criteria

- Every requirement REQ-3001 through REQ-3007 has a passing automated test.
- Native and Google subjects both map to `primary`, but only native capability returns `canViewAwsCosts: true`.
- Existing bank data reads from workspace keys after migration and can fall back to legacy keys during rollback.
- The migration tool has no delete code path.
- Nested navigation matches the approved hierarchy and existing TPB/VIB tests remain green.
- Terraform and application verification commands pass.
- Step 31 and Step 32 can consume `authorization.workspaceId` and `useSessionCapabilities()` without changing Step 30 interfaces.

## 10. Related Specifications / Further Reading

- [Approved AWS dashboards design](../superpowers/specs/2026-08-03-aws-cost-billing-dashboards-design.md)
- [Hybrid serverless architecture](../superpowers/specs/2026-06-27-hybrid-serverless-architecture-design.md)
- [Amazon Cognito user pools and identity providers](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html)
