# Deployment Runbook — Amplify (Terraform) + GitHub Actions (Step 11)

Operational steps to take Cashight live on AWS Amplify Hosting (SSR) in `ap-southeast-1`
and wire up the GitHub Actions → Amplify release pipeline (Option A).

> Full rationale lives in [`docs/plans/11-amplify-deployment.md`](./plans/11-amplify-deployment.md).
> This file is the short, do-this-in-order checklist.

## What Terraform manages now (no console wizard)

The Amplify app is **provisioned by Terraform** (`terraform/amplify.tf`), so the app-id is
an output instead of a console lookup, and several previously-manual steps are declarative:

- `aws_amplify_app.cashight` — SSR app (`WEB_COMPUTE`), build spec from `amplify.yml`,
  **non-secret** env vars, and a Terraform-managed service role.
- `aws_amplify_branch.main` — production branch with **native auto-build OFF** (so GitHub
  Actions is the only deploy trigger — the old manual "A1" step is now declarative).
- `aws_iam_role.amplify_service` + `aws_iam_role_policy_attachment.amplify_service_s3` —
  the SSR runtime's role, already granted statements-bucket access (old manual "A2 S3" step).
- `terraform/github-oidc.tf` — GitHub OIDC provider + `cashight-github-deploy` role,
  now scoped to the app-id Terraform created (no manual `-var amplify_app_id`).
- `.github/workflows/deploy.yaml` — `verify` (lint/build/test) gates a `deploy` job that
  assumes the role via OIDC and polls an Amplify `RELEASE` job.

**Two things stay manual on purpose** (Terraform can't / shouldn't do them):

1. **Authorizing the Amplify GitHub App** on the repo — a one-time browser OAuth step.
   (Skip it only if you pass `github_access_token`; see Step 1.)
2. **Secret env vars** — set in the console so they never land in Terraform state.

## Context values

- AWS account: `010382427026`
- Region: `ap-southeast-1`
- GitHub repo: `HuyNguyen260398/cashight`

---

## Step 1 — Apply the infrastructure

```bash
cd terraform
# auth bridge if using an `aws login` session:
eval "$(aws configure export-credentials --format env)"

terraform apply
```

This creates the Amplify app, the `main` branch (auto-build off), the service role +
S3 attachment, and the OIDC deploy role — all in one apply.

⚠️ The GitHub OIDC provider is **account-global**. If apply errors that the provider
already exists, import it then re-apply:

```bash
terraform import aws_iam_openid_connect_provider.github \
  arn:aws:iam::010382427026:oidc-provider/token.actions.githubusercontent.com
```

**Connecting the repo** — two options:

- **Recommended (GitHub App):** leave `github_access_token` unset. After `apply`, open the
  Amplify Console → the `cashight` app → and complete the repo connection by authorizing the
  **AWS Amplify GitHub App** on `HuyNguyen260398/cashight`. Terraform owns everything else.
- **Fully automated (PAT):** create a GitHub PAT with `repo` + `admin:repo_hook` scopes and
  apply with `-var github_access_token=<PAT>` (or put it in a gitignored `*.auto.tfvars`).
  Terraform connects the repo and creates the webhook itself. The token is `sensitive` and
  `ignore_changes`d, but note it transits Terraform state — prefer the GitHub App path.

➡️ **Record the outputs:**

```bash
terraform output amplify_app_id            # → AMPLIFY_APP_ID GitHub variable
terraform output -raw github_deploy_role_arn  # → AWS_DEPLOY_ROLE_ARN GitHub variable
terraform output amplify_app_url           # production URL once deployed
```

## Step 2 — Set the secret env vars in the Amplify Console

Terraform set the **non-secret** env vars (`AWS_REGION`, `STATEMENTS_BUCKET`,
`AUTH_COGNITO_ID`, `AUTH_COGNITO_ISSUER`). Add the **secrets** in the console
(App settings → Environment variables) so they stay out of Terraform state:

- `GEMINI_API_KEY` — from Google AI Studio
- `PDF_PASSWORD` — password for the protected TPBank PDFs
- `AUTH_SECRET` — `openssl rand -base64 32`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth client
- `ALLOWED_EMAIL` — the single allowed account
- `AUTH_COGNITO_SECRET` — `terraform output -raw cognito_user_pool_client_secret`

> These coexist with the Terraform-set vars; `aws_amplify_app.cashight` has
> `ignore_changes = [environment_variables]` so a later `terraform apply` won't delete them.

## Step 3 — Set GitHub Actions repository variables

Settings → Secrets and variables → Actions → **Variables** tab (neither is a secret):

- `AWS_DEPLOY_ROLE_ARN` = `terraform output -raw github_deploy_role_arn`
- `AMPLIFY_APP_ID` = `terraform output -raw amplify_app_id`

## Step 4 — Merge to `main`

⚠️ **Do not merge `deploy.yaml` to `main` until Steps 1–3 are done** — otherwise every push
to `main` fails the `deploy` job (missing app-id / role variables, or unconnected repo).

Once the prerequisites are in place, merge `feat/step-11-amplify-deployment`. The first push
to `main` runs `verify` → `deploy`; a manual redeploy is available via the workflow's
`workflow_dispatch` trigger.

## Step 5 — Verify production

At `terraform output -raw amplify_app_url` (`https://main.<APP_ID>.amplifyapp.com`):

- [ ] Home page loads (empty state, no statements yet)
- [ ] Upload the sample PDF → succeeds
- [ ] Object appears in S3: `aws s3 ls s3://<STATEMENTS_BUCKET>/statements/ --recursive`
- [ ] Dashboard renders (KPIs, charts, table)
- [ ] AI summary streams
- [ ] Works on a real mobile device

## Step 6 — CloudWatch logs (PII gate)

CloudWatch → the Amplify SSR log group:

- [ ] No error patterns in the first invocations
- [ ] **No PII** — no full card numbers, no raw statement contents
- [ ] If anything sensitive appears, fix logging and redeploy before going further

---

## Ordering (why it's strict)

```
terraform apply (Step 1)  ──► Amplify app + branch + roles + app-id output
        │                     (+ authorize GitHub App, unless using a PAT)
        ├─► Step 2  set secret env vars in console
        ├─► Step 3  set GitHub repo variables from TF outputs
        │                 │
        │                 └─► Step 4  merge to main  ──► Steps 5–6 verify
```

## Optional (post-launch)

- **Custom domain** — add `aws_amplify_domain_association` to `amplify.tf`, or use the
  Amplify Console → Domain management (auto-config if in Route 53).
- **Branch deploys** — connect `develop` with its own `STATEMENTS_BUCKET` to isolate data.
- **Alarms** — CloudWatch alarm on Lambda errors > 5/hr; AWS Budgets email at > $5/mo.
