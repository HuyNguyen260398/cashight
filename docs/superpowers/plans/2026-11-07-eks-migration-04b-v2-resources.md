# EKS Migration, Plan 4b: Persistent v2 AWS Resources and Runtime Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create everything v2 needs that outlives a test cluster (its own data stores, the image registry, TLS certificates, the `cashight-v2.nghuy.link` SPA hosting and a CI role) in a new `terraform/v2` root. Then seed the v2 table with the authorization records, add the v2 URLs to the shared Cognito client, and close the runtime hardening items Plan 1 deferred.

**Architecture:**
- **A new persistent Terraform root, `terraform/v2/`** (state key `cashight/v2/terraform.tfstate`), holds every v2-only resource.
  - It reads v1's outputs through `terraform_remote_state` and never writes v1 resources.
  - It is applied from the workstation only, like `terraform/platform-base`.
  - `main` never sees this state, so no apply from `main` can destroy v2. That is why it is a separate root and not additions to `terraform/` (decided 2026-11-07, recorded in Task 4).
- **The only v1 change** is two URLs added to the Cognito SPA client's callback and logout lists. It lands on `main` through its own PR, because `terraform/` state is applied from `main`, and is then merged forward into `cashight-v2`.
- **The hardening tasks** are app and CI code on `cashight-v2`.

**Tech Stack:** Terraform 1.15.2 (AWS provider 6.x, `terraform test` with mock providers), TFLint, Checkov, TypeScript (vitest, Node 22), esbuild (`scripts/build-servers.mjs`), Docker (arm64), GitHub Actions.

**Spec:**
- Decisions: `docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md` (answers 3–8, F2–F7, and "Consequences of F1–F7").
- Background: `docs/superpowers/specs/2026-10-08-eks-migration-design.md` §4.2–§4.4.
- Handover from Plan 4a: `docs/superpowers/plans/2026-11-05-eks-migration-04a-platform-port.md`, "Handover to Plan 4b".
- Deferred hardening list: `docs/superpowers/plans/2026-10-08-eks-migration-01-container-runtime.md`, last paragraph of "Implementation notes".

## Where this plan sits

