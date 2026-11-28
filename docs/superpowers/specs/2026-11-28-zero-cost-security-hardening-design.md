# Zero-Cost Security Hardening — Design

**Date:** 2026-11-28
**Status:** Draft for review
**Scope:** Every hardening item from the 2026-11-28 security review that adds **$0/month** to the AWS bill. Paid items (SSE-KMS, Cognito Plus, GuardDuty, S3 data events) are a separate follow-up spec.

## Background

A read-only review of Terraform, the auth code, and the live account on 2026-11-28 found:

| Finding | Evidence |
|---|---|
| Native Cognito user has **no MFA**, and it is the privileged identity (`authProvider = COGNITO` unlocks Cost Explorer) | Pool `MfaConfiguration: OPTIONAL`; `admin-get-user` → `UserMFASettingList: null` |
| **Self sign-up is open** on the hosted UI. auth-guard only guards `PreSignUp_ExternalProvider`, so a stranger can create native users and trigger verification emails (Cognito default sender ≈ 50/day, which shares the quota with the owner's password-reset mail) | `AdminCreateUserConfig.AllowAdminCreateUserOnly: false` |
| User pool **deletion protection off** | `DeletionProtection: INACTIVE` |
| No refresh-token rotation; a stolen refresh token is valid for 7 days | SPA client `RefreshTokenRotation: null` |
| Stale callback/logout URLs on the production client: `cashight-v2.nghuy.link` (v2 torn down 2026-11-15) and `localhost:3000` | `terraform/cognito.tf` |
| **No Content-Security-Policy**. Tokens live in `sessionStorage`, so XSS is the main way to steal a session | `terraform/edge.tf` response headers policy |
| API throttling (100 rps / 50 burst) is far above single-user need; with WAF removed it is the only rate cap | `terraform/api.tf` |
| **No CloudWatch alarms exist** (the cost review's 3 alarms are gone) and nothing alerts on denied sign-ins | `describe-alarms` → `[]` |
| No IAM Access Analyzer in `ap-southeast-1` | `list-analyzers` → `[]` |

## Goals

1. Require MFA for every native Cognito sign-in.
2. Make it impossible to create a native user without an admin call.
3. Protect the user pool from accidental deletion.
4. Shorten the useful life of a stolen refresh token (rotation).
5. Remove production redirect URLs that no longer serve a production purpose, without breaking the documented local-dev flow (`docs/local-dev.md`: localhost SPA against the prod pool and API).
6. Ship a CSP that blocks loading or exfiltrating to any origin the app does not use, rolled out report-only first.
7. Cap API request rate near real single-user load.
8. Get an email when sign-ins are being denied or the API sees a burst of 4XX responses.
9. Detect resources shared outside the account.

## Non-goals

- Anything with a monthly cost (see Scope).
- CloudTrail: the account already has a multi-region trail (`itp-poc-dev-phi-trail`, homed in `ap-southeast-2`). **Risk noted:** it belongs to another project; if it is deleted, cashight loses its audit trail. Revisit in the paid spec.
- AWS Budgets: the account already has a $20 monthly cost budget.
- Smoke-client scope reduction: the smoke test uploads, so it needs `cashight/write`.
- Uploads-bucket CORS `localhost` origin: local dev PUTs to the real bucket; the presigned URL is the real control.
- S3 Object Lock: $0, but it interacts with the 90-day noncurrent-version lifecycle and the statements DELETE route. It needs its own design.
- Hash-based CSP for scripts (see §6).
- Removing the raw CloudFront-domain callback URL.

## Design

### 1. Cognito user pool (`terraform/cognito.tf`)

On `aws_cognito_user_pool.users`:

| Attribute | From | To |
|---|---|---|
| `mfa_configuration` | `"OPTIONAL"` | `"ON"` |
| `deletion_protection` | unset (INACTIVE) | `"ACTIVE"` |
| `admin_create_user_config.allow_admin_create_user_only` | unset (false) | `true` |

`software_token_mfa_configuration { enabled = true }` stays. TOTP is the only factor, so nothing needs SMS or SES.

**Effects:**
- With MFA `ON`, the native user is asked to enrol TOTP on their next hosted-UI sign-in (the hosted UI shows a QR code).
- Google-federated sign-ins are not subject to Cognito MFA; they rely on Google 2-Step Verification. That is accepted: the Google identity is the less-privileged one.
- Admin-only creation blocks the public `SignUp` API. Federated first-sign-in still creates users. The existing Google user is unaffected either way.

**Lockout recovery:** the Google sign-in keeps working. An admin can reset the native user's MFA with `aws cognito-idp admin-set-user-mfa-preference`.

### 2. auth-guard defence in depth (`backend/functions/auth-guard/handler.ts`)

Add `PreSignUp_SignUp` to the guarded triggers. With admin-only creation it should never fire. If someone later reverts §1, it still applies the same allowlist rule: a verified, allowlisted email, else `AccessDenied`.

`PreSignUp_AdminCreateUser` stays unguarded: an admin action is already authorised.

**Caveat:** at `PreSignUp_SignUp`, `email_verified` is not yet `"true"`, so the guard rejects every native self-sign-up, even with the allowlisted email. That is intended: native users are created by an admin only.

### 3. App clients (`terraform/cognito.tf`)

**`aws_cognito_user_pool_client.spa` (production):**
- Remove the `cashight-v2.nghuy.link` callback and logout URLs.
- Remove the `http://localhost:3000` callback and logout URLs.
- Add `refresh_token_rotation { feature = "ENABLED", retry_grace_period_seconds = 10 }`. Provider 6.52 supports it, verified with `terraform providers schema`.
- oidc-client-ts refreshes through `/oauth2/token` and stores the rotated `refresh_token` from the response.
- **Implementation risk:** if the Cognito API refuses rotation while `explicit_auth_flows` contains `ALLOW_REFRESH_TOKEN_AUTH`, drop that flow. The SPA never calls `InitiateAuth`; it uses the OAuth token endpoint.

**New `aws_cognito_user_pool_client.dev`** (`cashight-dev`):
- Same settings as `spa`.
- Callback `http://localhost:3000/auth/callback/` and logout `http://localhost:3000/signin/` only.
- New output `cognito_dev_client_id`.

`docs/local-dev.md` changes to set `NEXT_PUBLIC_COGNITO_CLIENT_ID` to the dev client id. Dev and prod sessions become separate clients of the same pool. The authorization record is keyed by `sub`, so the same user is authorised through either.

### 4. Content-Security-Policy (`terraform/edge.tf`)

New variable `csp_mode` (`"report-only"` | `"enforce"`, default `"report-only"`, validated).

- `enforce`: `security_headers_config.content_security_policy { override = true }`.
- `report-only`: the same string as a `Content-Security-Policy-Report-Only` custom header in `custom_headers_config`.

No `report-uri`: violations are read in the browser console during rollout. A collector would cost Lambda invocations and adds no value for a single user.

**Policy, as a `local.csp` built from Terraform references so bucket and domain names are never hard-coded:**

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://api.cashight.nghuy.link https://cognito-idp.ap-southeast-1.amazonaws.com https://<cognito hosted domain> https://<uploads bucket regional domain>;
frame-src https://<cognito hosted domain>;
frame-ancestors 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
upgrade-insecure-requests
```

Why each source is needed:
- **`script-src 'unsafe-inline'`:** the static export (`next.config.ts` `output: 'export'`) emits inline bootstrap scripts (`<script id="_R_">`, `self.__next_f.push`). Their contents change on every build, so hashing them needs a post-build step. That is out of scope. The CSP still blocks *external* script origins and, through `connect-src`, token exfiltration to arbitrary hosts, which is the main win.
- **`style-src 'unsafe-inline'`:** Cloudscape and Highcharts set inline styles.
- **`connect-src`:**
  - the API;
  - `cognito-idp` (OIDC discovery and JWKS from `NEXT_PUBLIC_COGNITO_AUTHORITY`);
  - the hosted domain (`/oauth2/token`, for code exchange and refresh);
  - the uploads bucket (presigned PUT).
- **`frame-src`:** fallback for the `signinSilent` iframe when no refresh token is present.

Hosted-UI sign-in, logout, and the cost-export CSV download are top-level navigations, which CSP does not govern.

**Not changed:** the existing HSTS, nosniff, X-Frame-Options, referrer and XSS headers.

**Rollout:**
1. Apply with `report-only`.
2. Exercise every page and flow (see Acceptance) and confirm there are no console violations.
3. Flip the default to `enforce` in a separate commit and apply.

### 5. API Gateway throttling (`terraform/api.tf`)

`aws_api_gateway_method_settings.cashight`:
- `throttling_rate_limit` 100 → **10**
- `throttling_burst_limit` 50 → **20**

The dashboard fires a handful of parallel calls on load, so a burst of 20 leaves headroom. This is a stage-wide cap, not per caller.

### 6. Security alerting (new `terraform/security.tf`)

- `aws_sns_topic.security_alerts` (`cashight-security-alerts`).
- An email subscription to `var.allowed_email`, created only when it is non-empty (`count`), so `terraform validate` and plans without the variable still work. The owner must click the confirmation link.
- Alarm `cashight-auth-guard-denials`:
  - `AWS/Lambda` `Errors`, `FunctionName = cashight-auth-guard`, Sum.
  - Period 300 s, threshold ≥ 3, 1 evaluation period, `treat_missing_data = notBreaching`.
  - auth-guard signals every denial by throwing, so Lambda `Errors` counts denied sign-ins.
- Alarm `cashight-api-4xx-burst`:
  - `AWS/ApiGateway` `4XXError`, `ApiName = cashight-api`, `Stage = prod`, Sum.
  - Period 300 s, threshold ≥ 50, 1 evaluation period, `notBreaching`.
- Both alarms set `alarm_actions = [topic]`. `ok_actions` is not set.
- **Cost:** 2 alarms, well inside the free 10. SNS email is free under 1,000 messages a month.

### 7. IAM Access Analyzer (`terraform/security.tf`)

`aws_accessanalyzer_analyzer.account`: name `cashight-external-access`, type `ACCOUNT`, in `ap-southeast-1`. External-access analysis is free.

**Caveat:** this is an account-level resource in a shared account, owned by cashight's state. If another project later creates its own, only one is needed.

## Acceptance criteria

1. `pnpm test backend/__tests__/auth-guard.test.ts` passes, including new `PreSignUp_SignUp` cases.
2. `terraform test` passes with new plan-mode assertions for §1, §3, §4 (both modes), §5, §6, §7.
3. `terraform validate` and `tflint` are clean.
4. After apply, the live pool reports:
   - `MfaConfiguration: ON`
   - `DeletionProtection: ACTIVE`
   - `AllowAdminCreateUserOnly: true`
   - the SPA client has `RefreshTokenRotation.Feature: ENABLED` and no v2 or localhost URLs.
5. `aws cognito-idp sign-up` against the SPA client fails with `NotAuthorizedException`.
6. The native user signs in, enrols TOTP, and reaches Cost Explorer. Google sign-in reaches the dashboard.
7. A session survives past the 1-hour access-token expiry (refresh with rotation works).
8. With `csp_mode = report-only`, there are no CSP console violations on any of these:
   - sign-in, callback
   - dashboard (all period views, both banks), statements
   - upload (PDF and invoice)
   - AI summary stream
   - Cost Explorer, including CSV export
   - sign-out, light and dark mode

   After the flip to `enforce`, the same pass shows no breakage.
9. Local dev per the updated `docs/local-dev.md` signs in through the dev client.
10. The SNS subscription is confirmed. A test with `aws cloudwatch set-alarm-state` on each alarm delivers an email.
11. Access Analyzer lists `cashight-external-access` as `ACTIVE` and has no unexpected active findings, or each one is explained.

## Rollout order

All Terraform is applied through `infrastructure-deploy.yaml` (`workflow_dispatch` plan → approved apply), on a PR into `main`.

1. **PR 1:** everything, with `csp_mode = report-only`. Deploy the auth-guard Lambda through the normal application pipeline, then apply Terraform, then verify acceptance items 4–11.
2. **PR 2:** flip `csp_mode` to `enforce`, apply, re-verify item 8.
