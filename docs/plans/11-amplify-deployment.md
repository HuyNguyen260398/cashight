# Step 11 — Deploy to AWS Amplify

> Get the app running in production on AWS Amplify Hosting compute with all environment variables, IAM permissions, and the right Next.js 15 build configuration.

**Estimated effort:** 1–2 hours
**Prerequisites:** Step 10
**Phase:** 3 — Polish / Deployment

---

> **⚠️ Superseded by a Terraform flow (2026-06).** Amplify is now provisioned in
> `terraform/amplify.tf` (app + `main` branch + service role + S3 attachment), so several
> manual steps below no longer apply: the console "New app" wizard (Task 3), the S3-policy
> attachment (Task 4 / "A2 S3"), disabling native auto-build (A1 — now `enable_auto_build = false`),
> and `terraform apply -var amplify_app_id=…` (the app-id is a Terraform output that
> `github-oidc.tf` references directly). **Follow [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) as the
> authoritative runbook.** The tasks below are kept for design rationale and the env-var /
> CloudWatch / verification details, which still hold.

## Goal

The app is live at a public URL (an `amplifyapp.com` subdomain or your own domain). Pushes to `main` auto-deploy. Environment variables are configured. The Amplify service role has S3 permissions.

## Tasks

### 1. Push to GitHub

The repo needs to be on GitHub for Amplify to connect:

```bash
git remote add origin git@github.com:huy/expense-tracker.git
git push -u origin main
```

Confirm `.env.local` is gitignored. Verify nothing in the commit history contains `GEMINI_API_KEY` or AWS keys. If it does:
```bash
# Rotate the key immediately, then clean history before pushing
```

### 2. Create `amplify.yml`

In the repo root:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - corepack enable
        - corepack prepare pnpm@latest --activate
        - pnpm install --frozen-lockfile
    build:
      commands:
        - pnpm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
```

Commit and push.

### 3. Connect repo in Amplify Console

1. Open [AWS Amplify Console](https://console.aws.amazon.com/amplify) in `ap-southeast-1`
2. **New app → Host web app**
3. Choose GitHub → authorize → select `expense-tracker` repo → `main` branch
4. Amplify detects Next.js automatically (it should display "Next.js - SSR")
5. Review the build settings — should match `amplify.yml` from step 2
6. **Advanced settings → Environment variables:**
   - `GEMINI_API_KEY` = `<from Google AI Studio>`
   - `STATEMENTS_BUCKET` = `<from terraform output>`
   - `AWS_REGION` = `ap-southeast-1`
   - `PDF_PASSWORD` = `<password for protected TPBank statement PDFs>`
   - `AUTH_SECRET` = `<openssl rand -base64 32 / npx auth secret>`
   - `AUTH_GOOGLE_ID` = `<Google OAuth client ID>`
   - `AUTH_GOOGLE_SECRET` = `<Google OAuth client secret>`
   - `ALLOWED_EMAIL` = `<the single allowed Google account email>`
   - `AUTH_COGNITO_ID` = `<terraform output cognito_user_pool_client_id>`
   - `AUTH_COGNITO_SECRET` = `<terraform output -raw cognito_user_pool_client_secret>`
   - `AUTH_COGNITO_ISSUER` = `<terraform output cognito_issuer>`
7. **Service role:** create a new one (or pick existing). Note the role name.
8. Save and deploy.

The first build takes 4-8 minutes.

### 4. Attach S3 policy to Amplify service role

The Amplify service role needs S3 access to the statements bucket. Use the policy created in Step 06:

```bash
# Get the policy ARN from Step 06
cd terraform
POLICY_ARN=$(terraform output -raw statements_policy_arn)

# Find the Amplify service role name (from Amplify console → app settings → general)
ROLE_NAME="amplifyconsole-backend-role-xxxxx"

aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn $POLICY_ARN
```

Or, do it in Terraform for full IaC:
```hcl
data "aws_iam_role" "amplify" {
  name = "amplifyconsole-backend-role-xxxxx"
}

resource "aws_iam_role_policy_attachment" "amplify_s3" {
  role       = data.aws_iam_role.amplify.name
  policy_arn = aws_iam_policy.statements_rw.arn
}
```

### 5. Verify production deployment

Visit the Amplify-provided URL (`https://main.xxxxx.amplifyapp.com`):

- Home page loads → see empty state (no statements yet)
- Click "Upload statement" → upload the sample PDF
- Verify it appears in S3 via CLI
- Verify the dashboard renders
- Verify the AI summary streams
- Test on mobile (real device)

### 6. CloudWatch Logs check

Open CloudWatch Logs → find the Amplify SSR log group:
- Look for any error patterns in the first few invocations
- Verify there's no PII in logs (no card numbers, no statement contents)
- If you see anything sensitive, fix the logging immediately and re-deploy

### 7. Custom domain (optional)

If you want `expenses.huy.dev` or similar:

1. **Amplify Console → Domain management → Add domain**
2. If domain is in Route 53: Amplify configures it automatically
3. If domain is elsewhere: Amplify gives you CNAME records to add
4. SSL cert is provisioned automatically via ACM
5. Wait 10-30 minutes for DNS + cert

