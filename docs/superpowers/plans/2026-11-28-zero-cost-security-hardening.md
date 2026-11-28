# Zero-Cost Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the $0 security gaps found in the 2026-11-28 review: Cognito MFA, sign-up, deletion protection, refresh-token rotation and stale redirect URLs; a CSP; tighter API throttling; security alarms; and Access Analyzer.

**Architecture:** Almost entirely Terraform in `terraform/`, plus one guard clause in the auth-guard Lambda and a docs update for local dev. The CSP ships report-only behind a `csp_mode` variable and is flipped to enforcing in a second PR after a manual browser pass.

**Tech Stack:** Terraform ≥ 1.11, AWS provider 6.52 (`~> 6.0`), `terraform test` (plan-mode `.tftest.hcl`), TypeScript Lambda + vitest, oidc-client-ts SPA.

**Spec:** `docs/superpowers/specs/2026-11-28-zero-cost-security-hardening-design.md`

## Global Constraints

- **No change may add a monthly AWS cost.** Alarm count stays ≤ 10 account-wide (there are 0 today).
- Region `ap-southeast-1` everywhere.
- Never hard-code bucket names, the account id, or the Cognito domain. Derive them from Terraform references.
- Never put the allowlisted email in the repo. It arrives as `var.allowed_email` (`TF_VAR_allowed_email` in CI).
- Branch `feat/zero-cost-security-hardening` from `main`; PR into `main` (ruleset-protected).
- Terraform is applied only through `.github/workflows/infrastructure-deploy.yaml` (`workflow_dispatch`, plan → approved apply).
- Local `terraform test` / `plan` needs AWS credentials. After `aws login`, run `eval "$(aws configure export-credentials --format env)"` first.

## Review Focus

1. **A real flow hits an origin missing from the CSP.** Examples: the token refresh POST, a presigned PUT, Highcharts chunks. Expected: no violation in report-only. Pinned by the Task 7 manual flow pass.
2. **Two tabs refresh at once after rotation is on.** Expected: both stay signed in (10 s grace), or at worst one is sent to sign-in with no data loss. Pinned by the Task 7 two-tab check.
3. **The hosted UI cannot enrol TOTP at sign-in once MFA is `ON`.** Expected: the native user is shown a QR code. If not, recovery is the `admin-set-user-mfa-preference` runbook in Task 7, and Google sign-in still works.
4. **Dashboard load trips the new 10 rps / 20 burst throttle**, for example rapid period or bank switching. Expected: no 429 in the network tab. Pinned by the Task 7 throttle check.
5. **Local dev breaks after localhost leaves the prod client.** Expected: `pnpm dev` signs in through the dev client using the updated `docs/local-dev.md`. Pinned by the Task 7 local-dev check.

---

### Task 1: auth-guard rejects native self-sign-up

**Files:**
- Modify: `backend/functions/auth-guard/handler.ts` (the `isGuardedTrigger` expression)
- Test: `backend/__tests__/auth-guard.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: no signature change. `createAuthGuardHandler` now also guards `triggerSource === 'PreSignUp_SignUp'`.

- [ ] **Step 1: Write the failing tests.** Add to the existing `describe('Cognito auth guard')`, using the file's `event()` helper and `allowedEmail: 'huy@example.com'`:

```ts
it.each([
  { email: 'other@example.com', email_verified: 'false' },
  { email: 'huy@example.com', email_verified: 'false' }, // native sign-up is never pre-verified
  { email: undefined, email_verified: undefined },
])('rejects native self-sign-up (%o)', async (attributes) => {
  const upsertAuthorizedUser = vi.fn();
  const handler = createAuthGuardHandler({ allowedEmail: 'huy@example.com', upsertAuthorizedUser });
  await expect(handler(event('PreSignUp_SignUp', { sub: 'native-1', ...attributes }))).rejects.toThrow('AccessDenied');
  expect(upsertAuthorizedUser).not.toHaveBeenCalled();
});

