# Serverless Deployment Guide

Deployment guide for the Cashight hybrid serverless architecture: Next.js static SPA on CloudFront/S3 with Lambda + API Gateway backend.

> **Staging URL**: `https://next.cashight.nghuy.link` (temporary; becomes `cashight.nghuy.link` after Phase 9 DNS cutover)
> **API URL**: `https://api.cashight.nghuy.link`

---

## Workflows

Three GitHub Actions workflows handle deployment:

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yaml` | Pull request to `main` | Build, test, typecheck, package artifacts |
| `infrastructure-deploy.yaml` | Manual (`workflow_dispatch`) | Terraform plan + apply |
| `application-deploy.yaml` | Manual (`workflow_dispatch`) | Lambda canary + frontend + smoke tests |
| `deploy.yaml` | Push to `main` | Amplify rollback target (retain until Phase 10) |

## Prerequisites

### GitHub Actions variables (set in repository settings)

| Variable | Value (from `terraform output`) |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `terraform output github_deploy_role_arn` |
| `AWS_INFRA_ROLE_ARN` | ARN of a Terraform admin IAM role |
| `ARTIFACTS_BUCKET` | `terraform output artifacts_bucket_name` |
| `FRONTEND_BUCKET` | `terraform output frontend_bucket_name` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output cloudfront_distribution_id` |

### GitHub environment

A `production` environment must exist with required reviewers configured. Both the `infrastructure-deploy` and `application-deploy` workflows gate their apply/deploy jobs on this environment.

---

## Deploying a release

### Step 1: CI (automatic on PR)

Every pull request automatically:
- Runs `pnpm audit`, typecheck, lint, unit tests
- Builds all 7 Lambda functions and zips them
- Runs a Next.js static export with placeholder public config
- Verifies the static export with `pnpm verify:static`
- Uploads `lambda-artifacts-{sha}` and `frontend-export-{sha}` as workflow artifacts (30-day retention)

Record the CI **run ID** from the Actions tab — the deploy workflow uses it to download the exact artifact set.

### Step 2: Apply infrastructure changes (when Terraform changed)

1. Go to **Actions → Infrastructure Deploy → Run workflow**
2. Select `plan` and click Run
3. Review the plan output in the workflow run
4. Re-run with `apply` — the `production` environment gate prompts for approval
5. The apply job downloads the binary plan from Step 1 and applies it verbatim (no re-plan)

### Step 3: Deploy application

1. Go to **Actions → Application Deploy → Run workflow**
2. Enter the **CI run ID** from Step 1 (the number in the URL of the CI run)
3. Click Run — the `production` environment gate prompts for approval

The workflow does the following in sequence:

**Backend (deploy-backend job):**
- Downloads Lambda zips from the CI artifact
- Uploads each zip to `s3://{ARTIFACTS_BUCKET}/lambdas/{sha}/{fn}.zip`
- Calls `aws lambda update-function-code --publish` for each function
- Waits for the code update to propagate
- Creates a CodeDeploy deployment using `LambdaCanary10Percent5Minutes` for each function
- Waits for all 7 canary deployments to succeed (~5 minutes each, run to completion before frontend)

**Frontend (deploy-frontend job, runs after backend):**
- Downloads the `frontend-export-{sha}` artifact
- Calls `node scripts/deploy-frontend.mjs` which uploads in safe order:
  1. `_next/static/**` with 1-year immutable cache headers
  2. Non-HTML assets (favicon, robots.txt, etc.)
  3. Route HTML files (signin/, upload/, etc.)
  4. `index.html` last (atomic SPA shell switch-over)
- Creates targeted CloudFront invalidations (not `/*`):
  `/`, `/index.html`, `/signin/*`, `/auth/*`, `/upload/*`, `/statements/*`

**Smoke tests (after both backend and frontend):**
- Runs `node scripts/smoke-serverless.mjs` against `APP_URL` and `API_URL`
- Checks: health endpoint, auth rejection, static deep links, security headers
- Fails the workflow if any check fails

