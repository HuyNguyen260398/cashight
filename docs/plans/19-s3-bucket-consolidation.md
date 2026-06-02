---
goal: Consolidate Cashight S3 buckets to fixed production names
version: 1.0
date_created: 2026-06-01
last_updated: 2026-06-01
owner: Cashight maintainer
status: 'In progress'
tags:
  - infrastructure
  - terraform
  - s3
  - migration
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

This plan migrates Cashight from four legacy S3 buckets to two fixed-name buckets:

- `cashight-statements`: application bucket for parsed statement JSON objects.
- `cashight-tfstate`: Terraform S3 backend bucket.

The four buckets to remove after migration and verification are:

- `cashight-statements-cashight-2026`
- `cashight-tfstate-cashight-2026`
- `expense-tracker-statements-cashight-2026`
- `expense-tracker-tfstate-cashight`

## Execution Status - 2026-06-01

- Completed: inventory, target bucket creation, versioning, encryption, public-access block, Terraform state copy, Terraform backend migration, statement object sync, Terraform state rebinding, Terraform apply, local `.env.local` update, S3 smoke test, migrated-object count verification, deletion-helper dry run, and legacy-bucket cleanup wrapper support.
- Not completed: production runtime `STATEMENTS_BUCKET` update because the only Amplify app visible in `ap-southeast-1` is `vuejs-admin-dashboard-production`, which does not appear to be this Cashight project.
- Intentionally not completed: deletion of the four legacy buckets. Delete only after production runtime verification and explicit approval for destructive cleanup.

## 1. Requirements & Constraints

- **REQ-001**: Preserve all statement objects from `cashight-statements-cashight-2026` and `expense-tracker-statements-cashight-2026` before either bucket is emptied or deleted.
- **REQ-002**: Preserve the active Terraform state object from `cashight-tfstate-cashight-2026` before changing the backend to `cashight-tfstate`.
- **REQ-003**: Use `cashight-statements` as the only runtime value for `STATEMENTS_BUCKET` after migration.
- **REQ-004**: Use `cashight-tfstate` as the only Terraform backend bucket after migration.
- **REQ-005**: Delete the four legacy buckets only after object counts, version counts, backend initialization, `terraform plan`, and application storage smoke tests pass.
- **SEC-001**: Keep all S3 buckets private with public access blocked.
- **SEC-002**: Enable server-side encryption on both new buckets.
- **SEC-003**: Enable versioning on both new buckets before migrating data.
- **SEC-004**: Do not send raw card numbers, statement PDFs, transaction-level PII, or Terraform state contents to AI tooling during this migration.
- **CON-001**: S3 bucket names are globally unique. If either fixed name is already owned by another AWS account, stop and decide on a new naming convention before proceeding.
- **CON-002**: Terraform backend buckets cannot be created by the Terraform configuration that uses them as a backend. Create `cashight-tfstate` with AWS CLI before running `terraform init`.
- **CON-003**: Emptying versioned S3 buckets requires deleting object versions and delete markers, not only current objects.
- **CON-004**: All AWS commands in this plan target region `ap-southeast-1`.
- **PAT-001**: Keep route handlers and application code unchanged; the app already reads the statements bucket from `STATEMENTS_BUCKET`.
- **PAT-002**: Keep the existing S3 key layout under `statements/{cardLast4}/{year}/{year}-{mm}.json`.
- **PAT-003**: Keep `var.bucket_suffix` available for Cognito because `terraform/cognito.tf` uses it for `aws_cognito_user_pool_domain.users.domain`.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Inventory the existing buckets and identify the active state bucket before changing infrastructure.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Run `aws sts get-caller-identity` and confirm the account is the intended Cashight AWS account. Stop if the account is wrong. | | |
| TASK-002 | Run `aws s3api head-bucket --bucket <bucket>` for all six bucket names: the four legacy buckets plus `cashight-statements` and `cashight-tfstate`. Record which buckets already exist. | | |
| TASK-003 | Run `aws s3 ls s3://cashight-statements-cashight-2026 --recursive --summarize` and `aws s3 ls s3://expense-tracker-statements-cashight-2026 --recursive --summarize`. Record total object counts and byte totals. | | |
| TASK-004 | Run `aws s3api list-object-versions --bucket cashight-statements-cashight-2026 --output json` and `aws s3api list-object-versions --bucket expense-tracker-statements-cashight-2026 --output json`. Save only counts of `Versions` and `DeleteMarkers`; do not paste object data into issue comments or AI prompts. | | |
| TASK-005 | Run `aws s3 ls s3://cashight-tfstate-cashight-2026/cashight/terraform.tfstate` and `aws s3 ls s3://expense-tracker-tfstate-cashight --recursive --summarize`. Treat `cashight-tfstate-cashight-2026/cashight/terraform.tfstate` as the active state unless inspection proves otherwise. | | |

