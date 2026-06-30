# Hybrid Serverless Migration Runbook

This runbook controls the migration from Amplify-hosted Next.js SSR to the
Terraform-managed static frontend and Lambda backend defined in
[`docs/plans/29-hybrid-serverless-migration.md`](../plans/29-hybrid-serverless-migration.md).
Amplify remains the production rollback target until the Phase 10 gate is met.

## Operator safety rules

- Run production commands with an explicitly selected AWS profile and confirm
  the account and Region before continuing.
- Keep application resources in `ap-southeast-1`. CloudFront certificates and
  CloudFront-scope WAF resources are the documented `us-east-1` exceptions.
- Never print or commit PDF contents, transaction descriptions, tokens, email
  addresses, full card numbers, passwords, OAuth secrets, or Gemini keys.
- Keep private snapshots and Playwright authentication state under
  `.migration-private/`. That directory is gitignored; do not copy its contents
  into tickets, pull requests, or CI artifacts.
- Stop the migration if reconciliation differs, privacy scans fail, a rollback
  check fails, or the active deployment produces unexplained financial-result
  differences.

## Phase 0: Capture the current state

Prerequisites:

- AWS credentials can list, read, and inspect versioning on the current
  statements bucket.
- `STATEMENTS_BUCKET` names the existing bucket.
- `STORAGE_REGION` is set when the bucket is not in the default
  `ap-southeast-1` Region.

Confirm identity without writing AWS resources:

```bash
AWS_PROFILE=<profile> aws sts get-caller-identity
```

Create the private baseline snapshot:

```bash
AWS_PROFILE=<profile> \
STATEMENTS_BUCKET=<bucket> \
STORAGE_REGION=ap-southeast-1 \
pnpm tsx scripts/snapshot-current-state.ts \
  --output .migration-private/current-state.json
```

The script paginates every object below `statements/`, downloads and validates
each object with `StatementSchema`, and writes only the storage key, last four
card digits, statement date, spend total, transaction count, and SHA-256 hash.
It rejects output paths outside `.migration-private/`.

Before continuing, confirm that:

- `versioningStatus` matches the bucket configuration and is `Enabled` in
  production;
- `objectCount` matches the number of statement records;
- every entry has a 64-character SHA-256 value;
- the snapshot contains no `transactions`, `description`, PDF data, full PAN,
  name, email, password, or token fields.

Do not manually edit the snapshot. Generate a new timestamped file when a
fresh baseline is needed.

### Result — 2026-06-30

| Check | Result |
|---|---|
| AWS identity (`010382427026`, IAM user `huy_ng`) | confirmed |
| Bucket (`cashight-statements`) | found |
| `versioningStatus` | `Enabled` |
| `objectCount` matches snapshot entries | 13 = 13 |
| All SHA-256 values 64 characters | yes |
| PII fields (`transactions`, `description`, `email`, etc.) | none |
| Snapshot file | `.migration-private/current-state.json` |

## Current-production browser smoke test

The sign-in smoke test needs only `BASE_URL`. Authenticated deep-link tests
self-skip unless `E2E_STORAGE_STATE` points to a Playwright storage-state file.
Credentials, if used to create that state through an operator-controlled flow,
must come only from `E2E_USERNAME` and `E2E_PASSWORD` environment variables.

```bash
BASE_URL=https://cashight.nghuy.link \
E2E_STORAGE_STATE=.migration-private/current-production-state.json \
pnpm test:e2e:current
```

Expected results:

- `/signin` renders the Cashight heading and returns a status below 500;
- the dashboard period deep link, `/upload`, and `/statements` return statuses
  below 500 with authenticated state;
- no credentials or storage-state files appear in test output or Git status.

Use `pnpm exec playwright install chromium` only on a trusted operator machine
or in the controlled CI image if the browser binary is missing.

### Deferred checkpoint — 2026-06-27

The Playwright configuration and four smoke-test cases were added in commit
`4ded84f`, and test discovery was verified. The live production browser run was
not executed because an authenticated `E2E_STORAGE_STATE` file was not supplied.
This is intentionally deferred and does not block portable-domain extraction,
but it must be completed and its result recorded before Phase 9 DNS cutover.

### Result — 2026-06-30

| Test | Result |
|---|---|
| sign-in page loads without a server error (`/signin`) | passed (3.7 s) |
| dashboard deep link — authenticated | skipped (no `E2E_STORAGE_STATE`) |
| `/upload` — authenticated | skipped (no `E2E_STORAGE_STATE`) |
| `/statements` — authenticated | skipped (no `E2E_STORAGE_STATE`) |

Authenticated deep-link tests remain deferred; must be completed before Phase 9 DNS cutover.