**Release manifest (after smoke tests):**
- Records Lambda versions, frontend checksums, and CloudFront ID to S3:
  - `s3://{ARTIFACTS_BUCKET}/manifests/{sha}.json` — versioned
  - `s3://{ARTIFACTS_BUCKET}/manifests/latest.json` — current pointer

---

## Rollback

### Lambda rollback

CodeDeploy auto-rolls back on deployment failure. To manually roll back to the previous version:

```bash
# Get the previous release manifest to find the prior Lambda version
aws s3 cp s3://<ARTIFACTS_BUCKET>/manifests/latest.json - | jq '.previousManifestKey'

# For each function, update the live alias to point to the previous version
aws lambda update-alias \
  --function-name cashight-<fn> \
  --name live \
  --function-version <previous_version_number>
```

### Frontend rollback

Re-run `application-deploy.yaml` with the CI run ID from the previous good release. The deploy script uploads in safe order and old `_next/static/` chunks are never deleted, so old SPA shells continue to work.

### Full rollback to Amplify

Until Phase 10 decommission, the Amplify deployment at the original domain remains available:

```bash
# Revert DNS to Amplify (in terraform/edge.tf or Route 53 console)
# The deploy.yaml workflow continues to deploy to Amplify on push to main
```

---

## Local scripts

| Script | Purpose |
|---|---|
| `pnpm deploy:frontend` | Upload `out/` to S3 + CloudFront invalidation |
| `pnpm release:manifest` | Record release manifest in S3 |
| `pnpm smoke:serverless` | Run smoke tests against APP_URL / API_URL |

Required env vars for local use: `FRONTEND_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `ARTIFACTS_BUCKET`, `GIT_SHA`, `APP_URL`, `API_URL`.

---

## Smoke tests

`scripts/smoke-serverless.mjs` checks (all unauthenticated):

| Check | Expected |
|---|---|
| `GET /health` | 200 |
| `GET /statements` (no auth) | 401 |
| `GET /dashboard` (no auth) | 401 |
| `POST /uploads` (no auth) | 401 |
| `GET /` | 200, HTML |
| `GET /signin/` | 200, HTML |
| `GET /upload/` | 200, HTML |
| `GET /statements/` | 200, HTML |
| `GET /auth/callback/` | 200, HTML |
| Security headers on static | `X-Content-Type-Options: nosniff` + frame policy |

Authenticated checks (upload, CRUD, AI stream) are covered by the Playwright suite in `tests/e2e/` run as part of Phase 9 cutover verification.

---

## Phase 6 verification (temporary topology)

Before Phase 9 DNS cutover, verify the complete stack at the temporary URLs:

```bash
# 1. Deploy infrastructure (Terraform apply)
#    → Provisions Lambda, API GW, CloudFront, Cognito, etc.

# 2. Run the statement data migration
pnpm migrate:statements \
  --user-sub <your-cognito-sub> \
  --source-prefix statements/ \
  --report .migration-private/statement-migration.json \
  --dry-run
# Review, then re-run with --apply

# 3. Reconcile
pnpm reconcile:statements \
  --user-sub <your-cognito-sub> \
  --report .migration-private/reconciliation.json

# 4. Deploy application (via application-deploy.yaml workflow)

# 5. Run smoke tests
APP_URL=https://next.cashight.nghuy.link \
API_URL=https://api.cashight.nghuy.link \
pnpm smoke:serverless

# 6. Export CloudWatch logs and scan for PII
aws logs filter-log-events \
  --log-group-name /aws/lambda/cashight-parser-worker \
  --start-time $(date -d '1 hour ago' +%s000) \
  > .migration-private/serverless-production.log
pnpm security:scan-logs .migration-private/serverless-production.log
```

Expected: all smoke tests pass, log scan reports no PII.

---

## Required GitHub secrets

These are stored in the `production` environment secrets:

| Secret | Description |
|---|---|
| `GITHUB_TOKEN` | Auto-provided by Actions for artifact downloads |

Secrets managed outside GitHub Actions (in AWS Secrets Manager):
- `GEMINI_API_KEY`
- `PDF_PASSWORD`
- Google OAuth client secret (referenced by Cognito)

---

## Commit convention

```
ci: add serverless deployment and rollback pipelines
```
