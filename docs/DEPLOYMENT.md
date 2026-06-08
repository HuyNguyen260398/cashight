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
- `aws_iam_role.amplify_service` — the build/deploy role (no S3; the build never
  touches the bucket).
- `aws_iam_role.amplify_compute` + `aws_iam_role_policy_attachment.amplify_compute_s3`,
  wired to the app via `compute_role_arn` — the **SSR runtime's** role, granted
  statements-bucket access. This is the identity `lib/storage.ts` runs as at request
  time; the build service role is *not*. (Old manual "A2 S3" step.)
- `terraform/github-oidc.tf` — GitHub OIDC provider + `cashight-github-deploy` role,
  now scoped to the app-id Terraform created (no manual `-var amplify_app_id`).
- `.github/workflows/deploy.yaml` — `verify` (lint/build/test) gates a `deploy` job that
  assumes the role via OIDC and polls an Amplify `RELEASE` job.

**Two things stay manual on purpose** (Terraform can't / shouldn't do them):

1. **Authorizing the Amplify GitHub App** on the repo — a one-time browser OAuth step.
   (Skip it only if you pass `github_access_token`; see Step 1.)
2. **Auth.js secret env vars** — set in the console so they never land in Terraform state.
   Gemini and PDF secrets are stored as SSM SecureString parameters and fetched at
   request time.

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

ℹ️ The GitHub OIDC provider is **account-global** (one per account) and is owned by
another Terraform config in this account, so `github-oidc.tf` **references it via a
data source** rather than creating it — no import needed, and the two configs won't
fight over its tags/thumbprint. If you run this in a *fresh* account with no provider,
create one first (e.g. a one-line `aws_iam_openid_connect_provider` resource, applied
once) before this apply.

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

Terraform set the **non-secret** env vars (`STORAGE_REGION`, `STATEMENTS_BUCKET`,
`GEMINI_API_KEY_PARAMETER`, `PDF_PASSWORD_PARAMETER`, `AUTH_COGNITO_ID`,
`AUTH_COGNITO_ISSUER`, `AUTH_URL`). `AWS_REGION` is **not** set here — Amplify
forbids the reserved `AWS` prefix, so server-side AWS clients read
`STORAGE_REGION=ap-southeast-1` instead.

> ⚠️ **`AUTH_URL` is required.** Behind Amplify's CloudFront proxy the SSR runtime
> sees `Host: localhost:3000` with no trusted `X-Forwarded-Host`, so Auth.js builds
> OAuth `redirect_uri`s as `https://localhost:3000/...` → Google/Cognito reject with
> `redirect_uri_mismatch`. Set `AUTH_URL=https://main.<APP_ID>.amplifyapp.com`.

Create or update the runtime SecureString parameters before deploying:

```bash
aws ssm put-parameter \
  --type SecureString \
  --name /cashight/prod/GEMINI_API_KEY \
  --value '<value>' \
  --overwrite

aws ssm put-parameter \
  --type SecureString \
  --name /cashight/prod/PDF_PASSWORD \
  --value '<value>' \
  --overwrite
```

Do not commit or paste real secret values into Terraform files. Terraform manages
only the IAM read permissions for these parameters (`aws_iam_policy.statements_rw`,
attached to the **compute** role) — not the parameters themselves. Create them with
the commands above **before the first request**, or the SSR runtime gets `undefined`
and `/api/parse` fails with *"This PDF is password-protected and the stored password
did not unlock it."* (and `/api/summarize` fails identically).

> ⚠️ **The `*_PARAMETER` env vars are NOT auto-applied to an existing app.**
> `aws_amplify_app.cashight` has `ignore_changes = [environment_variables]`, so the
> `GEMINI_API_KEY_PARAMETER` / `PDF_PASSWORD_PARAMETER` values in `amplify.tf` only
> seed a *from-scratch* create — a later `terraform apply` will **not** push them to a
> live app. On an existing app set them manually:
>
> ```bash
> aws amplify update-app --app-id <APP_ID> --region ap-southeast-1 \
>   --environment-variables \
>     PDF_PASSWORD_PARAMETER=/cashight/prod/PDF_PASSWORD,\
> GEMINI_API_KEY_PARAMETER=/cashight/prod/GEMINI_API_KEY,<...all other vars...>
> ```
>
> `--environment-variables` **replaces the whole map** — include every existing var
> (`aws amplify get-app --query app.environmentVariables`) or you will drop the
> `AUTH_*` secrets. Do **not** keep plain `PDF_PASSWORD` / `GEMINI_API_KEY` vars: they
> are deliberately excluded from the `amplify.yml` runtime allowlist (below), so they
> are dead weight that only widens the build-container secret surface.