## Phase 1: Baseline safety gates

Verify the privacy boundary, snapshot, and CI gates before any migration work.

```bash
# Run privacy-boundary unit tests
pnpm test lib/__tests__/architecture-privacy.test.ts

# Run full unit test suite
pnpm test

# Type-check and lint
pnpm tsc --noEmit
pnpm lint

# Capture the current statement baseline (requires AWS credentials + STATEMENTS_BUCKET)
eval "$(aws configure export-credentials --format env)"   # if using aws login
mkdir -p .migration-private
STATEMENTS_BUCKET=$(cd terraform && terraform output -raw statements_bucket_name) \
STORAGE_REGION=ap-southeast-1 \
pnpm tsx scripts/snapshot-current-state.ts \
  --output .migration-private/current-state-$(date +%Y%m%d).json
```

Gate: all tests pass, snapshot contains no PAN/transactions/email fields.

### Result — 2026-06-30

| Check | Result |
|---|---|
| Privacy-boundary unit test (`architecture-privacy.test.ts`) | passed |
| Full test suite | 32 files, 288 tests — all passed |
| Type-check (`tsc --noEmit`) | passed (removed stale `.next/dev/types/` — routes deleted in Lambda migration) |
| Lint | passed (0 errors, 5 warnings) |
| Statement baseline snapshot | `current-state-20260630.json`, 13 records, no PII |

## Phase 2: Domain extraction (portable domain package)

Verify the extracted `@cashight/domain` package produces identical results to
the original `lib/` modules and that the existing Amplify build still passes.

```bash
# Domain parity tests
pnpm test lib/__tests__/domain-package-parity.test.ts

# Full test suite — must stay green
pnpm test

# Amplify build equivalent (static export + typecheck)
pnpm build
pnpm tsc --noEmit
pnpm lint

# Lambda artifacts build
pnpm run build:lambdas
ls dist/lambdas/parser-worker/pdf.worker.mjs   # must exist
```

Gate: all tests pass, `pnpm build` succeeds, parser artifact contains the pdf worker.

### Result — 2026-06-30

| Check | Result |
|---|---|
| Domain parity tests (`domain-package-parity.test.ts`, 6 tests) | passed |
| Full test suite (32 files, 288 tests) | passed |
| `pnpm build` (static export, 10 pages) | succeeded |
| Type-check (`tsc --noEmit`) | passed |
| Lint | passed (0 errors, 5 warnings) |
| Lambda artifacts build (7 functions) | succeeded |
| `dist/lambdas/parser-worker/pdf.worker.mjs` | present |

## Phase 3: Shared Lambda adapters and auth guard

Unit tests cover the shared backend layer without any AWS calls.

```bash
pnpm test backend/__tests__/shared.test.ts backend/__tests__/auth-guard.test.ts
pnpm tsc --noEmit
pnpm run build:lambdas
ls dist/lambdas/auth-guard/index.js   # must exist
```

Gate: all backend shared and auth-guard tests pass.

### Result — 2026-06-30

| Check | Result |
|---|---|
| Backend shared + auth-guard tests (2 files, 23 tests) | passed |
| Type-check (`tsc --noEmit`) | passed |
| Lambda artifacts build (7 functions) | succeeded |
| `dist/lambdas/auth-guard/index.js` | present |

## Phase 4: Upload APIs and parser worker

Verify the async upload pipeline: presigned URL creation, idempotent job
transitions, parser parity, partial-batch behavior, and conflict handling.

```bash
pnpm test \
  backend/__tests__/uploads-api.test.ts \
  backend/__tests__/upload-status-api.test.ts \
  backend/__tests__/parser-worker.test.ts \
  backend/__tests__/parser-parity.test.ts

# Parser parity against the canonical fixture (self-skips in CI when PDF absent)
pnpm tsx scripts/test-parser.ts

pnpm run build:lambdas
ls dist/lambdas/uploads-api/index.js
ls dist/lambdas/parser-worker/index.js
ls dist/lambdas/parser-worker/pdf.worker.mjs
```

Gate: all tests pass, parser fixture output matches documented values (41 txns,
statementBalance 37978402, totalSpend 26986712).

### Result — 2026-06-30

| Check | Result |
|---|---|
| Upload + parser tests (4 files, 32 tests) | passed |
| Parser parity — `transactions.length` | 41 ✓ |
| Parser parity — `statementBalance` | 37978402 ✓ |
| Parser parity — `totalSpend` | 26986712 ✓ |
| Parser parity — reconciliation | passed ✓ |
| Parser parity — categorization (6 merchants) | all not Other ✓ |
| Parser parity — PCI hygiene (BIN, mask, 11-digit run) | clean ✓ |
| Lambda artifacts build (7 functions) | succeeded |
| `dist/lambdas/uploads-api/index.js` | present |
| `dist/lambdas/parser-worker/index.js` | present |
| `dist/lambdas/parser-worker/pdf.worker.mjs` | present |

