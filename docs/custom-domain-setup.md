# Custom Domain Setup — `cashight.nghuy.link`

Maps the Amplify SSR app to the custom domain `cashight.nghuy.link`, served from
the Route53-hosted `nghuy.link` zone (same AWS account, `010382427026`,
`ap-southeast-1`).

**Date:** 2026-06-10
**App:** Amplify app `d256g033y75nc0`, branch `main`
**Old default URL:** `https://main.d256g033y75nc0.amplifyapp.com`
**New URL:** `https://cashight.nghuy.link`

---

## Approach

Because the `nghuy.link` hosted zone lives in the **same AWS account** as the
Amplify app, Amplify auto-provisions the ACM certificate and writes both the
`_acm` validation record and the `cashight` CNAME into Route53 — no manual DNS
or CloudFront/ACM wiring required. Provisioning is via Terraform
(`aws_amplify_domain_association`) to keep IaC the source of truth.

The custom domain became the **primary** auth URL; the old `amplifyapp.com`
domain is kept in the Cognito allowlists as a fallback during cutover.

---

## ✅ Done & verified

| Item | Detail | Status |
|---|---|---|
| Domain association | `terraform/amplify.tf` → `aws_amplify_domain_association.cashight` (`nghuy.link`, sub `cashight` → `main`) | `AVAILABLE` |
| ACM certificate | `*.nghuy.link`, auto-validated via same-account Route53 | Valid, HTTPS 200 |
| Route53 records | `cashight` CNAME → `d1a2s749u21tzr.cloudfront.net` (auto-created) | Resolves |
| Cognito callback/logout URLs | `terraform/cognito.tf` — added `https://cashight.nghuy.link/...`, kept old as fallback | Applied |
| `AUTH_URL` env var | Set live to `https://cashight.nghuy.link` via `aws amplify update-app` | Applied |
| Production redeploy | GitHub Actions `deploy.yaml` (lint→build→test→Amplify release), run `27269856408` | Success |
| Auth redirect check | `https://cashight.nghuy.link/` → `…/signin` stays on-domain (no bounce to old URL) | Verified |

### How each change was applied

- **Terraform** (`amplify.tf`, `cognito.tf`) applied with `-target` to avoid
  pulling in unrelated pre-existing drift (see below):
  ```bash
  terraform apply -auto-approve \
    -target=aws_amplify_domain_association.cashight \
    -target=aws_cognito_user_pool_client.web
  ```
  Side effects included in the targeted apply (both benign, both match the
  repo's intended state): Amplify `build_spec` synced to the checked-in
  `amplify.yml`, and Cognito pool MFA `OFF` → `OPTIONAL` (optional ≠ required).
- **`AUTH_URL`** is under `ignore_changes` in Terraform, so it was set directly:
  ```bash
  aws amplify update-app --app-id d256g033y75nc0 --region ap-southeast-1 \
    --environment-variables "$(aws amplify get-app --app-id d256g033y75nc0 \
      --region ap-southeast-1 --query 'app.environmentVariables' --output json \
      | jq -c '. + {AUTH_URL:"https://cashight.nghuy.link"}')"
  ```
  The matching value in `amplify.tf` was edited for parity/documentation only.
- **Redeploy** triggered via `gh workflow run deploy.yaml --ref main` so tests
  still gated production (the SSR runtime only reads new env vars after a deploy).

---

## 🔧 To do

### 1. Google OAuth redirect URI (manual, browser-only — **required for Google sign-in**)

In **Google Cloud Console → APIs & Services → Credentials → the OAuth 2.0
Client → Authorized redirect URIs**, add:

```
https://cashight.nghuy.link/api/auth/callback/google
```

Keep the existing `https://main.d256g033y75nc0.amplifyapp.com/api/auth/callback/google`
as a fallback. Until this is added, Google sign-in throws `redirect_uri_mismatch`
on the new domain. **Cognito sign-in already works.**

### 2. Commit the Terraform changes (uncommitted in working tree)

- `terraform/amplify.tf` — `aws_amplify_domain_association.cashight` + `custom_domain_url` output + `AUTH_URL` parity edit
- `terraform/cognito.tf` — new domain added to callback/logout URL defaults

### 3. (Optional, later) Test sign-in end-to-end

Visit `https://cashight.nghuy.link`, confirm both Cognito and Google sign-in
complete without redirect errors.

---

## ⚠️ Out of scope — pre-existing Terraform drift (NOT applied)

While planning, `terraform plan` revealed committed-but-never-applied resources
unrelated to the domain task. These were **deliberately excluded** from the
targeted apply and remain pending:

- `aws_wafv2_web_acl.cashight` + `aws_wafv2_web_acl_association.cashight_amplify`
- `aws_cloudwatch_metric_alarm.amplify_4xx_errors` / `…5xx_errors` / `…latency`
- `aws_s3_bucket_policy.statements` + `aws_s3_bucket_ownership_controls.statements`
- `aws_iam_role_policy.amplify_release` (in-place update)

These look like intended hardening from the Jun 8 commits that never got
`terraform apply`'d. Reconcile them on purpose in a separate change — run
`terraform plan` to review before applying.