it('still passes admin-created users through untouched', async () => {
  const handler = createAuthGuardHandler({ allowedEmail: 'huy@example.com', upsertAuthorizedUser: vi.fn() });
  const input = event('PreSignUp_AdminCreateUser', { email: 'huy@example.com', email_verified: 'false' });
  await expect(handler(input)).resolves.toBe(input);
});
```

- [ ] **Step 2: Run** `pnpm test backend/__tests__/auth-guard.test.ts`. Expected: the 3 `rejects native self-sign-up` cases FAIL (they resolve instead of throwing). The admin-create case passes.

- [ ] **Step 3: Implement.** Add `event.triggerSource === 'PreSignUp_SignUp' ||` to `isGuardedTrigger`. The existing email and `email_verified` check then rejects it. Update the `SEC-003` comment in `terraform/cognito.tf` to say auth-guard also guards native sign-up.

- [ ] **Step 4: Run** `pnpm test backend/__tests__/auth-guard.test.ts`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/functions/auth-guard/handler.ts backend/__tests__/auth-guard.test.ts terraform/cognito.tf
git commit -m "fix(auth): reject native self-sign-up in auth-guard"
```

---

### Task 2: Harden the user pool

**Files:**
- Modify: `terraform/cognito.tf` (`aws_cognito_user_pool.users`)
- Create: `terraform/tests/security_hardening.tftest.hcl`

**Interfaces:**
- Consumes: none.
- Produces: the test file that Tasks 3–6 append `run` blocks to. It carries one file-level override, because the `spa` client's callback list includes `aws_cloudfront_distribution.frontend.domain_name`, which is unknown at plan. Without the override, Task 3's URL assertions cannot be evaluated.

- [ ] **Step 1: Write the failing test.** Create `terraform/tests/security_hardening.tftest.hcl` with a header comment in the style of `auth_api_edge.tftest.hcl` and:

```hcl
override_resource {
  target          = aws_cloudfront_distribution.frontend
  override_during = plan
  values          = { domain_name = "d111111abcdef8.cloudfront.net" }
}

run "user_pool_hardened" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool.users.mfa_configuration == "ON"
    error_message = "User pool must require MFA"
  }
  assert {
    condition     = aws_cognito_user_pool.users.deletion_protection == "ACTIVE"
    error_message = "User pool must have deletion protection"
  }
  assert {
    condition     = aws_cognito_user_pool.users.admin_create_user_config[0].allow_admin_create_user_only == true
    error_message = "Self sign-up must be disabled"
  }
}
```

- [ ] **Step 2: Run** `cd terraform && terraform test -filter=tests/security_hardening.tftest.hcl`. Expected: FAIL on all three assertions.

- [ ] **Step 3: Implement.** On `aws_cognito_user_pool.users`, set:
  - `mfa_configuration = "ON"`
  - `deletion_protection = "ACTIVE"`
  - `admin_create_user_config { allow_admin_create_user_only = true }`

  Add a one-line comment above `mfa_configuration` explaining why. Federated Google users are not subject to Cognito MFA.

- [ ] **Step 4: Run** the same `terraform test` command. Expected: PASS. Then run `terraform validate`. Expected: `Success!`.

- [ ] **Step 5: Commit**

```bash
git add terraform/cognito.tf terraform/tests/security_hardening.tftest.hcl
git commit -m "feat(infra): require MFA, disable self sign-up, protect user pool"
```

---

### Task 3: Clean up the SPA client, add a dev client, rotate refresh tokens

**Files:**
- Modify: `terraform/cognito.tf` (`aws_cognito_user_pool_client.spa`, new `aws_cognito_user_pool_client.dev`, new output)
- Modify: `docs/local-dev.md` (§1, plus the line saying the prod client already lists localhost)
- Test: `terraform/tests/security_hardening.tftest.hcl`

**Interfaces:**
- Consumes: none.
- Produces:
  - resource `aws_cognito_user_pool_client.dev`, named `"${var.project_name}-dev"`
  - output `cognito_dev_client_id`