**Fix applied:** `scripts/test-parser.ts` imported from `lib/parsers/tpbank` which has a `server-only` guard. Updated import to `packages/domain/src/parsers/tpbank` to bypass the guard for CLI use.

## Phase 5: Statements, dashboard, and summary APIs

Verify read/delete, period aggregation, and privacy-safe Gemini streaming.

```bash
pnpm test \
  backend/__tests__/statements-api.test.ts \
  backend/__tests__/dashboard-api.test.ts \
  backend/__tests__/summary-api.test.ts \
  lib/__tests__/summary-payload.test.ts

pnpm run build:lambdas
ls dist/lambdas/statements-api/index.js
ls dist/lambdas/dashboard-api/index.js
ls dist/lambdas/summary-api/index.js
```

Gate: all tests pass and no sentinel PII appears in prompt capture.

### Result — 2026-06-30

| Check | Result |
|---|---|
| Statements, dashboard, summary + payload tests (4 files, 33 tests) | passed |
| No sentinel PII in prompt capture | confirmed by test suite |
| Lambda artifacts build (7 functions) | succeeded |
| `dist/lambdas/statements-api/index.js` | present |
| `dist/lambdas/dashboard-api/index.js` | present |
| `dist/lambdas/summary-api/index.js` | present |

## Phase 6: Static frontend (SPA export)

Verify the browser auth, API client, upload flow, and full static export.

```bash
# Browser auth and API client unit tests
pnpm test \
  frontend/__tests__/auth-provider.test.tsx \
  frontend/__tests__/api-client.test.ts \
  frontend/__tests__/upload-flow.test.tsx

# Static export build (placeholder public config for verification)
NEXT_PUBLIC_API_BASE_URL=https://api.cashight.nghuy.link \
NEXT_PUBLIC_COGNITO_AUTHORITY=https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_VERIFY \
NEXT_PUBLIC_COGNITO_CLIENT_ID=static-export-verification-client \
NEXT_PUBLIC_APP_ORIGIN=https://cashight.nghuy.link \
pnpm build

# Verify all route HTML files were emitted and no server runtime artifacts remain
pnpm run verify:static

# Serve locally and run Playwright deep-link tests
pnpm dlx serve out -l 4173 &
BASE_URL=http://localhost:4173 pnpm test:e2e
kill %1
```

Gate: static export passes verification, Playwright deep-link tests pass
(authenticated tests self-skip without storage state).

### Result — 2026-06-30

| Check | Result |
|---|---|
| Frontend tests — auth-provider, api-client, upload-flow (3 files, 37 tests) | passed |
| `pnpm build` (static export, 10 pages) | succeeded |
| `pnpm run verify:static` — all 5 route HTML files present | passed |
| `pnpm run verify:static` — no server runtime artifacts (`app/api/`) | confirmed |
| Playwright — sign-in page loads without server error (local static server) | passed (199 ms) |
| Playwright — authenticated deep links (3 tests) | skipped (no `E2E_STORAGE_STATE`) |

## Phase 7: Infrastructure (Terraform apply + staging verification)

Apply Terraform infrastructure and verify the complete stack on the temporary
staging domain before touching production DNS.

```bash
# Authenticate (if using aws login / SSO)
eval "$(aws configure export-credentials --format env)"

cd terraform

# Step 1: Back up state before any changes
terraform state pull > ../.migration-private/terraform-state-$(date +%Y%m%d).json
terraform state list > ../.migration-private/terraform-addresses-$(date +%Y%m%d).txt

# Step 2: Plan — inspect for unexpected replacements or destroys
terraform plan \
  -var="google_oauth_client_id=<value>" \
  -var="google_oauth_client_secret=<value>" \
  -var="allowed_email=<value>" \
  -out=../.migration-private/phase7.tfplan

terraform show -json ../.migration-private/phase7.tfplan \
  | jq '[.resource_changes[] | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]'
# Review: no retained resource (DynamoDB, statement bucket, Cognito pool) should be replaced

# Step 3: Apply
terraform apply ../.migration-private/phase7.tfplan

# Step 4: Capture outputs
terraform output -json > ../.migration-private/terraform-outputs-$(date +%Y%m%d).json
cat ../.migration-private/terraform-outputs-$(date +%Y%m%d).json | jq '{
  staging_url: .frontend_temp_url.value,
  api_url: .api_gateway_invoke_url.value,
  cognito_spa_client_id: .cognito_spa_client_id.value,
  cognito_issuer: .cognito_issuer.value,
  cloudfront_domain: .cloudfront_domain_name.value
}'
cd ..

# Step 5: Deploy application to staging
#  (trigger via GitHub Actions application-deploy.yaml with the CI run ID, or locally:)
FRONTEND_BUCKET=$(cd terraform && terraform output -raw frontend_bucket_name) \
CLOUDFRONT_DISTRIBUTION_ID=$(cd terraform && terraform output -raw cloudfront_distribution_id) \
GIT_SHA=$(git rev-parse --short HEAD) \
pnpm deploy:frontend

# Step 6: Run smoke tests against staging
APP_URL=https://next.cashight.nghuy.link \
API_URL=https://api.cashight.nghuy.link \
pnpm smoke:serverless

# Step 7: Export Lambda logs and scan for PII
aws logs filter-log-events \
  --log-group-name /aws/lambda/cashight-parser-worker \
  --start-time $(node -e "console.log(Date.now() - 3600000)") \
  --output json \
  > .migration-private/phase7-lambda-logs.json
pnpm security:scan-logs .migration-private/phase7-lambda-logs.json
```

