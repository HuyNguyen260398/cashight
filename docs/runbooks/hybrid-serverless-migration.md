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

## Phase gates

Complete each phase in the implementation plan in order. Record the Git SHA,
Terraform plan artifact, deployment identifier, verification results, and
rollback result in the migration change record.

1. Baseline: unit privacy gates, snapshot, lint, and typecheck pass.
2. Domain extraction: Amplify build and financial parity remain unchanged.
3. Shared backend: authorization, ownership, storage-key, and log-redaction
   tests pass without AWS calls.
4. Upload pipeline: direct upload, conflict, idempotency, retry, and DLQ tests
   pass; uploaded PDFs are deleted or expire.
5. Read and summary APIs: statement/dashboard parity and Gemini privacy tests
   pass, including streaming behavior.
6. Static frontend: PKCE login, callback, logout, refresh, deep links, and
   static export pass without a Next.js server runtime.
7. Infrastructure: remote-state controls are applied before Cognito Google IdP
   secrets enter Terraform state; WAF, alarms, IAM, encryption, and deployment
   aliases are verified.
8. Data migration: every source item reconciles by safe metadata and hash;
   legacy keys remain intact.
9. Cutover: pre-cutover smoke and rollback rehearsals pass before DNS changes.
10. Observation: maintain seven consecutive healthy production days before
    requesting legacy decommissioning.

## Rollback

Before DNS cutover, rollback means routing test traffic back to the existing
Amplify URL and leaving production DNS unchanged. After cutover, use the
Terraform-managed rollback record to restore the prior DNS target, then run the
current-production smoke test against the restored endpoint.

Do not delete or mutate the following during the rollback window:

- Amplify application, branch, compute role, or environment configuration;
- Auth.js configuration and confidential Cognito app client;
- legacy `statements/{cardLast4}/{year}/{year}-{mm}.json` objects or versions;
- existing SSM parameters used by Amplify;
- prior frontend release manifest or live Lambda versions.

If a backend canary alarms, allow CodeDeploy to restore the previous `live`
alias and verify API health before retrying. If frontend verification fails,
restore the prior HTML release and invalidate HTML paths only; immutable assets
remain versioned by content hash.

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

Phase 10 requires all of the following evidence:

- seven consecutive healthy days after CloudFront DNS cutover;
- zero unreconciled statements or upload jobs;
- successful production browser and API smoke tests;
- successful `pnpm security:scan-logs` against exported production Lambda and
  API logs;
- confirmed frontend and backend rollback artifacts;
- an approved Terraform plan that removes only the documented legacy runtime.

Decommissioning is a separate reviewed change. Never combine it with cutover.