### 8. Optional: branch deploys for testing

- Push a `develop` branch
- In Amplify Console → connect the branch → it gets its own URL
- Use a different `STATEMENTS_BUCKET` env var (e.g., `expense-tracker-statements-dev-...`) to isolate data

### 9. Monitoring / alerts (light touch)

For personal use, full observability is overkill. But consider:

- **CloudWatch alarm:** alert if Lambda errors exceed 5/hour (catches Gemini quota exhaustion early)
- **Budget alert:** AWS Budgets → email when monthly cost exceeds $5 (catches surprises)

Both are 5 minutes to set up via console, can be Terraform-managed later.

## Files affected

- `amplify.yml` — **create** (in repo root)
- `terraform/iam.tf` — optionally modify (attach policy to Amplify role)
- README — update with deployment URL

## Acceptance criteria

- Amplify build completes without errors
- Production URL loads the home page
- Uploading a statement via production URL writes to S3
- AI summary works in production
- Production logs show no errors and no PII
- Pushing a commit to `main` triggers an auto-deploy
- (If custom domain) HTTPS works at the custom domain

## Notes & gotchas

- **`baseDirectory: .next` is mandatory for Next.js 15.** Amplify Hosting compute requires this regardless of SSG/SSR — this is the #1 mistake when deploying Next.js to Amplify.
- **The Amplify-detected build settings can be wrong.** Always verify the `amplify.yml` it shows matches what's in your repo. If they conflict, the repo file wins.
- **First deploy fails often.** Common causes:
  - Missing env vars → Lambda crashes on first request
  - Wrong region → S3 GETs fail
  - Wrong IAM permissions → S3 PutObject denied
  Check CloudWatch Logs first for any debugging.
- **pnpm version pinning matters.** The `packageManager` field in `package.json` should match what `corepack prepare` installs — keep them in sync.
- **Don't put `GEMINI_API_KEY` in `amplify.yml`** — env vars must be in the Amplify Console (encrypted at rest) or via Secrets Manager for stronger isolation.
- **Cold starts:** the first request after idle takes 1-2 seconds (Lambda init + Next.js boot). Warm requests are sub-200ms. For personal use this is fine.
- **Build minutes are billed after the free tier.** A typical Next.js build is ~5 minutes; at $0.01/min, that's $0.05 per push. Don't trigger builds on every typo.

## CI/CD automation (Option A) — GitHub Actions gates and triggers the deploy

> Added 2026-06-02. This layers a GitHub-driven pipeline on top of the base deployment above. Tasks 1–9 stand up Amplify itself; this section makes pushes to `main` deploy **only after** lint/build/test pass, using keyless AWS auth. **Status: planned — implement later.**

### Why this design

An Amplify **SSR (`WEB_COMPUTE`) app cannot use manual/zip deploys** — the production build *must* run inside Amplify via `amplify.yml`. So GitHub Actions cannot build-and-upload artifacts; it can only **trigger** an Amplify build job on the Git-connected branch (`aws amplify start-job --job-type RELEASE`). The division of labor:

| Stage | Runs in | What it does |
| --- | --- | --- |
| Build (verification) | GitHub Actions | `pnpm lint && pnpm build && pnpm test` — the gate |
| Release | GitHub Actions | `aws amplify start-job --job-type RELEASE`, then polls the job |
| Deploy (the real build) | Amplify | runs `amplify.yml`, deploys the SSR compute |

To make Actions the **single** trigger (no double builds, tests always gate prod), **Amplify's native auto-build is disabled** — pushes no longer auto-deploy; the workflow does.

Auth is **GitHub OIDC → a scoped AWS IAM role** — no long-lived AWS keys stored in GitHub. The role's trust policy is locked to this repo + `refs/heads/main`, and its permissions are limited to `amplify:StartJob/GetJob/ListJobs` on this one app. It's provisioned in Terraform alongside the Step 06 / PR #25 IAM.

### Prerequisites

- Tasks 1–5 done: the Amplify app + `main` branch are connected in the console. That console connect is what produces the **`app-id`** the workflow needs — OIDC can't be set up until the app exists.

### Tasks

**A1. Disable Amplify auto-build** so Actions is the only deploy trigger:
```bash
aws amplify update-branch \
  --app-id <APP_ID> \
  --branch-name main \
  --no-enable-auto-build \
  --region ap-southeast-1
```
(Or Console → App settings → Branch settings → disable auto-build.)

