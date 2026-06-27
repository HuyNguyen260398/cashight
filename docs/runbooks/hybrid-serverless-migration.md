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