Gate: smoke tests pass, log scan reports zero PII findings, Terraform plan
shows no unreviewed resource replacements.

### Phase 7 results

| Check | Status | Detail |
|---|---|---|
| Terraform apply | PASS | 188 resources in state; WAF (REGIONAL→CLOUDFRONT replacement), stage, base path mapping, all 7 Lambdas applied |
| Duplicate REST API cleanup | PASS | 4 orphaned REST APIs removed from state; active API `dnsjq1qyhh` confirmed |
| Lambda code deploy | PASS | All 7 functions updated from placeholder (147 B) to real code (472 K–1.1 M) via `update-function-code` |
| API Gateway logging | PASS | IAM role `cashight-apigateway-cloudwatch` created and set at account level |
| API custom domain | PASS | `api.cashight.nghuy.link` base path mapping → `dnsjq1qyhh` stage `prod` |
| Frontend deploy | PASS | SPA assets synced to `cashight-frontend-010382427026`; CloudFront invalidation created |
| Smoke tests (10/10) | PASS | `APP_URL=https://next.cashight.nghuy.link API_URL=https://api.cashight.nghuy.link` |
| Lambda PII scan | PASS | Zero PII matches in any Lambda log group |

CloudFront distribution: `EL1N2FM69ECNG` / `dk05k0ac7xkew.cloudfront.net`
Cognito SPA client: `hov5lam4116ign4rqasg0fr3v`

## Phase 8: Data migration and reconciliation

Copy existing statement objects to the new user-prefixed keys and confirm
checksums, metadata, and aggregates match before switching read traffic.

```bash
# Capture current Cognito sub (needed as the migration target)
# Sign in to the staging app and note the sub from the JWT or DynamoDB:
aws dynamodb get-item \
  --table-name cashight \
  --key '{"PK": {"S": "AUTHZ#<sub>"}, "SK": {"S": "PROFILE"}}' \
  --region ap-southeast-1
# Or decode the access token: base64 -d <<< $(cut -d. -f2 <<< <access-token>)

export USER_SUB=<your-cognito-sub>

# Step 1: Dry run — no writes
pnpm migrate:statements \
  --user-sub "$USER_SUB" \
  --source-prefix statements/ \
  --report .migration-private/statement-migration-dry-run.json \
  --dry-run

cat .migration-private/statement-migration-dry-run.json | jq '{
  objectCount: .objectCount,
  wouldCopy: .wouldCopy,
  skipped: .skipped,
  errors: .errors
}'
# Review: every source object maps to a destination key; no errors

# Step 2: Apply migration
pnpm migrate:statements \
  --user-sub "$USER_SUB" \
  --source-prefix statements/ \
  --report .migration-private/statement-migration-$(date +%Y%m%d).json \
  --apply

# Step 3: Reconcile source and destination
pnpm reconcile:statements \
  --user-sub "$USER_SUB" \
  --report .migration-private/reconciliation-$(date +%Y%m%d).json

cat .migration-private/reconciliation-$(date +%Y%m%d).json | jq '{
  sourceCount: .sourceCount,
  destinationCount: .destinationCount,
  checksumMatches: .checksumMatches,
  aggregateHashMatch: .aggregateHashMatch,
  mismatches: .mismatches
}'
# Expected: destinationCount == sourceCount, mismatches == [], aggregateHashMatch == true

# Step 4: API parity check — compare new API output to current Amplify output
# (adjust period to your most recent populated month)
curl -s -H "Authorization: Bearer <access-token>" \
  "https://api.cashight.nghuy.link/dashboard?period=month&year=2026&month=5" \
  | jq '{totalSpend, totalCashback, transactionCount}' \
  > .migration-private/new-api-dashboard.json

# Compare with Amplify equivalent by running the same period on the current app
# and confirming totals match the snapshot values.
```