### Implementation Phase 2

- GOAL-002: Create the two new buckets with baseline security controls.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Create the new Terraform backend bucket with `aws s3api create-bucket --bucket cashight-tfstate --region ap-southeast-1 --create-bucket-configuration LocationConstraint=ap-southeast-1` if it does not already exist in the target account. | | |
| TASK-007 | Create the new statements bucket with `aws s3api create-bucket --bucket cashight-statements --region ap-southeast-1 --create-bucket-configuration LocationConstraint=ap-southeast-1` if it does not already exist in the target account. | | |
| TASK-008 | Enable versioning on both new buckets with `aws s3api put-bucket-versioning --bucket <bucket> --versioning-configuration Status=Enabled`. | | |
| TASK-009 | Enable SSE-S3 encryption on both new buckets with `aws s3api put-bucket-encryption --bucket <bucket> --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'`. | | |
| TASK-010 | Block public access on both new buckets with `aws s3api put-public-access-block --bucket <bucket> --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`. | | |

### Implementation Phase 3

- GOAL-003: Migrate Terraform state to the new backend bucket without losing state history.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Copy the current state object to the new backend with `aws s3 cp s3://cashight-tfstate-cashight-2026/cashight/terraform.tfstate s3://cashight-tfstate/cashight/terraform.tfstate`. | | |
| TASK-012 | Copy the active state backup to a local ignored file with `aws s3 cp s3://cashight-tfstate-cashight-2026/cashight/terraform.tfstate terraform/terraform.tfstate.backup-before-cashight-tfstate-migration`. Do not commit this file. | | |
| TASK-013 | Modify `terraform/backend.tf` so the backend bucket is `cashight-tfstate`, key remains `cashight/terraform.tfstate`, region remains `ap-southeast-1`, `encrypt` remains `true`, and `use_lockfile` remains `true`. | | |
| TASK-014 | Modify `terraform/backend.hcl.example` so `bucket = "cashight-tfstate"`. Keep all other backend values unchanged. | | |
| TASK-015 | Modify `terraform/SETUP.md` so new setup instructions create, version, and encrypt `cashight-tfstate` instead of `cashight-tfstate-cashight-2026`. | | |
| TASK-016 | Run `cd terraform && terraform init -reconfigure`. Confirm Terraform initializes against `cashight-tfstate`. | | |
| TASK-017 | Run `cd terraform && terraform plan`. Stop if the plan proposes deleting or replacing unrelated resources before the statements bucket migration plan is finalized. | | |

### Implementation Phase 4

- GOAL-004: Move statement data into `cashight-statements` and update Terraform to manage the fixed statements bucket name.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Sync current Cashight statement objects with `aws s3 sync s3://cashight-statements-cashight-2026 s3://cashight-statements --exact-timestamps`. | | |
| TASK-019 | Sync legacy Expense Tracker statement objects with `aws s3 sync s3://expense-tracker-statements-cashight-2026 s3://cashight-statements --exact-timestamps`. Before running, compare keys with `aws s3 ls --recursive` if both buckets contain the same `statements/` prefixes; resolve any same-key conflicts by keeping the newer or intended Cashight object. | | |
| TASK-020 | Modify `terraform/main.tf` to add a new variable `statements_bucket_name` with type `string`, description `S3 bucket name for parsed statement JSON objects`, and default `cashight-statements`. Keep the existing `bucket_suffix` variable unchanged because `terraform/cognito.tf` still uses it. | | |
| TASK-021 | Modify `terraform/s3.tf` so `aws_s3_bucket.statements.bucket = var.statements_bucket_name`. Keep public access block, versioning, encryption, lifecycle configuration, tags, and IAM references attached to `aws_s3_bucket.statements`. | | |
| TASK-022 | Modify `terraform/terraform.tfvars.example` to set `statements_bucket_name = "cashight-statements"`. Keep the `bucket_suffix` example if Cognito still needs a custom domain suffix. | | |
| TASK-023 | Run `cd terraform && terraform state show aws_s3_bucket.statements` and confirm whether the current state ID is `cashight-statements-cashight-2026` or `cashight-statements`. Record the result before changing state bindings. | | |
| TASK-024 | If `aws_s3_bucket.statements` still points at `cashight-statements-cashight-2026`, run `cd terraform && terraform state rm aws_s3_bucket.statements aws_s3_bucket_public_access_block.statements aws_s3_bucket_versioning.statements aws_s3_bucket_server_side_encryption_configuration.statements aws_s3_bucket_lifecycle_configuration.statements`. This only removes Terraform state bindings; it must not call `terraform destroy`. | | |
| TASK-025 | Import the new statements bucket resources with `cd terraform && terraform import aws_s3_bucket.statements cashight-statements`, `terraform import aws_s3_bucket_public_access_block.statements cashight-statements`, `terraform import aws_s3_bucket_versioning.statements cashight-statements`, and `terraform import aws_s3_bucket_server_side_encryption_configuration.statements cashight-statements`. Do not import `aws_s3_bucket_lifecycle_configuration.statements` unless `aws s3api get-bucket-lifecycle-configuration --bucket cashight-statements` succeeds; otherwise let Terraform create the lifecycle configuration during apply. | | |
| TASK-026 | Run `cd terraform && terraform plan`. Expected result: no replacement of `aws_s3_bucket.statements`; at most in-place updates to tags, lifecycle, versioning, encryption, or IAM policy documents. | | |
| TASK-027 | Run `cd terraform && terraform apply` only after TASK-026 shows no unintended destroy actions. | | |

