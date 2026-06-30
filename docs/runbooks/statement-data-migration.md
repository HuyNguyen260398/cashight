# Statement Data Migration Runbook

Migrates legacy statement objects from `statements/{cardLast4}/{year}/{year}-{mm}.json`
to `users/{sub}/statements/{cardLast4}/{year}/{year}-{mm}.json` and writes DynamoDB
ownership metadata. Never deletes source objects.

## Prerequisites

1. **Terraform applied** — DynamoDB table (`TABLE_NAME`) and AUTHZ record must exist.
2. **AUTHZ record active** — The user's `AUTHZ#{sub}/PROFILE` record must be present in
   DynamoDB with `active = true` (created by `auth-guard` on first sign-in).
3. **AWS credentials** — Must have S3 read+write and DynamoDB read+write on the app resources.
4. **`.migration-private/` exists** — Reports are written here and are gitignored.

```bash
mkdir -p .migration-private
chmod 700 .migration-private
```

## Step 1: Snapshot current state

```bash
STATEMENTS_BUCKET=<bucket> pnpm tsx scripts/snapshot-current-state.ts \
  --output .migration-private/pre-migration-snapshot.json
```

Review: check object count and statement dates are what you expect.

## Step 2: Dry run

```bash
STATEMENTS_BUCKET=<bucket> TABLE_NAME=<table> \
  pnpm tsx scripts/migrate-statements.ts \
  --user-sub <cognito-sub> \
  --source-prefix statements/ \
  --report .migration-private/statement-migration-dry-run.json \
  --dry-run
```

Review the report:
- Every entry should have `outcome: "would-copy"`
- `planned` should match the snapshot `objectCount`
- `errors` should be empty

## Step 3: Apply migration

```bash
STATEMENTS_BUCKET=<bucket> TABLE_NAME=<table> \
  pnpm tsx scripts/migrate-statements.ts \
  --user-sub <cognito-sub> \
  --source-prefix statements/ \
  --report .migration-private/statement-migration.json \
  --apply
```

Expected output:
```
Planned:   N
Copied:    N
Skipped:   0
Conflicts: 0
Errors:    0
```

Exit code 0 = success. Exit code 1 = errors or conflicts (check report).

**If interrupted:** Re-running `--apply` is safe. Already-copied objects are detected by
comparing SHA-256 and skipped (`outcome: "already-migrated"`).

## Step 4: Reconcile

```bash
STATEMENTS_BUCKET=<bucket> TABLE_NAME=<table> \
  pnpm tsx scripts/reconcile-statements.ts \
  --user-sub <cognito-sub> \
  --report .migration-private/reconciliation.json
```

Expected output:
```
Result: PASSED
```

Exit code 0 = all checksums match, all metadata present, aggregates equal.
Exit code 1 = review `reconciliation.json` for mismatch details.

## Step 5: Verify API parity

With a valid Cognito access token (obtained via sign-in on the new Cognito SPA client):

```bash
# New API
curl -H "Authorization: Bearer <token>" \
  https://api.cashight.nghuy.link/statements | jq '.items | length'

# Compare with legacy Amplify output
curl https://cashight.nghuy.link/api/statements | jq '. | length'
```

The statement count must match. Spot-check totals and transaction counts for a few months.

## Rollback

Source objects are never deleted. To roll back:
1. Delete DynamoDB records under `USER#<sub>` (optional — they're harmless).
2. Delete migrated S3 objects under `users/<sub>/statements/` (optional).
3. Switch traffic back to Amplify DNS.

Source objects remain unchanged throughout the entire migration and rollback window.

## Reports

All report files are written to `.migration-private/` with mode `0600` and are gitignored.
Back up reports to an encrypted external location before proceeding to Phase 9 cutover.

## Finding your Cognito sub

The Cognito sub is the stable UUID-format user identifier from the JWT. To retrieve it:

```bash
# From the browser: inspect the access token at jwt.io
# Or from AWS CLI:
aws cognito-idp list-users \
  --user-pool-id <pool-id> \
  --filter "email = \"your@email.com\"" \
  --query 'Users[0].Username'
```