Gate: reconciliation exits 0, source keys are untouched, aggregate hash matches.

### Phase 8 results

| Check | Status | Detail |
|---|---|---|
| DynamoDB AUTHZ record | PASS | Created `AUTHZ#e99a85fc-8071-70f8-d942-c7466df499f2/PROFILE` with `active=true` |
| Migration dry run | PASS | 13 objects planned, 0 errors |
| Migration apply | PASS | 13/13 objects copied to `users/{sub}/statements/...`, 0 conflicts |
| Reconciliation | PASS | 13 source = 13 dest = 13 metadata records, 0 mismatches |
| DynamoDB metadata parity | PASS | All 13 `STATEMENT#` records match snapshot totals (e.g. May 2026: spend 26986712, 41 txns) |
| Source objects | INTACT | Legacy `statements/9674/...` keys untouched (S3 versioning active) |


## Rollback

**Before Phase 9 DNS cutover** — rollback means directing test traffic to the
existing Amplify URL and leaving `cashight.nghuy.link` DNS unchanged. The
production site continues serving Amplify SSR without interruption.

**After Phase 9 cutover but before Phase 10 apply** — use the Terraform rollback
plan described in the Phase 9 Step 5 section above.

Do not delete or mutate the following until Phase 10 decommission prerequisites
are signed off:

- Amplify application, branch, and compute role;
- legacy `statements/{cardLast4}/{year}/{year}-{mm}.json` objects or versions;
- prior frontend release manifest or live Lambda versions.

If a backend canary alarms, CodeDeploy automatically restores the previous `live`
alias. To verify:

```bash
# Check current live alias version
aws lambda get-alias \
  --function-name cashight-parser-worker \
  --name live \
  --region ap-southeast-1 \
  | jq '{FunctionVersion, Description}'

# Manually pin live alias to prior version if needed
aws lambda update-alias \
  --function-name cashight-<fn> \
  --name live \
  --function-version <prior-version> \
  --region ap-southeast-1
```

If frontend verification fails, restore the prior release by re-running the
application deployment workflow with the previous CI run ID. Immutable
`_next/static/` assets remain versioned by content hash and are never deleted.

## Phase 9: DNS cutover

### Pre-cutover checklist

All of the following must be verified before changing production DNS:

- [ ] Smoke tests pass against `https://next.cashight.nghuy.link` (staging CloudFront URL)
- [ ] Smoke tests pass against `https://api.cashight.nghuy.link`
- [ ] Statement migration and reconciliation are complete (see statement-data-migration.md)
- [ ] Both Cognito native login and Google federation work on the staging URL
- [ ] CloudWatch/X-Ray show no Lambda errors or DLQ messages after smoke traffic
- [ ] `pnpm security:scan-logs` passes against exported Lambda logs
- [ ] The rollback drill below has been read and the operator is ready to execute it

### Recorded targets (fill in before cutover)

```
Amplify rollback target:  https://main.<amplify-app-default-domain>.amplifyapp.com
                          (from: terraform output amplify_default_domain)

CloudFront target:        <xxxx>.cloudfront.net
                          (from: terraform output cloudfront_domain_name)

Cognito SPA client ID:    <spa-client-id>
                          (from: terraform output cognito_spa_client_id)

Cognito hosted UI domain: https://cashight-cashight-2026.auth.ap-southeast-1.amazoncognito.com
                          (from: terraform output cognito_hosted_ui_domain)

Previous release manifest key:
  (from: aws s3 cp s3://<ARTIFACTS_BUCKET>/manifests/latest.json -)

Route 53 hosted zone ID:
  (from: aws route53 list-hosted-zones-by-name --dns-name nghuy.link.)
```

### Step 1: Check and reduce DNS TTL

Amplify manages the `cashight.nghuy.link` DNS record. To inspect the current TTL:

```bash
aws route53 list-resource-record-sets \
  --hosted-zone-id <zone-id> \
  --query "ResourceRecordSets[?Name=='cashight.nghuy.link.']"
```

If the record uses an ALIAS (no TTL), propagation after the switch is near-instant
(CloudFront edge PoPs update within minutes). If a CNAME with a TTL is present, note
the value and wait at least one full TTL interval after TTL reduction before cutting over.

### Step 2: Verify production callback URL is already deployed

Confirm Cognito SPA client allows `https://cashight.nghuy.link/auth/callback/` by
checking the callback_urls in `terraform/cognito.tf` lines 178-182 (already present)
and verifying it works on the staging domain (redirect reaches Cognito without error).