### Implementation Phase 5

- GOAL-005: Point application runtime configuration at the new statements bucket and verify behavior.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-028 | Update local `.env.local` and deployment environment variables so `STATEMENTS_BUCKET=cashight-statements`. Do not commit `.env.local`. | | |
| TASK-029 | Update Amplify or production runtime configuration so `STATEMENTS_BUCKET` is `cashight-statements`. Redeploy if the hosting platform requires redeployment for env-var changes. | | |
| TASK-030 | Run `pnpm test` from the repository root. Expected result: all Vitest tests pass. | | |
| TASK-031 | Run `pnpm lint` from the repository root. Expected result: lint passes. | | |
| TASK-032 | Run the storage smoke test by uploading one non-sensitive test statement through the app or by calling the existing parse/upload flow in a local environment configured with `STATEMENTS_BUCKET=cashight-statements`. Verify a JSON object appears under `s3://cashight-statements/statements/`. | | |
| TASK-033 | Run `aws s3 ls s3://cashight-statements --recursive --summarize` and compare object counts and byte totals against the source-bucket inventory from TASK-003, adjusted for intentional duplicate-key resolution. | | |

### Implementation Phase 6

- GOAL-006: Empty and delete legacy buckets only after all migration checks pass.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-034 | Add a temporary written hold note in the deployment ticket or migration notes: "Do not delete legacy buckets until TASK-001 through TASK-033 are complete." | | |
| TASK-035 | Create `scripts/delete-versioned-s3-bucket.ts` as a reviewed deletion helper that lists `Versions` and `DeleteMarkers` with `ListObjectVersions`, deletes them in batches with `DeleteObjects`, verifies the bucket is empty, and then calls `DeleteBucket`. The script must require `--bucket <name>` and `--confirm-bucket <same-name>` so accidental execution against the wrong bucket fails. | ✅ | 2026-06-01 |
| TASK-036 | Create `scripts/delete-legacy-s3-buckets.ts` as a wrapper that targets only the four legacy bucket names and requires `--confirm-delete-legacy-buckets` for real deletion. Add `cleanup:legacy-buckets` and `cleanup:legacy-buckets:dry-run` package scripts. | ✅ | 2026-06-01 |
| TASK-037 | Run `pnpm cleanup:legacy-buckets:dry-run` and confirm it enumerates the four legacy buckets without deleting anything. | ✅ | 2026-06-01 |
| TASK-038 | After production runtime verification and explicit destructive-action approval, run `pnpm cleanup:legacy-buckets` to delete all four legacy buckets. | | |
| TASK-039 | If one bucket deletion fails, rerun `pnpm tsx scripts/delete-versioned-s3-bucket.ts --bucket <failed-bucket> --confirm-bucket <failed-bucket>` only for the failed bucket after inspecting the error. | | |
| TASK-040 | Run `aws s3api head-bucket --bucket <legacy-bucket>` for each removed bucket. Expected result: `Not Found` or `NoSuchBucket` for all four legacy buckets. | | |

## 3. Alternatives

- **ALT-001**: Keep suffix-based bucket names. Rejected because the requested convention is fixed names: `cashight-statements` and `cashight-tfstate`.
- **ALT-002**: Let Terraform replace the statements bucket automatically. Rejected because S3 bucket replacement does not migrate existing statement objects and can fail or destroy data if not controlled.
- **ALT-003**: Keep the legacy Terraform backend bucket and only change the statements bucket. Rejected because the requested end state has exactly two new bucket names, including `cashight-tfstate`.
- **ALT-004**: Merge both old Terraform state buckets automatically. Rejected because Terraform state is authoritative and must be inspected before any legacy state file is trusted or discarded.

