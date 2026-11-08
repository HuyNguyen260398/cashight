# v2 persistent resources (`terraform/v2`)

The v2 parallel stack (`cashight-v2.nghuy.link`) keeps everything that must outlive a test cluster in its own Terraform root, `terraform/v2/`. The cluster itself is ephemeral and lives in `terraform/platform/` ([platform runbook](platform.md)).

Decision record: [`docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md`](superpowers/specs/2026-11-05-eks-plan-4-open-points.md) (F4, F7, and the 2026-11-07 revision).

## 1. What the root holds, and why it is separate

| Group | Resources |
|---|---|
| Data stores | Table `cashight-v2`; buckets `cashight-v2-{statements,uploads,cost-exports}-<account>`; queues `cashight-v2-parse` and `cashight-v2-invoice-parse` with their DLQs; the uploads → queues notifications |
| Images and CI | ECR repository `cashight-backend` (immutable tags, scan on push); role `cashight-v2-github-ci`, trusted only for pushes to `cashight-v2` |
| Edge | Certificates for `cashight-v2.nghuy.link` (us-east-1) and `api.cashight-v2.nghuy.link` (regional); bucket `cashight-v2-frontend-<account>`, its CloudFront distribution, and A/AAAA records |

Settings mirror v1 (`terraform/data.tf`, `s3.tf`, `edge.tf`, `acm.tf`). The v2 buckets accept browser requests only from `https://cashight-v2.nghuy.link`.

**Why not `terraform/`:** `main` and `cashight-v2` share `terraform/`'s state. Anything only `cashight-v2` declares there would be destroyed by the next apply from `main`. `main` never sees this root's state (`cashight/v2/terraform.tfstate`), so v1 and v2 cannot undo each other.

**v1 is only read:** the root reads v1's outputs (the shared Cognito user pool) through `terraform_remote_state`. The one v1 change for v2 is the pair of `cashight-v2.nghuy.link` URLs on the Cognito SPA client, which lives in `terraform/cognito.tf` and is applied from `main`.

## 2. Apply

From the workstation only. CI (`Terraform CI`, job `v2`) runs `fmt`, `validate`, `test`, TFLint and Checkov, never `plan` or `apply`.

```bash
export AWS_REGION=ap-southeast-1
eval "$(aws configure export-credentials --format env)"
terraform -chdir=terraform/v2 init
terraform -chdir=terraform/v2 plan -out=tfplan
terraform -chdir=terraform/v2 apply tfplan
```

The first apply shows only additions. Certificate validation takes a few minutes, and the CloudFront distribution 5–15 minutes. Until the 4c SPA deploy, `https://cashight-v2.nghuy.link` answers 403 or 404 because the bucket is empty.

## 3. Seed the authorization records

`auth-guard` writes the `AUTHZ#<sub>` / `PROFILE` record only to the v1 table, and every v2 API checks it in the v2 table. Copy the records across, after any new first sign-in on v1 and before each bring-up:

```bash
pnpm tsx scripts/v2/seed-authz.ts --source cashight --target cashight-v2 --dry-run
pnpm tsx scripts/v2/seed-authz.ts --source cashight --target cashight-v2
```

It reads v1 only, overwrites the v2 copies, refuses to write into `cashight`, and prints counts only. A record changed in v1 stays stale in v2 until the next run.

## 4. What Plan 4c reads from here

`terraform/platform` reads this root through `terraform_remote_state` (key `cashight/v2/terraform.tfstate`).

| Output | Used for |
|---|---|
| `table_name`, `table_arn` | `TABLE_NAME`; workload Pod Identity policies |
| `statements_bucket_name` / `_arn`, `uploads_bucket_name` / `_arn`, `cost_exports_bucket_name` / `_arn` | `STATEMENTS_BUCKET`, `UPLOAD_BUCKET`, `EXPORT_BUCKET`; policies |
| `parse_queue_url` / `_arn`, `invoice_parse_queue_url` / `_arn` | Worker `QUEUE_URL`; policies; KEDA scaler roles |
| `ecr_repository_url`, `ecr_repository_arn` | Image pushes and Deployment images |
| `github_ci_role_arn` | The image and SPA workflow on `cashight-v2` |
| `frontend_bucket_name`, `cloudfront_distribution_id` | v2 SPA deploy and invalidation |
| `api_certificate_arn` | The ALB Ingress for `api.cashight-v2.nghuy.link` |
| `cognito_user_pool_id` | `COGNITO_USER_POOL_ID` (the shared v1 pool) |

### Repository variables for the v2 Release workflow

`.github/workflows/v2-release.yaml` reads these from **repository** variables. An environment cannot hold them: setting `environment:` on a job changes the OIDC subject, and `cashight-v2-github-ci` trusts only `ref:refs/heads/cashight-v2`.

| Variable | Value |
|---|---|
| `V2_CI_ROLE_ARN` | `terraform -chdir=terraform/v2 output -raw github_ci_role_arn` |
| `V2_ECR_REPOSITORY_URL` | `… output -raw ecr_repository_url` |
| `V2_FRONTEND_BUCKET` | `… output -raw frontend_bucket_name` |
| `V2_CLOUDFRONT_DISTRIBUTION_ID` | `… output -raw cloudfront_distribution_id` |

The SPA build also reuses v1's `COGNITO_AUTHORITY`, `COGNITO_SPA_CLIENT_ID` and the two `NEXT_PUBLIC_ENABLE_*` flags.

The account values in `deploy/cashight/overlays/v2` and `deploy/workloads/cashight.yaml` are copied from these outputs. If you re-create a resource here, update them; `scripts/platform/check-overlay.sh` (run by bring-up) fails until they match.

## 5. Deleting v2

Nothing here is meant to be deleted between test days. To remove v2 entirely:
1. Turn off `deletion_protection_enabled` on the table.
2. Empty the versioned buckets with `pnpm tsx scripts/delete-versioned-s3-bucket.ts --bucket <name> --confirm-bucket <name>`.
3. Delete the images in `cashight-backend` (`force_delete = false`).
4. Run `terraform -chdir=terraform/v2 destroy`.
5. Remove the v2 URLs from the Cognito SPA client on `main`.