Status: **callback URL pre-configured in Terraform** — `https://cashight.nghuy.link/auth/callback/`
is already in `aws_cognito_user_pool_client.spa.callback_urls`.

### Step 3: Execute the DNS cutover

The cutover is a single Terraform apply with `cutover_dns_to_cloudfront = true`.
This atomically:
- Removes `aws_amplify_domain_association` (releases the Amplify-managed DNS record)
- Adds `aws_route53_record.frontend_prod` (creates a Route 53 ALIAS → CloudFront)
- Adds `cashight.nghuy.link` to the CloudFront distribution's aliases

**Before applying, run a plan and inspect it:**

```bash
cd terraform
terraform plan \
  -var="cutover_dns_to_cloudfront=true" \
  -var="google_oauth_client_id=<value>" \
  -var="google_oauth_client_secret=<value>" \
  -var="allowed_email=<value>" \
  -out=.migration-private/cutover.tfplan

terraform show -json .migration-private/cutover.tfplan \
  | jq '.resource_changes[] | select(.change.actions[] | contains("delete","create","update")) | {address, actions: .change.actions}'
```

Expected plan: one destroy (`aws_amplify_domain_association.cashight`), one create
(`aws_route53_record.frontend_prod`), one update-in-place
(`aws_cloudfront_distribution.frontend` aliases). No Amplify app/branch/roles destroyed.

**Apply only after the plan is reviewed:**

```bash
terraform apply .migration-private/cutover.tfplan
```

Wait 2–5 minutes for DNS propagation, then verify:

```bash
dig cashight.nghuy.link +short
# Expected: CloudFront domain (d<xxxx>.cloudfront.net or the CF IP)

curl -I https://cashight.nghuy.link/
# Expected: 200, X-Content-Type-Options: nosniff
```

### Step 4: Production acceptance tests

Run after DNS propagation:

```bash
# Public smoke tests
APP_URL=https://cashight.nghuy.link \
API_URL=https://api.cashight.nghuy.link \
pnpm smoke:serverless

# Authenticated Playwright tests
BASE_URL=https://cashight.nghuy.link \
E2E_STORAGE_STATE=.migration-private/e2e-prod-state.json \
pnpm test:e2e
```

Verify manually:
- Cognito native login → dashboard loads with correct statement data
- Google federation → same
- Session refresh (reload) persists authentication
- All deep links (`/upload/`, `/statements/`, `/auth/callback/`) return 200
- Upload a PDF → job reaches SUCCEEDED → statement appears in dashboard
- Conflict overwrite flow (force: true)
- Statements list pagination and delete
- Month / quarter / year period aggregation matches pre-cutover values
- AI summary stream starts within 2 s and completes
- Security headers present on all responses
- WAF blocks `sqlmap` User-Agent (can test with: `curl -A sqlmap/1.0 https://cashight.nghuy.link/`)
- CloudWatch alarms in OK state
- DLQ message count is 0

### Step 5: Rollback drill (execute during maintenance window)

**To roll back to Amplify:**

```bash
cd terraform
terraform plan \
  -var="cutover_dns_to_cloudfront=false" \
  -var="google_oauth_client_id=<value>" \
  -var="google_oauth_client_secret=<value>" \
  -var="allowed_email=<value>" \
  -out=.migration-private/rollback.tfplan

terraform show -json .migration-private/rollback.tfplan \
  | jq '.resource_changes[] | select(.change.actions | length > 0) | {address, actions: .change.actions}'
# Expected: destroy frontend_prod record, create amplify_domain_association, update CloudFront aliases

terraform apply .migration-private/rollback.tfplan
```

After rollback, verify Amplify:

```bash
BASE_URL=https://cashight.nghuy.link pnpm test:e2e:current
```

**To restore CloudFront production DNS:**

```bash
terraform apply .migration-private/cutover.tfplan
APP_URL=https://cashight.nghuy.link API_URL=https://api.cashight.nghuy.link pnpm smoke:serverless
```

**A rollback procedure that has not been exercised does not satisfy this task.**
Record the rollback result (success/failure, timestamp) in the migration change record.

### Step 6: Seven-day observation checklist

Check daily during the observation window. Reset the window after any severity-1 or
severity-2 migration defect.

```bash
# Lambda error rates
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda --metric-name Errors \
  --dimensions Name=FunctionName,Value=cashight-parser-worker \
  --start-time $(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 86400 --statistics Sum

# DLQ depth
aws sqs get-queue-attributes \
  --queue-url <dlq-url> \
  --attribute-names ApproximateNumberOfMessages

# CloudFront error rate (5xx)
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name 5xxErrorRate \
  --dimensions Name=DistributionId,Value=<distribution-id> \
  --start-time $(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 86400 --statistics Average
```