- [ ] **Step 1: Write the failing test.** Append:

```hcl
run "spa_client_hardened" {
  command = plan
  assert {
    condition = length([for u in concat(tolist(aws_cognito_user_pool_client.spa.callback_urls), tolist(aws_cognito_user_pool_client.spa.logout_urls)) :
      u if strcontains(u, "localhost") || strcontains(u, "cashight-v2")]) == 0
    error_message = "Production client must not allow localhost or v2 redirects"
  }
  assert {
    condition     = contains(tolist(aws_cognito_user_pool_client.spa.callback_urls), "https://cashight.nghuy.link/auth/callback/")
    error_message = "Production callback must remain"
  }
  assert {
    condition     = aws_cognito_user_pool_client.spa.refresh_token_rotation[0].feature == "ENABLED"
    error_message = "Refresh token rotation must be enabled"
  }
}

run "dev_client_localhost_only" {
  command = plan
  assert {
    condition     = tolist(aws_cognito_user_pool_client.dev.callback_urls) == ["http://localhost:3000/auth/callback/"]
    error_message = "Dev client callback must be localhost only"
  }
  assert {
    condition     = tolist(aws_cognito_user_pool_client.dev.logout_urls) == ["http://localhost:3000/signin/"]
    error_message = "Dev client logout must be localhost only"
  }
  assert {
    condition     = aws_cognito_user_pool_client.dev.generate_secret == false
    error_message = "Dev client is a public PKCE client"
  }
}
```

- [ ] **Step 2: Run** `terraform test -filter=tests/security_hardening.tftest.hcl`. Expected: FAIL. `dev` is undeclared, and the spa assertions fail.

- [ ] **Step 3: Implement.**
  - **`spa` client:** delete the `localhost` and `cashight-v2` entries and their "v2 parallel stack" comments. Add `refresh_token_rotation { feature = "ENABLED"; retry_grace_period_seconds = 10 }`.
  - **`dev` client:** copy `spa`'s scopes, flows, IdPs, token validity, revocation, `prevent_user_existence_errors`, `explicit_auth_flows`, rotation and `depends_on`. Use only the two localhost URLs.
  - **Output:** add `cognito_dev_client_id` (description: "Public client for localhost dev. Set as NEXT_PUBLIC_COGNITO_CLIENT_ID in .env.local.").
  - **Docs:** in `docs/local-dev.md` §1, add `NEXT_PUBLIC_COGNITO_CLIENT_ID=<terraform output -raw cognito_dev_client_id>` to the `.env.local` block. Replace the "already includes the localhost URLs" sentence with one saying localhost redirects live only on the dedicated `cashight-dev` client.

- [ ] **Step 4: Run** `terraform test -filter=tests/security_hardening.tftest.hcl && terraform validate`. Expected: PASS and `Success!`.

- [ ] **Step 5: Commit**

```bash
git add terraform/cognito.tf terraform/tests/security_hardening.tftest.hcl docs/local-dev.md
git commit -m "feat(auth): rotate refresh tokens, move localhost to a dev client, drop v2 URLs"
```

---

### Task 4: Content-Security-Policy behind `csp_mode`

**Files:**
- Modify: `terraform/variables.tf` (new `csp_mode`)
- Modify: `terraform/edge.tf` (`locals { csp }`, `aws_cloudfront_response_headers_policy.frontend`)
- Test: `terraform/tests/security_hardening.tftest.hcl`

**Interfaces:**
- Consumes: `aws_cognito_user_pool_domain.users.domain`, `aws_s3_bucket.uploads.bucket`, `var.region`.
- Produces:
  - `variable "csp_mode"`: string, default `"report-only"`, with a `validation` that it is `"report-only"` or `"enforce"`.
  - `local.csp`: string.

- [ ] **Step 1: Write the failing tests.** Append:

```hcl
run "csp_report_only_by_default" {
  command = plan
  assert {
    condition     = length(aws_cloudfront_response_headers_policy.frontend.security_headers_config[0].content_security_policy) == 0
    error_message = "Report-only mode must not send an enforcing CSP"
  }
  assert {
    condition = anytrue([for h in aws_cloudfront_response_headers_policy.frontend.custom_headers_config[0].items :
      h.header == "Content-Security-Policy-Report-Only" && strcontains(h.value, "frame-ancestors 'none'")
      && strcontains(h.value, "https://api.cashight.nghuy.link")
      && strcontains(h.value, ".auth.ap-southeast-1.amazoncognito.com")
      && strcontains(h.value, ".s3.ap-southeast-1.amazonaws.com")])
    error_message = "Report-only CSP header must carry the full policy"
  }
}

run "csp_enforced" {
  command = plan
  variables { csp_mode = "enforce" }
  assert {
    condition     = strcontains(aws_cloudfront_response_headers_policy.frontend.security_headers_config[0].content_security_policy[0].content_security_policy, "object-src 'none'")
    error_message = "Enforce mode must send the CSP"
  }
  assert {
    condition     = length(aws_cloudfront_response_headers_policy.frontend.custom_headers_config) == 0
    error_message = "Enforce mode must not also send the report-only header"
  }
}

run "csp_mode_rejects_unknown_value" {
  command         = plan
  variables { csp_mode = "off" }
  expect_failures = [var.csp_mode]
}
```

- [ ] **Step 2: Run** `terraform test -filter=tests/security_hardening.tftest.hcl`. Expected: FAIL (`csp_mode` undeclared).

- [ ] **Step 3: Implement.**
  - **Variable:** add `csp_mode` to `variables.tf`.
  - **Policy string:** in `edge.tf`, build `local.csp` with `join("; ", [...])` from the exact directive list in spec §4. Hosts:
    - hosted UI: `https://${aws_cognito_user_pool_domain.users.domain}.auth.${var.region}.amazoncognito.com`
    - uploads: `https://${aws_s3_bucket.uploads.bucket}.s3.${var.region}.amazonaws.com`
    - identity provider: `https://cognito-idp.${var.region}.amazonaws.com`
  - **Header blocks:** in the response headers policy, use a `dynamic "content_security_policy"` inside `security_headers_config` (`for_each = var.csp_mode == "enforce" ? [1] : []`, `override = true`). Use a top-level `dynamic "custom_headers_config"` (`for_each = var.csp_mode == "report-only" ? [1] : []`) holding one `items` block with `header = "Content-Security-Policy-Report-Only"` and `override = true`.
  - **Comment:** add a comment above `local.csp` giving the reason for each `'unsafe-inline'` (from the spec).

- [ ] **Step 4: Run** `terraform test -filter=tests/security_hardening.tftest.hcl && terraform validate`. Expected: PASS and `Success!`.

- [ ] **Step 5: Commit**

```bash
git add terraform/variables.tf terraform/edge.tf terraform/tests/security_hardening.tftest.hcl
git commit -m "feat(edge): add CSP, report-only by default"
```

---

### Task 5: Tighten API throttling