| Plan | Scope | State |
|---|---|---|
| 4a | Platform port into `cashight` | done (#140; `aws-eks-infra` #19) |
| **4b** | **Persistent v2 resources, AUTHZ seed, Cognito URLs, Plan 1 hardening** | this plan |
| 4c | Ephemeral bring-up: cluster, Pod Identity and KEDA scaler roles, `api.cashight-v2` DNS record, `deploy/cashight/`, image pipeline, v2 SPA build, teardown, Plan 3 handover | next |

## Branching

| Tasks | Branch | PR into |
|---|---|---|
| 1–9 | `feat/v2-resources`, cut from `cashight-v2` | `cashight-v2` |
| 10 | `feat/cognito-v2-urls`, cut from `main` | `main`, then `main` is merged forward into `cashight-v2` |
| 11 | workstation, after both PRs are merged | n/a |

## Global Constraints

- **Region `ap-southeast-1`.** The only exception is the CloudFront certificate, which must be in `us-east-1` (provider alias `aws.global`).
- **v1 does not change** (answers 3 and F2, F3). The only v1 edit is to `aws_cognito_user_pool_client.spa`, which gains `https://cashight-v2.nghuy.link/auth/callback/` and `https://cashight-v2.nghuy.link/signin/`.
  - `auth-guard`, every v1 bucket, the table, the queues, the API, the Lambdas and the `cashight-github-deploy` role are untouched.
  - Nothing in `terraform/` changes on `cashight-v2` except through Task 10's forward merge.
- **`terraform/v2`:**
  - Backend: bucket `cashight-tfstate`, key `cashight/v2/terraform.tfstate`, KMS `alias/cashight-tfstate`, `use_lockfile = true`.
  - Applied from the workstation only. CI runs `fmt -check`, `validate -backend=false`, `test`, `tflint` and `checkov`; it never runs `plan` or `apply`.
- **Names:**

  | Resource | Name |
  |---|---|
  | Table | `cashight-v2` |
  | Buckets | `cashight-v2-statements-<account>`, `cashight-v2-uploads-<account>`, `cashight-v2-cost-exports-<account>`, `cashight-v2-frontend-<account>` |
  | Queues | `cashight-v2-parse`, `cashight-v2-parse-dlq`, `cashight-v2-invoice-parse`, `cashight-v2-invoice-parse-dlq` |
  | ECR repository | `cashight-backend` |
  | GitHub CI role | `cashight-v2-github-ci` |
  | CloudFront | `cashight-v2-frontend-oac`, `cashight-v2-spa-router`, `cashight-v2-frontend-security-headers` |
- **v2 data stores copy v1's settings exactly** (`terraform/data.tf`, `terraform/s3.tf`):
  - **Table:** `PAY_PER_REQUEST`, hash `PK` (S), range `SK` (S), TTL on `expiresAtEpoch`, PITR on, `deletion_protection_enabled = true`, SSE on.
  - **Statements bucket:** versioning on, noncurrent versions expire after 90 days, AES256, public access fully blocked, `BucketOwnerEnforced`, TLS-only policy.
  - **Uploads bucket:** objects under `uploads/` expire after 1 day. Notifications go to the parse queue for `uploads/statements/` + `.pdf` and to the invoice-parse queue for `uploads/aws-invoices/` + `.pdf`, both on `s3:ObjectCreated:*`.
  - **Cost-exports bucket:** versioning disabled, objects under `exports/` expire after 1 day, incomplete multipart uploads aborted after 1 day, and the same `#checkov:skip` reasons as v1.
  - **Queues:** visibility timeout 360 s, DLQ retention 14 days, `maxReceiveCount = 3`, SQS-managed SSE. Each queue policy lets `s3.amazonaws.com` send only from the v2 uploads bucket ARN, and only from this account.
- **CORS on v2 buckets only** (Consequences F1–F7): uploads allows `PUT` from `https://cashight-v2.nghuy.link`; cost-exports allows `GET` from `https://cashight-v2.nghuy.link`. The statements bucket has no CORS, as in v1.
- **Hostnames:**
  - `cashight-v2.nghuy.link`: CloudFront, with A and AAAA alias records in this plan.
  - `api.cashight-v2.nghuy.link`: certificate only in this plan. Its record points at an ALB that exists only while the cluster does, so it belongs to 4c's `terraform/platform`.
- **The CI role trusts exactly** `repo:HuyNguyen260398/cashight:ref:refs/heads/cashight-v2` (audience `sts.amazonaws.com`) through the existing account OIDC provider (data source, as in `terraform/github-oidc.tf`).
- **Cost:** near zero. There is no NAT, no compute and no ALB in this plan.

## Review Focus

1. **The `main` apply in Task 10 carries unrelated drift.** If `terraform/` state has drifted from `main`, the apply that adds the Cognito URLs would also apply that drift to production. Expected: the saved plan shows exactly `0 to add, 1 to change, 0 to destroy`, on `aws_cognito_user_pool_client.spa` only; anything else stops the task. Owner: Task 10, Step 5.
2. **The seed script writes into v1 or reads from v2.** A swapped `--source`/`--target` would overwrite v1's authorization records. Expected: the script refuses when the target is `cashight` or equals the source, and only ever calls `put` on the target. Owner: Task 5, Steps 1 and 3 (`refuses to write into the v1 table`).
3. **v2 uploads are never parsed.** A notification prefix that differs from what the API writes (`uploads/statements/`, `uploads/aws-invoices/`) leaves jobs `PENDING` forever on the first test day. Expected: the v2 notification filters equal v1's byte for byte. Owner: Task 1 (`uploads_notify_both_queues`).
4. **A late handler writes a second response after the 504.** The request deadline answers first, then the handler resolves and writes again, which throws `ERR_HTTP_HEADERS_SENT` or corrupts metrics. Expected: exactly one response, one counted 5xx, no throw. Owner: Task 7 (`handler finishing after the deadline does not write again`).
5. **A stuck connection blocks pod shutdown until SIGKILL.** `server.close` waits on a keep-alive or in-flight request forever. Expected: after `SHUTDOWN_HARD_DEADLINE_MS` the server closes all connections and the process exits 1, with a log line naming the reason. Owner: Task 8 (`forces exit after the hard deadline`).

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `terraform/v2/{versions,backend,providers,variables,main,outputs}.tf`, `.tflint.hcl`, `.checkov.yml`, `.terraform.lock.hcl` | 1 | Root scaffold, v1 remote state |
| `terraform/v2/data.tf` | 1 | Table, three buckets, queues, notifications |
| `terraform/v2/edge.tf` | 2 | Certificates, frontend bucket, CloudFront, DNS |
| `terraform/v2/ci.tf` | 3 | ECR repository, GitHub CI role |
| `terraform/v2/tests/{data,edge,ci}.tftest.hcl` | 1–3 | Mocked plan assertions |
| `.github/workflows/tf-ci.yaml`, `docs/v2-resources.md`, `CLAUDE.md`, open-points spec | 4 | CI job, runbook, decision record |
| `scripts/v2/seed-authz.ts`, `scripts/__tests__/seed-authz.test.ts` | 5 | AUTHZ copy v1 → v2 |
| `backend/server/process-errors.ts`, `backend/__tests__/server-process-errors.test.ts` | 6 | Process-level error handlers |
| `backend/server/http-server.ts`, `backend/__tests__/server-http.test.ts` | 7 | Per-request deadline |
| `backend/server/shutdown.ts`, `backend/server/start-{api,worker}.ts`, `backend/__tests__/server-shutdown.test.ts` | 8 | Shutdown hard deadline, exit codes |
| `Dockerfile`, `.github/dependabot.yml`, `backend/server/entrypoints/pdf-smoke.ts`, `scripts/build-servers.mjs`, `scripts/fixtures/minimal-pdf.mjs`, `.github/workflows/ci.yaml`, tests | 9 | Image pins, in-image PDF smoke, CI log dump |
| `terraform/cognito.tf`, `terraform/tests/auth_api_edge.tftest.hcl` | 10 | v2 URLs on the SPA client (on `main`) |

---

## Task 1: `terraform/v2` root and the v2 data stores

**Files:**
- Create: `terraform/v2/versions.tf`, `backend.tf`, `providers.tf`, `variables.tf`, `main.tf`, `data.tf`, `outputs.tf`, `.tflint.hcl` (copy of `terraform/platform/.tflint.hcl`), `.checkov.yml` (copy of `terraform/platform/.checkov.yml`)
- Test: `terraform/v2/tests/data.tftest.hcl`

**Interfaces:**
- Consumes: v1 outputs through `data "terraform_remote_state" "v1"` (key `cashight/terraform.tfstate`): `cognito_user_pool_id`, `cognito_smoke_client_id`.
- Produces:
  - `local.account_id`, from `data.aws_caller_identity.current`
  - `local.v2_origin = "https://cashight-v2.nghuy.link"`
  - `local.tags = { Project = "cashight", Environment = "v2", ManagedBy = "Terraform" }`, set as provider `default_tags`
  - Outputs: `table_name`, `table_arn`, `statements_bucket_name`, `statements_bucket_arn`, `uploads_bucket_name`, `uploads_bucket_arn`, `cost_exports_bucket_name`, `cost_exports_bucket_arn`, `parse_queue_url`, `parse_queue_arn`, `invoice_parse_queue_url`, `invoice_parse_queue_arn`, `cognito_user_pool_id` (pass-through of v1's)

- [ ] **Step 1: Write the failing test** `terraform/v2/tests/data.tftest.hcl`

Mocks and overrides:
- `mock_provider "aws" {}` and `mock_provider "aws" { alias = "global" }`, each with `mock_data "aws_iam_policy_document"` defaulting `json` to `{"Version":"2012-10-17","Statement":[]}` (the pattern in `terraform/platform/tests/platform.tftest.hcl`).
- `override_data` for `data.aws_caller_identity.current` (`account_id = "111122223333"`).
- `override_data` for `data.terraform_remote_state.v1`, with outputs `{ cognito_user_pool_id = "ap-southeast-1_stub", cognito_smoke_client_id = "smokeclient" }`.

All runs use `command = plan`:

```hcl
run "table_mirrors_v1" {
  command = plan
  assert {
    condition = (
      aws_dynamodb_table.cashight.name == "cashight-v2" &&
      aws_dynamodb_table.cashight.billing_mode == "PAY_PER_REQUEST" &&
      aws_dynamodb_table.cashight.hash_key == "PK" && aws_dynamodb_table.cashight.range_key == "SK" &&
      aws_dynamodb_table.cashight.deletion_protection_enabled == true &&
      one(aws_dynamodb_table.cashight.ttl).attribute_name == "expiresAtEpoch" &&
      one(aws_dynamodb_table.cashight.point_in_time_recovery).enabled == true
    )
    error_message = "v2 table must mirror v1's settings under the name cashight-v2"
  }
}

run "bucket_names_are_v2" {
  command = plan
  assert {
    condition = (
      aws_s3_bucket.statements.bucket == "cashight-v2-statements-111122223333" &&
      aws_s3_bucket.uploads.bucket == "cashight-v2-uploads-111122223333" &&
      aws_s3_bucket.cost_exports.bucket == "cashight-v2-cost-exports-111122223333"
    )
    error_message = "bucket names"
  }
}

run "uploads_notify_both_queues" {
  command = plan
  assert {
    condition = (
      length(aws_s3_bucket_notification.uploads.queue) == 2 &&
      contains([for q in aws_s3_bucket_notification.uploads.queue : "${q.filter_prefix}|${q.filter_suffix}"], "uploads/statements/|.pdf") &&
      contains([for q in aws_s3_bucket_notification.uploads.queue : "${q.filter_prefix}|${q.filter_suffix}"], "uploads/aws-invoices/|.pdf")
    )
    error_message = "notification filters must equal v1's"
  }
}

run "queues_mirror_v1" {
  command = plan
  assert {
    condition = (
      aws_sqs_queue.parse.name == "cashight-v2-parse" && aws_sqs_queue.parse.visibility_timeout_seconds == 360 &&
      aws_sqs_queue.invoice_parse.name == "cashight-v2-invoice-parse" && aws_sqs_queue.invoice_parse.visibility_timeout_seconds == 360 &&
      aws_sqs_queue.parse_dlq.message_retention_seconds == 1209600 &&
      jsondecode(aws_sqs_queue.parse.redrive_policy).maxReceiveCount == 3
    )
    error_message = "queue settings"
  }
}

run "cors_allows_only_the_v2_origin" {
  command = plan
  assert {
    condition = (
      one(aws_s3_bucket_cors_configuration.uploads.cors_rule).allowed_origins == toset(["https://cashight-v2.nghuy.link"]) &&
      one(aws_s3_bucket_cors_configuration.uploads.cors_rule).allowed_methods == toset(["PUT"]) &&
      one(aws_s3_bucket_cors_configuration.cost_exports.cors_rule).allowed_origins == toset(["https://cashight-v2.nghuy.link"])
    )
    error_message = "v2 buckets allow only the v2 origin"
  }
}
```

The queue-policy `aws:SourceArn` is covered by Checkov and review. `redrive_policy` is known at plan only if the DLQ ARN is known. If it isn't, add an `override_resource` for `aws_sqs_queue.parse_dlq` with `arn = "arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-parse-dlq"` and `override_during = plan`.

- [ ] **Step 2: Run it and check that it fails**

Run: `terraform -chdir=terraform/v2 init -backend=false && terraform -chdir=terraform/v2 test`
Expected: FAIL, because there is no configuration yet.

- [ ] **Step 3: Implement the root**
- `versions.tf`: `required_version = ">= 1.11.0"`, `hashicorp/aws ~> 6.0`.
- `backend.tf`: as in Global Constraints. Header comment: workstation only; v2-only persistent resources; never applied from `main`.
- `providers.tf`: the default `aws` provider plus `aws.global` (`us-east-1`), both with `default_tags { tags = local.tags }`. No profile.
- `variables.tf`: `region` (default `ap-southeast-1`).
- `main.tf`: the caller identity data source, the v1 `terraform_remote_state` (s3, same bucket and KMS, key `cashight/terraform.tfstate`), and the locals.
- `data.tf`: the resources in Global Constraints, with the same resource addresses as v1 (`aws_dynamodb_table.cashight`, `aws_s3_bucket.statements|uploads|cost_exports` and their sub-resources, `aws_sqs_queue.parse|parse_dlq|invoice_parse|invoice_parse_dlq`, queue policies, `aws_s3_bucket_notification.uploads`), so a reader can diff the two roots. Copy the `#checkov:skip` comments with the code they annotate.
- `outputs.tf`: the outputs in Interfaces.

- [ ] **Step 4: Run the checks**

Run: `terraform -chdir=terraform/v2 fmt -check && terraform -chdir=terraform/v2 validate && terraform -chdir=terraform/v2 test && (cd terraform/v2 && tflint --init && tflint --config "$PWD/.tflint.hcl") && checkov -d terraform/v2 --config-file terraform/v2/.checkov.yml`
Expected: `5 passed, 0 failed`. TFLint and Checkov exit 0. Any new Checkov finding gets either a fix or a `#checkov:skip` with a reason that matches a v1 skip.

- [ ] **Step 5: Commit** (including `.terraform.lock.hcl`)

```bash
git add terraform/v2
git commit -m "feat(v2): add the terraform/v2 root with the v2 data stores"
```

## Task 2: Certificates and the `cashight-v2.nghuy.link` SPA hosting

**Files:**
- Create: `terraform/v2/edge.tf`
- Test: `terraform/v2/tests/edge.tftest.hcl`
- Modify: `terraform/v2/outputs.tf`

**Interfaces:**
- Consumes: `local.account_id` and `local.tags` (Task 1).
- Produces outputs `frontend_bucket_name`, `frontend_bucket_arn`, `cloudfront_distribution_id`, `cloudfront_distribution_arn`, `cloudfront_domain_name`, `frontend_certificate_arn` and `api_certificate_arn`. 4c attaches the API certificate to the ALB Ingress and uses the other three for the v2 SPA deploy.

- [ ] **Step 1: Write the failing test** `terraform/v2/tests/edge.tftest.hcl`

Use Task 1's mocks plus `override_data` for `data.aws_route53_zone.nghuy_link` (`zone_id = "Z000STUB"`). Override `aws_cloudfront_distribution.frontend` during plan with `arn = "arn:aws:cloudfront::111122223333:distribution/STUB"` so the bucket policy is plan-time known.

```hcl
run "certificates_cover_the_v2_names" {
  command = plan
  assert {
    condition     = aws_acm_certificate.frontend.domain_name == "cashight-v2.nghuy.link" && length(aws_acm_certificate.frontend.subject_alternative_names) <= 1
    error_message = "frontend certificate (us-east-1)"
  }
  assert {
    condition     = aws_acm_certificate.api.domain_name == "api.cashight-v2.nghuy.link"
    error_message = "regional API certificate"
  }
}

run "distribution_serves_only_v2" {
  command = plan
  assert {
    condition = (
      aws_cloudfront_distribution.frontend.aliases == toset(["cashight-v2.nghuy.link"]) &&
      one(aws_cloudfront_distribution.frontend.viewer_certificate).minimum_protocol_version == "TLSv1.2_2021"
    )
    error_message = "aliases and TLS policy"
  }
  assert {
    condition     = aws_s3_bucket.frontend.bucket == "cashight-v2-frontend-111122223333"
    error_message = "frontend bucket name"
  }
}

run "dns_points_v2_at_cloudfront" {
  command = plan
  assert {
    condition = (
      aws_route53_record.frontend["A"].name == "cashight-v2.nghuy.link" &&
      aws_route53_record.frontend["AAAA"].name == "cashight-v2.nghuy.link"
    )
    error_message = "A and AAAA alias records"
  }
}
```

The mocked policy documents render as an empty JSON policy, so the bucket policy's `aws:SourceArn` (it must name the v2 distribution, `aws_cloudfront_distribution.frontend.arn`) is checked in review, not by this test.

- [ ] **Step 2: Run it and check that it fails**

Run: `terraform -chdir=terraform/v2 test -filter=tests/edge.tftest.hcl`
Expected: FAIL, because the resources are undeclared.

- [ ] **Step 3: Implement `edge.tf`**

Mirror `terraform/edge.tf` and `terraform/acm.tf` with these differences:
- **Certificates:**
  - `aws_acm_certificate.frontend` (provider `aws.global`) for `cashight-v2.nghuy.link`.
  - `aws_acm_certificate.api` (regional) for `api.cashight-v2.nghuy.link`.
  - Both use DNS validation records in `nghuy.link` and `aws_acm_certificate_validation`, with `create_before_destroy`.
- **Own copies of the CloudFront helpers,** under the `cashight-v2-*` names from Global Constraints: the OAC, the CloudFront function (the same JavaScript as v1's `spa_router`) and the response-headers policy (the same headers).
  - **Do not reference v1's,** so a v1 change can never break v2 and the reverse.
- **Bucket:** `aws_s3_bucket.frontend` with public access fully blocked, `BucketOwnerEnforced`, AES256 and versioning, as in v1.
- **Distribution:** `aws_cloudfront_distribution.frontend` with aliases `["cashight-v2.nghuy.link"]` and the same cache behaviour, custom 403/404 → `/index.html`, `PriceClass_200`, `http2and3` and IPv6.
- **Bucket policy:** OAC read limited to this distribution's ARN, plus the TLS-only deny.
- **DNS:** `aws_route53_record.frontend`, `for_each = toset(["A", "AAAA"])`, an alias to the distribution.
- No WAF, the same as v1 (copy its comment).

- [ ] **Step 4: Run the checks**

Run: the Task 1 Step 4 command.
Expected: all test files pass, and TFLint and Checkov exit 0. Use v1's existing skip reasons for CloudFront logging and WAF if Checkov raises them.

- [ ] **Step 5: Commit**

```bash
git add terraform/v2
git commit -m "feat(v2): add the v2 certificates and the cashight-v2.nghuy.link SPA hosting"
```

## Task 3: Image registry and the v2 CI role

**Files:**
- Create: `terraform/v2/ci.tf`
- Test: `terraform/v2/tests/ci.tftest.hcl`
- Modify: `terraform/v2/outputs.tf`

**Interfaces:**
- Consumes: `local.account_id`, `data.terraform_remote_state.v1.outputs.cognito_user_pool_id` (Task 1); `aws_s3_bucket.frontend` and `aws_cloudfront_distribution.frontend` (Task 2).
- Produces outputs `ecr_repository_url`, `ecr_repository_arn` and `github_ci_role_arn`. 4c's image workflow assumes this role and pushes to this repository.

- [ ] **Step 1: Write the failing test** `terraform/v2/tests/ci.tftest.hcl`

Use the same mocks as Task 1, plus `override_data` for `data.aws_iam_openid_connect_provider.github` (`arn = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"`). Policy documents are mocked, so the trust subject is asserted on `local.github_ci_subjects`, which the trust policy's only `:sub` condition reads:

```hcl
run "ecr_is_immutable_and_scanned" {
  command = plan
  assert {
    condition = (
      aws_ecr_repository.backend.name == "cashight-backend" &&
      aws_ecr_repository.backend.image_tag_mutability == "IMMUTABLE" &&
      one(aws_ecr_repository.backend.image_scanning_configuration).scan_on_push == true
    )
    error_message = "ECR repository settings"
  }
  assert {
    condition     = length(jsondecode(aws_ecr_lifecycle_policy.backend.policy).rules) == 2
    error_message = "untagged-expiry and keep-last-20 rules"
  }
}

run "ci_role_trusts_only_cashight_v2" {
  command = plan
  assert {
    condition     = aws_iam_role.github_ci.name == "cashight-v2-github-ci"
    error_message = "role name"
  }
  assert {
    condition     = local.github_ci_subjects == ["repo:HuyNguyen260398/cashight:ref:refs/heads/cashight-v2"]
    error_message = "trust is limited to the cashight-v2 branch"
  }
}
```

- [ ] **Step 2: Run it and check that it fails**

Run: `terraform -chdir=terraform/v2 test -filter=tests/ci.tftest.hcl`
Expected: FAIL, because the resources are undeclared.

- [ ] **Step 3: Implement `ci.tf`**
- **`aws_ecr_repository.backend`:** `IMMUTABLE` tags, scan on push, AES256 encryption, `force_delete = false`.
- **`aws_ecr_lifecycle_policy.backend`** with two rules:
  1. Expire untagged images after 1 day.
  2. Keep the last 20 tagged images (`tagStatus = "tagged"` with `tagPatternList = ["*"]`, `countType = "imageCountMoreThan"`, `countNumber = 20`).
- **`data.aws_iam_openid_connect_provider.github`:** look up by URL, as in v1.
- **`local.github_ci_subjects`:** the one subject from Global Constraints. The trust policy uses it in a `StringEquals` condition on `:sub`, plus `StringEquals` on `:aud`.
- **`aws_iam_role.github_ci`** with one inline policy holding these statements:
  - `ecr:GetAuthorizationToken` on `*`.
  - `ecr:BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`, `BatchGetImage` and `DescribeImages` on the repository ARN.
  - `s3:PutObject`, `DeleteObject`, `GetObject` and `ListBucket` on the v2 frontend bucket and its objects.
  - `cloudfront:CreateInvalidation`, `GetInvalidation` and `ListInvalidations` on the v2 distribution ARN.
  - `cognito-idp:DescribeUserPoolClient` on `arn:aws:cognito-idp:${var.region}:${local.account_id}:userpool/${<v1 user pool id>}`, for 4c's smoke tests, as v1's `ReadSmokeClientSecret`.

- [ ] **Step 4: Run the checks**

Run: the Task 1 Step 4 command.
Expected: all three test files pass, and TFLint and Checkov exit 0.

- [ ] **Step 5: Commit**

```bash
git add terraform/v2
git commit -m "feat(v2): add the backend image repository and the cashight-v2 CI role"
```

## Task 4: CI, runbook and the decision record

**Files:**
- Modify: `.github/workflows/tf-ci.yaml`, `CLAUDE.md`, `docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md`
- Create: `docs/v2-resources.md`

**Interfaces:**
- Produces: a `v2` job in `Terraform CI` and the runbook Task 11 follows.

- [ ] **Step 1: Add the `v2` job to `tf-ci.yaml`**

Copy the `grafana` job:
- Set `name: v2 root - Format, Validate, Test & Lint` and `working-directory: terraform/v2`.
- Use the same Terraform and TFLint pins and steps (`fmt -check -recursive -diff`, `init -backend=false`, `validate -no-color`, `test -no-color`, `tflint --init && tflint --config "$PWD/.tflint.hcl"`).
- Add a Checkov step with `pip install --disable-pip-version-check checkov==3.2.471 && checkov -d . --config-file .checkov.yml`.

The workflow's `paths` already cover `terraform/**`.

- [ ] **Step 2: Lint it**

Run: `actionlint .github/workflows/tf-ci.yaml && yamllint -c .yamllint.yml .github/workflows/tf-ci.yaml`
Expected: exit 0. Warnings about the `# vX` pin comments are acceptable, matching the existing jobs.

- [ ] **Step 3: Write `docs/v2-resources.md`**

Sections, in this order:
1. **What the root holds and why it is separate.** The shared-state hazard: `main` and `cashight-v2` would otherwise fight over `terraform/`.
2. **Apply.** The workstation credential bridge, `terraform -chdir=terraform/v2 init`, `plan -out=tfplan`, `apply tfplan`. Expected on the first apply: additions only.
3. **Seed the authorization records.** The Task 5 command, run after every first sign-in on v1 and before each bring-up.
4. **What 4c reads from here.** The output table.
5. **Deleting v2.** The table has deletion protection, and the buckets must be emptied first. `scripts/delete-versioned-s3-bucket.ts` empties a versioned bucket.

- [ ] **Step 4: Record the decision**
- **Open-points file:** under "Consequences of F1–F7", add: "**Revised 2026-11-07:** v2-only persistent resources live in a separate root `terraform/v2/` (state `cashight/v2/terraform.tfstate`), not in `terraform/`, because `main` and `cashight-v2` share `terraform/`'s state and an apply from `main` would destroy them. The Cognito SPA client URLs are the only v1 change and land on `main`." In the 1d table, change the `terraform/` row's "persistent v2 pieces" to point at `terraform/v2/`.
- **`CLAUDE.md` Commands table:** add `v2 persistent resources | see docs/v2-resources.md`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/tf-ci.yaml docs/v2-resources.md CLAUDE.md docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md
git commit -m "docs(v2): add the v2 resources runbook, its CI job and the root decision"
```

## Task 5: Seed the v2 table with the authorization records

**Files:**
- Create: `scripts/v2/seed-authz.ts`
- Test: `scripts/__tests__/seed-authz.test.ts`

**Interfaces:**
- Produces:
  - `seedAuthorizations(deps: SeedDeps, options: SeedOptions): Promise<SeedReport>`
  - `SeedDeps = { scan(table: string): Promise<Record<string, unknown>[]>; put(table: string, item: Record<string, unknown>): Promise<void> }`. `scan` returns every item whose `PK` begins with `AUTHZ#` and whose `SK` is `PROFILE`; `put` overwrites.
  - `SeedOptions = { sourceTable: string; targetTable: string; dryRun: boolean }`
  - `SeedReport = { copied: number; skipped: number }`
  - CLI: `pnpm tsx scripts/v2/seed-authz.ts --source cashight --target cashight-v2 [--dry-run]`. It prints `copied=<n> skipped=<n>` (and `dry-run` when set) and nothing else about the records.

- [ ] **Step 1: Write the failing tests**, using fakes for `SeedDeps`, in the style of `scripts/__tests__/migrate-statements.test.ts`:
  - `copies every valid AUTHZ profile to the target`: two items `{PK:'AUTHZ#abc',SK:'PROFILE',active:true,workspaceId:'primary',createdAt,updatedAt}` give `put` 2× with target `cashight-v2` and the items unchanged. The report is `{copied:2, skipped:0}`.
  - `skips items that are not authorization profiles`: `{PK:'AUTHZ#abc',SK:'OTHER'}` and `{PK:'AUTHZ#',SK:'PROFILE'}` are skipped, giving `{copied:0, skipped:2}`.
  - `dry run writes nothing`: `put` is never called, and the report still counts the would-be copies.
  - `refuses to write into the v1 table`: `targetTable: 'cashight'` rejects with `Refusing: target table cashight is the v1 table`, and `scan` is never called.
  - `refuses identical source and target`: rejects with `Refusing: source and target are the same table`.
  - `never writes to the source`: across all cases, every `put` call's table equals `targetTable`.

Valid means `PK` matches `/^AUTHZ#[A-Za-z0-9][A-Za-z0-9._:-]*$/` and `SK === 'PROFILE'`, the same pattern as `backend/shared/metadata.ts`.

- [ ] **Step 2: Run them and check that they fail**

Run: `pnpm test scripts/__tests__/seed-authz.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `scripts/v2/seed-authz.ts`**
- `seedAuthorizations` does the guards before any I/O, then filters and copies.
- The CLI's real `scan` uses a `DynamoDBDocumentClient` `ScanCommand` with `FilterExpression: 'begins_with(PK, :p) AND SK = :sk'` and follows `LastEvaluatedKey` until it is absent.
- `put` is a `PutCommand` with no condition, so re-running refreshes v2 from v1.
- Region from `AWS_REGION`, default `ap-southeast-1`.
- Structure the CLI entry like `scripts/delete-versioned-s3-bucket.ts`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm test scripts/__tests__/seed-authz.test.ts && pnpm tsc --noEmit`
Expected: 6 passed, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/v2/seed-authz.ts scripts/__tests__/seed-authz.test.ts
git commit -m "feat(v2): add the AUTHZ seed from the v1 table into the v2 table"
```

## Task 6: Process-level error handlers

**Files:**
- Create: `backend/server/process-errors.ts`
- Test: `backend/__tests__/server-process-errors.test.ts`
- Modify: `backend/server/start-api.ts`, `backend/server/start-worker.ts` (call it first)

**Interfaces:**
- Produces: `installProcessErrorHandlers(deps: { on: (event: 'unhandledRejection' | 'uncaughtException', listener: (reason: unknown) => void) => void; log: (message: string, fields: Record<string, string>) => void; exit: (code: number) => void }): void`. Production passes `process.on.bind(process)`, `logger.error` and `process.exit`.

- [ ] **Step 1: Write the failing tests**
  - `logs the error name only and exits 1 on an unhandled rejection`: calling the registered `unhandledRejection` listener with `new TypeError('card 4111111111111111')` logs `('process error', { event: 'unhandledRejection', errorName: 'TypeError' })`, and `exit` is called with 1. No logged field contains `4111`.
  - `handles a non-Error reason`: the reason `'boom'` logs `errorName: 'NonError'`.
  - `uncaughtException behaves the same`: `RangeError` gives `event: 'uncaughtException'`, `errorName: 'RangeError'`, and exit code 1.

- [ ] **Step 2: Run them and check that they fail**

Run: `pnpm test backend/__tests__/server-process-errors.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement** `process-errors.ts`, and call it at the top of `startApiService` and `startWorkerService` before anything else.

Messages are never logged: they can carry statement text (the PCI rule in `CLAUDE.md`).

- [ ] **Step 4: Run the server tests**

Run: `pnpm test backend/__tests__/server-`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/server/process-errors.ts backend/server/start-api.ts backend/server/start-worker.ts backend/__tests__/server-process-errors.test.ts
git commit -m "fix(server): exit on unhandled rejections and exceptions, logging the name only"
```

## Task 7: Per-request deadline

**Files:**
- Modify: `backend/server/http-server.ts` (`ApiServerOptions`, `createApiServer`), `backend/server/start-api.ts` (`apiConfigFromEnv`), `docs/container-runtime.md` (API variables table)
- Test: `backend/__tests__/server-http.test.ts`, `backend/__tests__/server-start.test.ts`

**Interfaces:**
- Produces:
  - `ApiServerOptions.requestTimeoutMs?: number`, default `29_000` (API Gateway's integration limit, which the Lambdas lived under).
  - `apiConfigFromEnv` gains `requestTimeoutMs` from `REQUEST_TIMEOUT_MS` (same integer parsing, default `29000`).

- [ ] **Step 1: Write the failing tests**
  - **`server-http.test.ts`**, using the existing harness:
    - `answers 504 when a handler exceeds the deadline`: a handler that never resolves, with `requestTimeoutMs: 50`, gives status 504 and body `{ error: { code: 'GATEWAY_TIMEOUT' } }` (match the existing `ApiError` JSON shape in `http-server.ts`), with CORS headers present.
    - `handler finishing after the deadline does not write again`: a handler that resolves at 100 ms with `requestTimeoutMs: 50` gives exactly one response (504), no `ERR_HTTP_HEADERS_SENT`, and the 5xx counter incremented once.
  - **`server-start.test.ts`:** update the defaults expectation to include `requestTimeoutMs: 29_000`, and add `REQUEST_TIMEOUT_MS: '1000'` → `1000`.

- [ ] **Step 2: Run them and check that they fail**

Run: `pnpm test backend/__tests__/server-http.test.ts backend/__tests__/server-start.test.ts`
Expected: the two new HTTP tests and the config test FAIL.

- [ ] **Step 3: Implement**
- Race the dispatch against a timer, and clear the timer when either side finishes.
- Whoever writes first owns the response, so a late handler result is dropped (a `responded` flag checked before writing).
- Pass `config.requestTimeoutMs` from `startApiService`.
- Add `REQUEST_TIMEOUT_MS` to the doc's API table.

- [ ] **Step 4: Run the server tests**

Run: `pnpm test backend/__tests__/server-`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/server/http-server.ts backend/server/start-api.ts docs/container-runtime.md backend/__tests__/server-http.test.ts backend/__tests__/server-start.test.ts
git commit -m "fix(server): answer 504 after a per-request deadline"
```

## Task 8: Shutdown hard deadline and exit-code paths

**Files:**
- Create: `backend/server/shutdown.ts`
- Modify: `backend/server/start-api.ts`, `backend/server/start-worker.ts`, `docs/container-runtime.md`
- Test: `backend/__tests__/server-shutdown.test.ts`, `backend/__tests__/server-start.test.ts`

**Interfaces:**
- Produces:
  - `createApiShutdown(deps: { server: Pick<http.Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>; setNotReady(): void; flushTelemetry(): Promise<void>; delayMs: number; hardDeadlineMs: number; log(message: string, fields: Record<string, string | number>): void; exit(code: number): void; setTimer?: typeof setTimeout }): (signal: string) => void`
  - `workerExitCode(state: { fatal: boolean }): 0 | 1`
  - `apiConfigFromEnv` gains `shutdownHardDeadlineMs` from `SHUTDOWN_HARD_DEADLINE_MS` (default `10000`).

- [ ] **Step 1: Write the failing tests** (`vi.useFakeTimers()`)
  - `marks not ready at once and closes after the delay`: after `shutdown('SIGTERM')`, `setNotReady` is called immediately. `close` and `closeIdleConnections` are called only after `delayMs`.
  - `exits 0 after a clean close`: invoking the `close` callback, then flushing, calls `exit(0)` once.
  - `forces exit after the hard deadline`: `close` never calls back. At `delayMs + hardDeadlineMs`, `closeAllConnections` is called, the log is `('shutdown deadline exceeded', { hardDeadlineMs })`, and `exit(1)` is called.
  - `a second signal is ignored`: two calls give one `setNotReady` and one `close`.
  - `workerExitCode`: `{fatal:false}` → 0, `{fatal:true}` → 1.
  - In `server-start.test.ts`: defaults include `shutdownHardDeadlineMs: 10_000`.

- [ ] **Step 2: Run them and check that they fail**

Run: `pnpm test backend/__tests__/server-shutdown.test.ts backend/__tests__/server-start.test.ts`
Expected: FAIL, because the module is missing and the config key is absent.

- [ ] **Step 3: Implement**
- `shutdown.ts`.
- `startApiService` replaces its inline `shutdown` with `createApiShutdown(...)`.
- `startWorkerService` uses `workerExitCode` instead of the mutable `exitCode`.
- Add `SHUTDOWN_HARD_DEADLINE_MS` to the doc. Note that `terminationGracePeriodSeconds` must exceed `SHUTDOWN_DELAY_MS + SHUTDOWN_HARD_DEADLINE_MS`.

- [ ] **Step 4: Run the server tests and the container build**

Run: `pnpm test backend/__tests__/server- && pnpm build:servers`
Expected: all pass, and the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add backend/server/shutdown.ts backend/server/start-api.ts backend/server/start-worker.ts docs/container-runtime.md backend/__tests__/server-shutdown.test.ts backend/__tests__/server-start.test.ts
git commit -m "fix(server): bound API shutdown with a hard deadline and test the exit codes"
```

## Task 9: Image hardening — digest pins, in-image PDF smoke, CI log dump

**Files:**
- Modify: `Dockerfile` (both `FROM` lines), `.github/dependabot.yml`, `scripts/build-servers.mjs`, `.github/workflows/ci.yaml` (`container` job)
- Create: `backend/server/entrypoints/pdf-smoke.ts`, `scripts/fixtures/minimal-pdf.mjs`
- Test: `scripts/__tests__/dockerfile-pins.test.ts`, `scripts/__tests__/build-servers.test.mjs` (extend), `scripts/__tests__/minimal-pdf.test.ts`

**Interfaces:**
- Produces:
  - `dist/servers/parser-worker/pdf-smoke.js`, which takes a PDF path argument, runs `extractPdfText` (`packages/domain/src/parsers/pdf-text.ts`) on it, and prints `{"chars":<n>,"hasSmokeText":<bool>}`. It exits 0 only if the text contains `CASHIGHT SMOKE`.
  - `writeMinimalPdf(path: string): Promise<void>` in `scripts/fixtures/minimal-pdf.mjs`. It writes a valid one-page PDF 1.4 whose text is `CASHIGHT SMOKE`, with a correct xref table. It must not be a real statement: `*.pdf` is gitignored and real PDFs never enter the repo.

- [ ] **Step 1: Write the failing tests**
  - `dockerfile-pins.test.ts`, `every FROM is pinned by digest`: every `FROM` line in `Dockerfile` matches `/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/`.
  - `minimal-pdf.test.ts`, `writes a PDF that extractPdfText reads`: write to a temp path, then `extractPdfText(buffer)`; the text contains `CASHIGHT SMOKE`.
  - `build-servers.test.mjs`: the build output contains `parser-worker/pdf-smoke.js` next to `parser-worker/pdf.worker.mjs`.

- [ ] **Step 2: Run them and check that they fail**

Run: `pnpm test scripts/__tests__/dockerfile-pins.test.ts scripts/__tests__/minimal-pdf.test.ts scripts/__tests__/build-servers.test.mjs`
Expected: three FAILs (unpinned `FROM`, missing fixture module, missing bundle).

- [ ] **Step 3: Implement**
- **`Dockerfile`:** pin `node:22-bookworm-slim` and `gcr.io/distroless/nodejs22-debian12:nonroot` to their current `linux/arm64` multi-arch index digests, resolved with `docker buildx imagetools inspect <image> --format '{{json .Manifest}}'`. Keep the tag in a trailing comment.
- **`.github/dependabot.yml`:** add a `docker` ecosystem (`directory: /`, weekly, `target-branch: cashight-v2`), so the digests get bump PRs.
- **`pdf-smoke.ts`:** the DOM polyfill import must precede the `pdf-text` import (the `CLAUDE.md` rule; `lib/__tests__/pdf-dom-polyfill.test.ts` shows the pattern).
- **`build-servers.mjs`:** after the `parser-worker` bundle, also bundle `pdf-smoke.ts` to `parser-worker/pdf-smoke.js` with the same esbuild options.
- **`ci.yaml` `container` job:**
  - A step after "Worker files are in the image":
    ```bash
    node -e "import('./scripts/fixtures/minimal-pdf.mjs').then(m => m.writeMinimalPdf('/tmp/smoke.pdf'))"
    docker run --rm -v /tmp/smoke.pdf:/smoke.pdf:ro cashight-backend:ci /app/parser-worker/pdf-smoke.js /smoke.pdf
    ```
  - A final step with `if: failure()` that prints `docker logs` for each container the job starts by name (`api`, `aws-api`, `api-default`), ignoring missing ones (`|| true`).

- [ ] **Step 4: Run the checks**

Run: `pnpm test && pnpm build:servers && docker build -t cashight-backend:ci . && node -e "import('./scripts/fixtures/minimal-pdf.mjs').then(m => m.writeMinimalPdf('/tmp/smoke.pdf'))" && docker run --rm -v /tmp/smoke.pdf:/smoke.pdf:ro cashight-backend:ci /app/parser-worker/pdf-smoke.js /smoke.pdf && actionlint .github/workflows/ci.yaml`
Expected: the suite passes. The smoke run prints `"hasSmokeText":true` and exits 0. actionlint exits 0.

- [ ] **Step 5: Commit, push and open the PR for Tasks 1–9**

```bash
git add Dockerfile .github/dependabot.yml scripts/build-servers.mjs .github/workflows/ci.yaml backend/server/entrypoints/pdf-smoke.ts scripts/fixtures/minimal-pdf.mjs scripts/__tests__/dockerfile-pins.test.ts scripts/__tests__/minimal-pdf.test.ts scripts/__tests__/build-servers.test.mjs
git commit -m "build(container): pin base images by digest, smoke-test PDF parsing in the image"
git push -u origin feat/v2-resources
gh pr create --base cashight-v2 --title "feat(v2): persistent v2 resources and runtime hardening (Plan 4b)" --body "<summary, Tasks 1-9 validation>"
```
Expected: `CI`, `Terraform CI` (including the new `v2` job) and `Platform CI` are green. No deploy workflow runs.

## Task 10: v2 URLs on the shared Cognito SPA client (on `main`)

**Files:**
- Modify: `terraform/cognito.tf` (`aws_cognito_user_pool_client.spa`: `callback_urls`, `logout_urls`)
- Test: `terraform/tests/auth_api_edge.tftest.hcl`

**Interfaces:**
- Produces: the SPA client accepts `https://cashight-v2.nghuy.link/auth/callback/` and `https://cashight-v2.nghuy.link/signin/`. 4c's v2 SPA build signs in through it.

- [ ] **Step 1: Branch from `main` and write the failing assertion**

```bash
git switch main && git pull --ff-only && git switch -c feat/cognito-v2-urls
```
Add to the existing SPA-client run in `auth_api_edge.tftest.hcl`:
```hcl
assert {
  condition = (
    contains(aws_cognito_user_pool_client.spa.callback_urls, "https://cashight-v2.nghuy.link/auth/callback/") &&
    contains(aws_cognito_user_pool_client.spa.logout_urls, "https://cashight-v2.nghuy.link/signin/") &&
    contains(aws_cognito_user_pool_client.spa.callback_urls, "https://cashight.nghuy.link/auth/callback/")
  )
  error_message = "v2 URLs are added and the production URLs stay"
}
```

- [ ] **Step 2: Run it and check that it fails**

Run: `terraform -chdir=terraform init -backend=false && terraform -chdir=terraform test`
Expected: the new assertion FAILs, and every other assertion passes.

- [ ] **Step 3: Add the two URLs** to the lists, after the production entries. Comment: "v2 parallel stack (open-points answer 4); remove at the rename."

- [ ] **Step 4: Run the checks and open the PR into `main`**

Run: `terraform -chdir=terraform fmt -check -recursive && terraform -chdir=terraform test`, then commit and run `gh pr create --base main`.
Expected: tests pass and `Terraform CI` is green.

- [ ] **Step 5: After merge, apply from `main` (workstation). Stop gate**

```bash
git switch main && git pull --ff-only
terraform -chdir=terraform init && terraform -chdir=terraform plan -out=tfplan -input=false
```
Expected: `Plan: 0 to add, 1 to change, 0 to destroy`, and the only change is `aws_cognito_user_pool_client.spa`, gaining exactly the two URLs. **Anything else: stop, do not apply, and report the drift.** Otherwise run `terraform -chdir=terraform apply tfplan`.

- [ ] **Step 6: Merge `main` forward into `cashight-v2`** through a PR (`git switch -c chore/merge-main-into-v2 origin/cashight-v2 && git merge origin/main`, push, `gh pr create --base cashight-v2`). The branching rule is that fixes flow forward from `main`, never back.

## Task 11: Apply `terraform/v2` and seed it (workstation, after Tasks 1–10 are merged)

- [ ] **Step 1: Apply**

```bash
git switch cashight-v2 && git pull --ff-only
eval "$(aws configure export-credentials --format env)"
terraform -chdir=terraform/v2 init && terraform -chdir=terraform/v2 plan -out=tfplan -input=false
```
Expected: additions only (`0 to change, 0 to destroy`). The plan includes no resource from `terraform/`, and the v1 state is only read. Then run `terraform -chdir=terraform/v2 apply tfplan`. The certificate validations can take a few minutes, and the CloudFront distribution 5–15 minutes.

- [ ] **Step 2: Check the results**

```bash
aws acm describe-certificate --region us-east-1 --certificate-arn "$(terraform -chdir=terraform/v2 output -raw frontend_certificate_arn)" --query Certificate.Status --output text   # ISSUED
aws acm describe-certificate --certificate-arn "$(terraform -chdir=terraform/v2 output -raw api_certificate_arn)" --query Certificate.Status --output text   # ISSUED
curl -sI https://cashight-v2.nghuy.link | head -1   # 403 or 404 is expected: the bucket is empty until 4c's SPA deploy
aws dynamodb describe-table --table-name cashight-v2 --query 'Table.[TableStatus,DeletionProtectionEnabled]'   # ACTIVE, true
```

- [ ] **Step 3: Seed**

```bash
pnpm tsx scripts/v2/seed-authz.ts --source cashight --target cashight-v2 --dry-run
pnpm tsx scripts/v2/seed-authz.ts --source cashight --target cashight-v2
```
Expected: the two runs report the same `copied` count, which is at least 2 (your user and the smoke client), with `skipped=0`.

- [ ] **Step 4: Prove v1 is unchanged**

Run: `terraform -chdir=terraform plan -detailed-exitcode -input=false` from `main`.
Expected: exit 0, with no changes. Task 10's apply already landed.

- [ ] **Step 5: Record the add count and the seed result** as a comment on the Tasks 1–9 PR.

## Done when

- `terraform/v2` is applied, and its outputs list the table, buckets, queues, ECR repository, CI role, certificates and distribution. Both certificates are `ISSUED`, and `cashight-v2.nghuy.link` resolves to CloudFront.
- `cashight-v2` holds the authorization records copied from `cashight`.
- The SPA client lists the v2 callback and sign-out URLs. `terraform/` plans clean from `main`, and no other v1 resource changed.
- `pnpm test`, `pnpm tsc --noEmit` and `pnpm lint` pass, and `CI`, `Terraform CI` and `Platform CI` are green on both PRs.
- The CI image is digest-pinned and parses a PDF inside the container, and the container job prints logs when it fails.
- The open-points file records the `terraform/v2` decision.

## Handover to Plan 4c

- **Pod Identity roles** for the four workloads go in `terraform/platform/`, which is ephemeral because their associations need the cluster. Their policies get the v2 ARNs from `terraform/v2` outputs through `terraform_remote_state` (key `cashight/v2/terraform.tfstate`), and each one carries the union of its former Lambda policies (spec §4.2), pointed at the v2 data stores.
- **KEDA scaler roles** go in `terraform/platform/`. They trust `keda_operator_role_arn` and hold `sqs:GetQueueAttributes` on `parse_queue_arn` / `invoice_parse_queue_arn` only.
- **The `api.cashight-v2.nghuy.link` record** goes in `terraform/platform/`, as an alias to the ALB. The Ingress uses `api_certificate_arn` and moves the `platform-public` group to `[{"HTTP":80},{"HTTPS":443}]`.
- **Workload environment:**
  - `TABLE_NAME=cashight-v2`, the v2 bucket names, the v2 `QUEUE_URL`s and `ALLOWED_ORIGIN=https://cashight-v2.nghuy.link`.
  - `COGNITO_USER_POOL_ID` from v1, and `COGNITO_CLIENT_IDS` = v1 SPA client + smoke client.
  - `REQUEST_TIMEOUT_MS`, `SHUTDOWN_DELAY_MS` and `SHUTDOWN_HARD_DEADLINE_MS` per `docs/container-runtime.md`.
  - API `terminationGracePeriodSeconds` > 15.
- **The image workflow** assumes `github_ci_role_arn` on pushes to `cashight-v2`, pushes `cashight-backend:<sha>`, and pins the digest in `deploy/cashight/`. The v2 SPA build is deployed to `frontend_bucket_name`, followed by an invalidation of `cloudfront_distribution_id`.
- **The seed script** runs as part of each bring-up.