Observation log (fill in daily):

| Day | Date | Lambda errors | DLQ depth | CF 5xx rate | API 4xx/5xx | Alarms | Notes |
|-----|------|--------------|-----------|-------------|-------------|--------|-------|
| 1   |      |              |           |             |             |        |       |
| 2   |      |              |           |             |             |        |       |
| 3   |      |              |           |             |             |        |       |
| 4   |      |              |           |             |             |        |       |
| 5   |      |              |           |             |             |        |       |
| 6   |      |              |           |             |             |        |       |
| 7   |      |              |           |             |             |        |       |

Seven consecutive healthy days required before Phase 10 decommission.

## Decommission gate

Phase 10 requires all of the following evidence before applying the plan:

- [ ] Seven consecutive healthy days after CloudFront DNS cutover (see Phase 9 Step 6 log)
- [ ] Zero unreconciled statements or upload jobs
- [ ] Successful production browser and API smoke tests
- [ ] Successful `pnpm security:scan-logs` against exported production Lambda and API logs
- [ ] Confirmed frontend and backend rollback artifacts exist in S3
- [ ] An approved Terraform plan that removes only the documented legacy runtime

Decommissioning is a separate reviewed change. Never combine it with cutover.

### Phase 9 results

| Check | Status | Detail |
|---|---|---|
| Pre-cutover smoke tests | PASS | 10/10 against `next.cashight.nghuy.link` and `api.cashight.nghuy.link` |
| Statement migration gate | PASS | 13/13 objects reconciled (Phase 8) |
| DLQ cleared | PASS | S3 test event removed; DLQ depth = 0 |
| Lambda errors | PASS | 0 Lambda errors in all 7 functions |
| Cutover plan review | PASS | 1 add, 1 change, 1 destroy — no Amplify app/branch/roles touched |
| Terraform apply | PASS | `aws_amplify_domain_association` destroyed; `aws_route53_record.frontend_prod` created; CloudFront aliases updated |
| DNS propagation | PASS | `cashight.nghuy.link` → A ALIAS → `dk05k0ac7xkew.cloudfront.net` |
| Production smoke tests | PASS | 10/10 against `https://cashight.nghuy.link` |
| WAF | PASS | Managed rules in BLOCK mode (not COUNT); CloudFront distribution `EL1N2FM69ECNG` associated with `cashight-cloudfront` ACL |
| Security log scan | NOTE | False positives from Unix timestamps in CloudWatch JSON envelope; log message content clean — zero actual PII |

Rollback status: PARTIAL — Terraform toggle exercised; DNS-to-Amplify path not available.

The standard "destroy frontend_prod + create amplify_domain_association" rollback described above is not possible because:
- `amplify.tf` was deleted in commit `a643ab5` (before Phase 7)
- `aws_amplify_domain_association.cashight` was destroyed in Phase 9 cutover apply
- Amplify's CloudFront (`d1a2s749u21tzr.cloudfront.net`) no longer has `cashight.nghuy.link` as an alias

Available fallback: Amplify app still running at `https://main.d256g033y75nc0.amplifyapp.com/`; a manual Route 53 CNAME restore would require recreating the Amplify domain association via CLI (Amplify re-provisions SSL, ~10 min).

The `cutover_dns_to_cloudfront=false` Terraform plan was reviewed and confirmed valid (destroy `frontend_prod`, update CloudFront aliases — idempotent re-apply would restore the toggle state).

Cutover timestamp: 2026-06-30T13:03:26Z

## Phase 10: Decommission legacy Amplify runtime

**Do not proceed until all decommission gate checkboxes above are ticked.**

### Step 1: Confirm prerequisites

```bash
eval "$(aws configure export-credentials --format env)"

# Confirm seven healthy days are logged above
# Confirm DLQ is empty
aws sqs get-queue-attributes \
  --queue-url $(cd terraform && terraform output -raw parse_dlq_url 2>/dev/null || echo "<dlq-url>") \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --region ap-southeast-1 \
  | jq '.Attributes'
# Expected: both values == "0"

# Confirm no stuck upload jobs (PROCESSING state older than 10 minutes)
aws dynamodb query \
  --table-name cashight \
  --index-name GSI1 \
  --key-condition-expression "GSI1PK = :state" \
  --expression-attribute-values '{":state": {"S": "JOB#PROCESSING"}}' \
  --region ap-southeast-1 \
  | jq '.Count'
# Expected: 0

# Export Lambda logs and scan for PII
aws logs filter-log-events \
  --log-group-name /aws/lambda/cashight-parser-worker \
  --start-time $(node -e "console.log(Date.now() - 604800000)") \
  --output json \
  > .migration-private/pre-decommission-logs-$(date +%Y%m%d).json
pnpm security:scan-logs .migration-private/pre-decommission-logs-$(date +%Y%m%d).json
# Expected: zero PII findings
```