**Files:**
- Modify: `terraform/api.tf` (`aws_api_gateway_method_settings.cashight`)
- Test: `terraform/tests/security_hardening.tftest.hcl`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test.** Append a `run "api_throttle_tightened"` (plan) asserting `aws_api_gateway_method_settings.cashight.settings[0].throttling_rate_limit == 10` and `...throttling_burst_limit == 20`.
- [ ] **Step 2: Run** `terraform test -filter=tests/security_hardening.tftest.hcl`. Expected: FAIL (100 / 50).
- [ ] **Step 3: Implement.** Set rate `10` and burst `20`. Update the WAF comment block so it says throttling is now the rate cap.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add terraform/api.tf terraform/tests/security_hardening.tftest.hcl
git commit -m "feat(api): cap stage throttling at 10 rps / 20 burst"
```

---

### Task 6: Security alarms and Access Analyzer

**Files:**
- Create: `terraform/security.tf`
- Test: `terraform/tests/security_hardening.tftest.hcl`

**Interfaces:**
- Consumes:
  - `aws_lambda_function.auth_guard.function_name` (`cashight-auth-guard`)
  - `aws_api_gateway_rest_api.cashight.name`
  - `aws_api_gateway_stage.prod.stage_name`
  - `var.allowed_email`
- Produces:
  - `aws_sns_topic.security_alerts`
  - `aws_sns_topic_subscription.security_alerts_email` (`count`)
  - `aws_cloudwatch_metric_alarm.auth_guard_denials`
  - `aws_cloudwatch_metric_alarm.api_4xx_burst`
  - `aws_accessanalyzer_analyzer.account`

- [ ] **Step 1: Write the failing tests.** Append:
  - **`run "security_alarms"` (plan):**
    - `auth_guard_denials`: `metric_name == "Errors"`, `namespace == "AWS/Lambda"`, `threshold == 3`, `period == 300`, `dimensions.FunctionName == "cashight-auth-guard"`.
    - `api_4xx_burst`: `metric_name == "4XXError"`, `threshold == 50`, `dimensions.Stage == "prod"`.
    - Both alarms: `treat_missing_data == "notBreaching"`, `comparison_operator == "GreaterThanOrEqualToThreshold"`.
  - **`run "alert_subscription_optional"` (plan, `variables { allowed_email = "" }`):** `length(aws_sns_topic_subscription.security_alerts_email) == 0`.
  - **`run "alert_subscription_created"` (plan, `variables { allowed_email = "owner@example.invalid" }`):** `length(...) == 1` and `[0].protocol == "email"`.
  - **`run "access_analyzer"` (plan):** `aws_accessanalyzer_analyzer.account.type == "ACCOUNT"` and `analyzer_name == "cashight-external-access"`.

- [ ] **Step 2: Run** `terraform test -filter=tests/security_hardening.tftest.hcl`. Expected: FAIL (undeclared resources).

- [ ] **Step 3: Implement `terraform/security.tf`** with the values from spec §6–§7:
  - **Header comment:** explains the $0 cost (alarms within the free 10; SNS email free tier; external-access analysis free).
  - **Topic:** named `"${var.project_name}-security-alerts"`.
  - **Alarms:** `evaluation_periods = 1`, `statistic = "Sum"`, `alarm_actions = [aws_sns_topic.security_alerts.arn]`, and `tags = { Project = var.project_name }`.
  - **Subscription:** `count = var.allowed_email == "" ? 0 : 1`.

- [ ] **Step 4: Run** `terraform test && terraform validate && tflint`, which runs the full suite so nothing else regressed. Expected: all PASS, `Success!`, and tflint clean.

- [ ] **Step 5: Commit**

```bash
git add terraform/security.tf terraform/tests/security_hardening.tftest.hcl
git commit -m "feat(infra): security alarms via SNS and IAM Access Analyzer"
```

---

### Task 7: Deploy and verify (report-only CSP)

Manual. No code, except recording results in the PR description.

- [ ] **Step 1: Run the full checks.** Run `pnpm test`, `pnpm tsc --noEmit` and `pnpm lint`. Expected: all pass. Push the branch and open a PR into `main`, listing acceptance criteria 1–11 from the spec as a checklist.
- [ ] **Step 2: Deploy auth-guard and preview Terraform.** After merge, the application pipeline deploys auth-guard. Then run `infrastructure-deploy.yaml` with `action=plan`. Expected plan:
  - pool updated in place (MFA, deletion protection, admin-create)
  - `spa` client updated
  - `dev` client, SNS topic and subscription, 2 alarms and the analyzer created
  - response headers policy and method settings updated
  - **no destroy or replace of the user pool or the `spa` client.** If either would be replaced, stop.
- [ ] **Step 3: Apply.**
  - Run with `action=apply` and approve.
  - If it rejects `mfa_configuration = "ON"` on an existing pool, revert to `"OPTIONAL"` and instead enrol the native user (Step 6). With OPTIONAL, an enrolled user is still always challenged.
- [ ] **Step 4: Verify the live config.** Run:
  - `aws cognito-idp describe-user-pool --user-pool-id ap-southeast-1_ZazpeBFju --region ap-southeast-1 --query 'UserPool.{mfa:MfaConfiguration,del:DeletionProtection,admin:AdminCreateUserConfig.AllowAdminCreateUserOnly}'`

    Expected: `ON`, `ACTIVE`, `true`.
  - `describe-user-pool-client` for the spa client.

    Expected: `RefreshTokenRotation.Feature = ENABLED`, and no localhost or v2 URLs.
- [ ] **Step 5: Confirm self sign-up is blocked.** Run `aws cognito-idp sign-up --client-id <spa id> --username probe@example.invalid --password 'Probe-Passw0rd!x' --region ap-southeast-1`. Expected: `NotAuthorizedException`.
- [ ] **Step 6: Check native sign-in and MFA.** Sign in as the native user at https://cashight.nghuy.link. Expected: a TOTP QR code. Scan it, enter the code, and reach the dashboard and Cost Explorer.
  - **Recovery if locked out:** Cognito won't disable a user's MFA while the pool is `ON`. Follow the 3-step lockout recovery in spec §1: set the pool to `OPTIONAL`, reset the user's MFA, then re-enrol and re-apply.
- [ ] **Step 7: Check Google sign-in.** Expected: reaches the dashboard.
- [ ] **Step 8: Check the CSP pass** (Review Focus 1). Open DevTools Console with "Verbose" off and walk every flow in spec acceptance item 8. Expected: zero `Content-Security-Policy-Report-Only` violation messages. Chrome's one-off note that `upgrade-insecure-requests` is ignored in a report-only policy is expected, and it is not a violation. For any violation, add the origin to `local.csp`, then re-run Task 4's tests and apply.
- [ ] **Step 9: Check the throttle** (Review Focus 4). Hard-refresh the dashboard and switch period and bank 10 times quickly. Expected: no 429 in the Network tab.
- [ ] **Step 10: Check refresh with rotation** (Review Focus 2).
  - Leave a tab open past 1 hour, then act. Expected: still signed in.
  - Repeat with two tabs that both act within a few seconds. Expected: both stay signed in, or one is redirected to sign-in cleanly.
- [ ] **Step 11: Check local dev** (Review Focus 5). Set `NEXT_PUBLIC_COGNITO_CLIENT_ID` from `terraform output -raw cognito_dev_client_id` in `.env.local`, then run `pnpm dev:api-proxy` and `pnpm dev`. Expected: sign-in returns to `http://localhost:3000/` and the dashboard loads.
- [ ] **Step 12: Check alerting.**
  - Click the SNS confirmation email.
  - For each alarm, run `aws cloudwatch set-alarm-state --region ap-southeast-1 --alarm-name <name> --state-value ALARM --state-reason test`. Expected: an email for each.
  - Run `aws accessanalyzer list-findings --analyzer-arn <arn> --region ap-southeast-1 --filter '{"status":{"eq":["ACTIVE"]}}'`. Expected: no findings, or each is explained in the PR.

---

### Task 8: Enforce the CSP

**Files:**
- Modify: `terraform/variables.tf` (`csp_mode` default)
- Test: `terraform/tests/security_hardening.tftest.hcl`

- [ ] **Step 1: Swap the tests.** Rename `csp_report_only_by_default` to `csp_report_only` and give it `variables { csp_mode = "report-only" }`. Remove the `variables` block from `csp_enforced` so it tests the default.
- [ ] **Step 2: Run** `terraform test -filter=tests/security_hardening.tftest.hcl`. Expected: `csp_enforced` FAILS.
- [ ] **Step 3: Implement.** Set the `csp_mode` default to `"enforce"`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit, PR and deploy.** Run `git commit -m "feat(edge): enforce CSP"`, open the PR, then apply through `infrastructure-deploy.yaml`. Repeat Task 7 Step 8 with enforcement on. Expected: every flow works and the console shows no `Refused to ...` errors.