> ℹ️ **Runtime env vars must be in the `amplify.yml` allowlist.** Amplify's
> `WEB_COMPUTE` platform injects app/branch env vars into the **build** container only
> — they are *not* forwarded to the Next.js SSR Lambda. `amplify.yml`'s build phase
> persists a curated set into `.env.production`:
> ```
> env | grep -E '^(STORAGE_REGION|STATEMENTS_BUCKET|GEMINI_API_KEY_PARAMETER|PDF_PASSWORD_PARAMETER|ALLOWED_EMAIL|AUTH_)' >> .env.production
> ```
> Any **new** runtime env var must be added to that grep, and a **redeploy** is
> required after changing app env vars so the value is re-baked into `.env.production`.

Add the remaining **Auth.js secrets** in the console
(App settings → Environment variables) so they stay out of Terraform state:

- `AUTH_SECRET` — `openssl rand -base64 32`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth client. In the Google
  Cloud Console for this client, the **Authorized redirect URIs** must include
  `https://main.<APP_ID>.amplifyapp.com/api/auth/callback/google` (plus
  `http://localhost:3000/api/auth/callback/google` for dev), or Google returns
  `Error 400: redirect_uri_mismatch`. Cognito's callback URLs are managed in
  `terraform/cognito.tf` (`cognito_callback_urls`).
- `ALLOWED_EMAIL` — the single allowed account
- `AUTH_COGNITO_SECRET` — `terraform output -raw cognito_user_pool_client_secret`

> These coexist with the Terraform-set vars; `aws_amplify_app.cashight` has
> `ignore_changes = [environment_variables]` so a later `terraform apply` won't delete them.

Residual risk: `AUTH_SECRET`, OAuth provider secrets, and the Cognito client secret
still have to exist in the Amplify/Auth.js runtime environment because Auth.js
providers and session encryption read them during process startup. Move them to
a runtime-secret bootstrap only after that flow is designed and smoke-tested, or
remove providers that require process-start secrets.

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

- [x] Home page loads (empty state, no statements yet)
- [x] Upload the sample PDF → succeeds
- [x] Object appears in S3: `aws s3 ls s3://<STATEMENTS_BUCKET>/statements/ --recursive`
- [x] Dashboard renders (KPIs, charts, table)
- [x] AI summary streams
- [x] Works on a real mobile device
- [x] Response headers include `Strict-Transport-Security`,
      `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and
      `Permissions-Policy`
- [x] CSP is still report-only unless local and production console checks show
      no blocking violations
- [x] AWS WAF web ACL is associated with the Amplify app and WAF metrics emit
      after normal traffic
- [x] CloudWatch alarms exist for Amplify `5xxErrors`, `4xxErrors`, and `Latency`

## Step 6 — CloudWatch logs (PII gate)

CloudWatch → the Amplify SSR log group:

- [x] No error patterns in the first invocations
- [x] **No PII** — no full card numbers, no raw statement contents
- [x] Export a recent log sample and run:

```bash
pnpm security:scan-logs <exported-log-file>
```

- [x] If anything sensitive appears, fix logging and redeploy before going further

---

## Troubleshooting

### Upload → *"This PDF is password-protected and the stored password did not unlock it."* (HTTP 422)

The SSR runtime received **no** PDF password (not a *wrong* one). `getPdfPassword()`
(`lib/server-secrets.ts`) reads `PDF_PASSWORD_PARAMETER` → SSM, else falls back to a
plain `PDF_PASSWORD` env var; here it returned `undefined`. Check, in order:

1. **SSM parameter exists** —
   `aws ssm get-parameter --name /cashight/prod/PDF_PASSWORD --with-decryption --region ap-southeast-1`.
   `ParameterNotFound` → create it (Step 2).
2. **`PDF_PASSWORD_PARAMETER` is set on the live app** —
   `aws amplify get-app --app-id <APP_ID> --query app.environmentVariables` — and is in
   the `amplify.yml` allowlist. If you just added/changed it, **redeploy** (env vars are
   baked into `.env.production` at build time, not read live).
3. **Compute role can read SSM** — the `ReadRuntimeSecureParameters` statement must be on
   `cashight-statements-rw` (attached to the **compute** role). Sync with
   `terraform apply -target=aws_iam_policy.statements_rw`. If the permission is missing,
   the symptom is instead a **500** (SSM `AccessDenied` throws before the password check),
   not this 422.

**Diagnosis tell:** the Amplify SSR log group prints an env-boolean snapshot at
`[parse …] request received` and, on failure, `PasswordException — no PDF_PASSWORD
configured` (absent at runtime) vs `wrong password` (present but incorrect). The Gemini
summary path breaks the same way via `GEMINI_API_KEY_PARAMETER`.

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
