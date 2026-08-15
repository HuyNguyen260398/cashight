# Workspace Ownership Migration Runbook

This runbook copies statement objects and DynamoDB metadata from one legacy
Cognito-subject partition into Cashight workspace `primary`. The migration is
copy-only: it has no delete mode and leaves every legacy object and metadata
record available for rollback.

## Prerequisites

- Deploy the Step 30 authorization and workspace storage code first.
- Set `ENABLE_LEGACY_AUTHZ_FALLBACK=true` on request-authorizing Lambdas.
- Set `ENABLE_LEGACY_WORKSPACE_FALLBACK=true` on statement APIs and the parser
  worker for the migration window.
- Export `STATEMENTS_BUCKET`, `TABLE_NAME`, and `STORAGE_REGION` for the target
  environment. Local AWS credentials must be able to list/read/copy statement
  objects and get/put statement metadata.
- Obtain the current Cognito subject out of band. Do not put it in shell
  history, tickets, logs, or this document.

Keep the subject in a temporary shell variable:

```bash
read -r CASHIGHT_SOURCE_SUB
export CASHIGHT_SOURCE_SUB
```

## 1. Dry run

Always run and retain the sanitized dry-run report before applying:

```bash
pnpm migrate:workspace --dry-run --source-sub "$CASHIGHT_SOURCE_SUB"
```

The command performs no writes. Confirm:

- `invalid` and `conflicts` are zero;
- `planned` equals `validated`;
- operations are sorted and every destination begins with
  `users/primary/statements/`;
- metadata destinations use `WORKSPACE#primary`;
- output contains `[source-sub]`, never the real subject or statement content.

Stop if any validation fails. Correct the source object or legacy metadata
instead of bypassing validation.

Record the sanitized summary alongside the deployment change. The dry run is
an operator action because `CASHIGHT_SOURCE_SUB` is intentionally never stored
in CI, Terraform variables, repository files, or application logs.

## 2. Apply the copy

The apply command requires the exact confirmation flag:

```bash
pnpm migrate:workspace --apply --source-sub "$CASHIGHT_SOURCE_SUB" --confirm-copy-to-primary
```

Apply refuses to overwrite destination content with a different SHA-256. It
conditionally writes workspace metadata and then rereads the destination
object and metadata to verify schema, ownership, and hash. Re-running the same
command is safe; matching destinations report `ALREADY_PRESENT`.

## 3. Validate

Before changing feature flags:

1. Re-run the dry run and confirm deterministic object counts and hashes.
2. Confirm apply reports `conflicts: 0`, `invalid: 0`, and
   `planned = copied + alreadyPresent`.
3. Compare the legacy and workspace statement counts by month and card suffix.
4. Sign in with the native Cognito identity and verify Dashboard and Statements
   totals for month, quarter, and year periods.
5. Sign in with the Google identity and verify it sees the same workspace data.
6. Check the `LegacyWorkspaceFallback` and `LegacyAuthzFallback` metrics. New
   requests should stop incrementing after all records are backfilled.

## 4. Disable compatibility flags

After authorization-record backfill and the validation above pass, deploy:

```hcl
enable_legacy_authz_fallback      = false
enable_legacy_workspace_fallback = false
```

Repeat the native and Google dashboard checks after deployment. Keep the
legacy data unchanged during the observation window.

## Deployment smoke check

Create a short-lived Cognito-native access token out of band, then run:

```bash
APP_URL=https://cashight.nghuy.link \
API_URL=https://api.cashight.nghuy.link \
SMOKE_NATIVE_ACCESS_TOKEN="$SMOKE_NATIVE_ACCESS_TOKEN" \
pnpm smoke:serverless
```

The authenticated check must return exactly `{ "canViewAwsCosts": true }`.
The script never prints the token. Without the optional token it still verifies
that the capabilities route rejects unauthenticated requests, and explicitly
reports the authenticated check as skipped.

## Rollback

If workspace reads fail, redeploy both compatibility flags as `true`. The APIs
will use complete legacy results only when the workspace result is absent; they
never merge duplicate legacy and workspace records. Investigate and rerun the
copy after correcting the destination.

Rollback does not delete workspace or legacy financial data. Deleting legacy
objects requires a separate, explicitly approved cleanup plan after the
observation period; it is prohibited by Step 30.