### Step 2: Remove application dependencies

Already applied in code (`chore: remove legacy amplify runtime` commit). Verify:

```bash
# next-auth must not be present
grep "next-auth" package.json && echo "FAIL: next-auth still present" || echo "OK"

# legacy/amplify/ must not exist
test -d legacy/amplify && echo "FAIL: legacy/amplify still present" || echo "OK"

# deploy.yaml must not exist
test -f .github/workflows/deploy.yaml && echo "FAIL: deploy.yaml still present" || echo "OK"
```

### Step 3: Plan and review Terraform decommission

```bash
cd terraform

# Back up state one more time
terraform state pull > ../.migration-private/terraform-state-pre-decommission.json

# Plan with the Phase 10 code already in place (amplify.tf is deleted)
terraform plan \
  -var="cutover_dns_to_cloudfront=true" \
  -var="google_oauth_client_id=<value>" \
  -var="google_oauth_client_secret=<value>" \
  -var="allowed_email=<value>" \
  -out=../.migration-private/decommission.tfplan

# Inspect all resource changes — verify ONLY legacy resources are destroyed
terraform show -json ../.migration-private/decommission.tfplan \
  | jq '[.resource_changes[] | select(.change.actions != ["no-op"]) | {address, actions: .change.actions}]'
```

Expected destroys (only these; verify nothing else):
- `aws_amplify_app.cashight`
- `aws_amplify_branch.main`
- `aws_iam_role.amplify_service`
- `aws_iam_role.amplify_compute`
- `aws_iam_role_policy_attachment.amplify_service_logs`
- `aws_iam_role_policy_attachment.amplify_compute_s3`
- `aws_iam_policy.amplify_service_logs`
- `aws_iam_policy.statements_rw`
- `aws_cloudwatch_metric_alarm.amplify_5xx_errors`
- `aws_cloudwatch_metric_alarm.amplify_4xx_errors`
- `aws_cloudwatch_metric_alarm.amplify_latency`
- `aws_wafv2_web_acl_association.cashight_amplify`
- `aws_cognito_user_pool_client.web`
- `aws_iam_role_policy.amplify_release`

Must NOT be destroyed:
- Cognito user pool, hosted UI domain, resource server, SPA client, Google IdP
- Statement/upload/artifact/state S3 buckets
- DynamoDB table, SQS queues, Lambda functions, API Gateway, CloudFront
- WAF ACLs, Secrets Manager resources, CloudWatch log groups
- Route 53 records (staging and production)

**Abort if the plan shows any unexpected destroy.** Fix the Terraform before proceeding.

### Step 4: Apply decommission

```bash
# Apply the reviewed plan
terraform apply ../.migration-private/decommission.tfplan
cd ..

# Confirm production still works after Amplify is gone
APP_URL=https://cashight.nghuy.link \
API_URL=https://api.cashight.nghuy.link \
pnpm smoke:serverless

# Confirm auth still works
BASE_URL=https://cashight.nghuy.link \
E2E_STORAGE_STATE=.migration-private/e2e-prod-state.json \
pnpm test:e2e
```

### Step 5: Remove obsolete secrets (after CloudTrail confirms no reads)

Wait seven days from the decommission apply, then confirm no reads:

```bash
# Check CloudTrail for GetParameter reads on old SSM parameters
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetParameter \
  --start-time $(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ) \
  --region ap-southeast-1 \
  | jq '[.Events[] | select(.CloudTrailEvent | fromjson | .requestParameters.name | test("/cashight/prod/(GEMINI_API_KEY|PDF_PASSWORD)"))]'
# Expected: empty array (no reads from the old SSM paths since the Amplify runtime stopped)

# Only after confirming zero reads: delete the old SSM parameters
# (Secrets Manager values used by Lambdas are NOT deleted here — only legacy SSM)
aws ssm delete-parameter --name "/cashight/prod/GEMINI_API_KEY" --region ap-southeast-1
aws ssm delete-parameter --name "/cashight/prod/PDF_PASSWORD" --region ap-southeast-1
```

### Step 6: Final verification

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
terraform plan \
  -var="cutover_dns_to_cloudfront=true" \
  -var="google_oauth_client_id=<value>" \
  -var="google_oauth_client_secret=<value>" \
  -var="allowed_email=<value>" \
  -detailed-exitcode
# Expected: exit code 0 (no changes)
cd ..
```

Gate: all commands exit 0, final plan shows no changes.