## 4. Dependencies

- **DEP-001**: AWS CLI configured with credentials for the Cashight AWS account.
- **DEP-002**: Terraform CLI version `>= 1.10` because `terraform/backend.tf` uses native S3 `use_lockfile`.
- **DEP-003**: IAM permissions for `s3:CreateBucket`, `s3:PutBucketVersioning`, `s3:PutEncryptionConfiguration`, `s3:PutPublicAccessBlock`, `s3:ListBucket`, `s3:ListBucketVersions`, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:DeleteObjectVersion`, and `s3:DeleteBucket`.
- **DEP-004**: Runtime environment access for local `.env.local` and production `STATEMENTS_BUCKET` configuration.
- **DEP-005**: Existing Terraform files under `terraform/`.

## 5. Files

- **FILE-001**: `terraform/backend.tf` - change backend bucket from `cashight-tfstate-cashight-2026` to `cashight-tfstate`.
- **FILE-002**: `terraform/backend.hcl.example` - update optional backend override example to `cashight-tfstate`.
- **FILE-003**: `terraform/SETUP.md` - update backend bucket bootstrap commands.
- **FILE-004**: `terraform/main.tf` - add `statements_bucket_name` while preserving `bucket_suffix` for Cognito.
- **FILE-005**: `terraform/s3.tf` - set statements bucket name from `var.statements_bucket_name`.
- **FILE-006**: `terraform/terraform.tfvars.example` - document `statements_bucket_name = "cashight-statements"`.
- **FILE-007**: `.env.local` - local-only runtime update to `STATEMENTS_BUCKET=cashight-statements`; do not commit.
- **FILE-008**: Production or Amplify environment configuration - update `STATEMENTS_BUCKET` outside the repository.
- **FILE-009**: `docs/plans/00-INDEX.md` - link this plan from the implementation plan index.
- **FILE-010**: `scripts/delete-versioned-s3-bucket.ts` - deletion helper for one versioned S3 bucket.
- **FILE-011**: `scripts/delete-legacy-s3-buckets.ts` - wrapper that deletes only the four known legacy buckets after explicit confirmation.
- **FILE-012**: `package.json` - add `cleanup:legacy-buckets` and `cleanup:legacy-buckets:dry-run` scripts.

## 6. Testing

- **TEST-001**: `cd terraform && terraform init -reconfigure` completes against `cashight-tfstate`.
- **TEST-002**: `cd terraform && terraform plan` shows no unintended destroy or replacement after state and bucket migration.
- **TEST-003**: `pnpm test` passes from the repository root.
- **TEST-004**: `pnpm lint` passes from the repository root.
- **TEST-005**: Uploading or saving a test statement writes to `s3://cashight-statements/statements/`.
- **TEST-006**: Listing statements from the app or API reads existing migrated objects from `cashight-statements`.
- **TEST-007**: `aws s3 ls s3://cashight-statements --recursive --summarize` matches the expected migrated object count and byte total.
- **TEST-008**: `aws s3api head-bucket` returns not found for all four legacy bucket names after deletion.

## 7. Risks & Assumptions

- **RISK-001**: `cashight-statements` or `cashight-tfstate` may already be owned by a different AWS account because S3 bucket names are global.
- **RISK-002**: The two legacy statement buckets may contain duplicate keys with different object bodies. Resolve conflicts before the second sync overwrites objects.
- **RISK-003**: Deleting a versioned bucket without deleting all versions and delete markers will fail.
- **RISK-004**: Removing the active Terraform state bucket before backend migration is verified can block future infrastructure changes.
- **RISK-005**: `expense-tracker-tfstate-cashight` may contain useful historical state. Inspect metadata and object timestamps before deletion.
- **ASSUMPTION-001**: `cashight-tfstate-cashight-2026/cashight/terraform.tfstate` is the active Terraform state because `terraform/backend.tf` currently references that bucket and key.
- **ASSUMPTION-002**: Statement objects are JSON files under the existing `statements/` prefix and can be copied between buckets without transformation.
- **ASSUMPTION-003**: The app receives S3 access through server-side AWS credentials or an IAM role; no browser-side bucket policy change is required.

## 8. Related Specifications / Further Reading

- [Step 06 - S3 infrastructure](./06-s3-infrastructure.md)
- [Step 07 - Storage layer](./07-storage-layer.md)
- [Step 11 - Amplify deployment](./11-amplify-deployment.md)
- [Terraform setup](../../terraform/SETUP.md)