**A2. Provision GitHub OIDC + deploy role in Terraform.** New file `terraform/github-oidc.tf`. Because it's a *new* file, you simply add it when you have the `app-id` — no `count`-gating trick (unlike the `amplify_s3` attachment in `iam.tf`, which lives in an already-applied file):
```hcl
variable "github_repository" {
  type        = string
  description = "owner/repo permitted to assume the deploy role via OIDC."
  default     = "HuyNguyen260398/cashight"
}

variable "amplify_app_id" {
  type        = string
  description = "Amplify app id from the console (App settings → General)."
}

data "aws_caller_identity" "current" {}

# GitHub's OIDC provider is account-global. If one already exists in the
# account, import it instead of creating a duplicate:
#   terraform import aws_iam_openid_connect_provider.github \
#     arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates the OIDC cert chain against its trusted CAs; the thumbprint
  # is no longer security-critical but the argument is still required.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.project_name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_trust.json
}

data "aws_iam_policy_document" "amplify_release" {
  statement {
    effect = "Allow"
    actions = [
      "amplify:StartJob",
      "amplify:GetJob",
      "amplify:ListJobs",
    ]
    resources = [
      "arn:aws:amplify:${var.region}:${data.aws_caller_identity.current.account_id}:apps/${var.amplify_app_id}/branches/*/jobs/*",
    ]
  }
}

resource "aws_iam_role_policy" "amplify_release" {
  name   = "amplify-release"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.amplify_release.json
}

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Set as the AWS_DEPLOY_ROLE_ARN GitHub Actions variable."
}
```
Apply: `terraform apply -var amplify_app_id=<APP_ID>`.

**A3. Set GitHub Actions repository variables** (Settings → Secrets and variables → Actions → **Variables** — neither value is a secret):
- `AWS_DEPLOY_ROLE_ARN` = `terraform output -raw github_deploy_role_arn`
- `AMPLIFY_APP_ID` = the app id

**A4. Add the deploy workflow** `.github/workflows/deploy.yaml`:
```yaml
name: Deploy to Amplify

on:
  push:
    branches: [main]
  workflow_dispatch:

# Never cancel an in-flight production deploy.
concurrency:
  group: deploy-main
  cancel-in-progress: false

permissions:
  id-token: write   # required for OIDC
  contents: read

env:
  AWS_REGION: ap-southeast-1
  AMPLIFY_BRANCH: main

jobs:
  verify:
    name: Lint, Build & Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v6        # reads pnpm 11.2.2 from packageManager
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm run --if-present test

  deploy:
    name: Trigger Amplify Release
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Start Amplify release and wait
        env:
          APP_ID: ${{ vars.AMPLIFY_APP_ID }}
        run: |
          set -euo pipefail
          JOB_ID=$(aws amplify start-job \
            --app-id "$APP_ID" --branch-name "$AMPLIFY_BRANCH" \
            --job-type RELEASE \
            --query 'jobSummary.jobId' --output text)
          echo "Started Amplify job $JOB_ID"
          while true; do
            STATUS=$(aws amplify get-job \
              --app-id "$APP_ID" --branch-name "$AMPLIFY_BRANCH" \
              --job-id "$JOB_ID" \
              --query 'job.summary.status' --output text)
            echo "status=$STATUS"
            case "$STATUS" in
              SUCCEED)          echo "✅ deploy succeeded"; exit 0 ;;
              FAILED|CANCELLED) echo "❌ deploy $STATUS"; exit 1 ;;
              *)                sleep 15 ;;
            esac
          done
```

The `verify` job intentionally re-runs the same checks as `ci.yaml`: `ci.yaml` gates the **PR**, `verify` gates the **merged `main`** state before the deploy fires.

### Files affected (this section)

- `.github/workflows/deploy.yaml` — **create**
- `terraform/github-oidc.tf` — **create**
- existing `ci.yaml` / `tf-ci.yaml` — unchanged

### Acceptance criteria (this section)

- Amplify auto-build is **off**; pushing to `main` does not auto-deploy on its own.
- A push to `main` runs `verify`; on failure, **no** Amplify job is triggered.
- On `verify` success, the `deploy` job assumes the role via OIDC (no static keys) and the workflow exits non-zero if the Amplify job ends `FAILED`/`CANCELLED`.
- `workflow_dispatch` can trigger a manual redeploy.
- The IAM role can only `StartJob`/`GetJob`/`ListJobs` on this one app, only from `refs/heads/main` of this repo.

### Notes & gotchas (this section)

- **OIDC provider may already exist** in the account — creating a second one errors. Import it (command in the Terraform comment) if so.
- **Chicken-and-egg sequencing:** the role/workflow need the `app-id`, which only exists after the console connect (Tasks 3–5). Order: connect Amplify → disable auto-build (A1) → `terraform apply -var amplify_app_id=…` (A2) → set repo variables (A3) → merge `deploy.yaml` (A4).
- **Don't widen the trust `sub`.** Keeping it to `repo:<owner>/<repo>:ref:refs/heads/main` stops any other branch or PR from assuming the deploy role.
- **Build minutes:** `verify` adds one GitHub Actions build per push to `main`; the Amplify build still runs once. Versus native auto-build that's ~one extra (free-tier) GitHub build — and broken code no longer burns an Amplify build.

## Done ✅

If everything above checks out, the app is live and the implementation plan is complete.

What's next (post-deploy):
- Use it for a month, see what's annoying
- Iterate based on real data (more bank parsers? Better categories?)
- Phase 4 (multi-bank) and Phase 5 (budgets/forecasting) from the master plan, if useful

## Reference

- [Master plan](./expense-tracker-implementation-plan.md) — full architecture and rationale
- [Step index](./00-INDEX.md) — all steps
