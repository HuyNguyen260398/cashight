---
goal: Harden Cashight security across Next.js, AWS Amplify Hosting, AWS storage, and CI
version: 1.0
date_created: 2026-06-07
last_updated: 2026-06-07
owner: Cashight maintainer
status: 'Planned'
tags:
  - security
  - nextjs
  - amplify
  - terraform
  - ci
  - privacy
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan hardens Cashight after completion of the original product plans. It converts current security research and repository findings into executable work across application code, browser headers, upload/request boundaries, Amplify Hosting, AWS WAF, S3/IAM, dependency governance, and operational verification.

Current repository findings:

- `next.config.ts` is empty, so the app does not set first-party security headers or disable the `X-Powered-By` header.
- `pnpm audit --audit-level moderate` on 2026-06-07 reports one moderate advisory: `postcss < 8.5.10`; `postcss@8.4.31` is currently selected transitively under `next` and `next-auth`, so it remains vulnerable until overridden or upgraded.
- `/api/parse` checks `file.type === 'application/pdf'` and `file.size <= 5 MB`, but does not check PDF magic bytes. OWASP recommends not trusting the `Content-Type` header for uploaded files.
- API route handlers require an authenticated session, but they do not enforce same-origin checks for unsafe methods and do not apply app-level throttling.
- S3 has public access block, versioning, SSE-S3, and lifecycle controls, but lacks explicit object ownership controls, deny-insecure-transport bucket policy, and narrower ListBucket prefix conditions.
- Amplify SSR runtime currently receives secrets by writing matching build environment variables into `.env.production`. AWS documents that SSR runtime env access is intentionally not automatic to protect build-time secrets, and warns not to store secrets in ordinary environment variables.
- GitHub Actions workflows use tag-pinned actions, not full commit SHA pins.

## 1. Requirements & Constraints

- **REQ-001**: Preserve Cashight's single-user access model. Both Google and Cognito sign-in must remain gated by `ALLOWED_EMAIL`.
- **REQ-002**: Keep `pdf-parse` routes on the Node.js runtime. Do not move `/api/parse` or parser-dependent code to Edge runtime.
- **REQ-003**: Keep AI summaries privacy-preserving. Gemini must receive only anonymized aggregates and sanitized aggregate labels, never raw transaction descriptions, cardholder names, PAN values, PDF contents, or storage objects.
- **REQ-004**: Keep the S3 object layout unchanged: `statements/{cardLast4}/{year}/{year}-{mm}.json`.
- **REQ-005**: Keep re-upload overwrite behavior unchanged. S3 versioning must continue preserving prior versions.
- **SEC-001**: Add browser security headers through Next.js and Amplify-hosted response configuration. Next.js supports custom headers in this repo's `next.config.ts`, and Amplify supports repository-root `customHttp.yml`.
- **SEC-002**: Add a CSP rollout in report-only mode first. Enforce CSP only after local and production verification show no broken Next.js, Auth.js, theme, or chart behavior.
- **SEC-003**: Treat Next.js route handlers and any future Server Actions as public-facing API endpoints. Validate authentication and authorization at the route/action body, not only in `proxy.ts`.
- **SEC-004**: Do not rely on `proxy.ts` for authoritative authorization because the current codebase documents Amplify adapter behavior that may not execute Next 16 Proxy in production.
- **SEC-005**: Validate uploaded PDF files by size, declared MIME type, and magic bytes before invoking `pdf-parse`.
- **SEC-006**: Enforce same-origin checks for unsafe API methods (`POST`, `PUT`, `PATCH`, `DELETE`) using `Origin`, `Host`, `X-Forwarded-Host`, and configured `AUTH_URL` / `APP_ORIGIN` values.
- **SEC-007**: Add throttling for expensive endpoints (`/api/parse`, `/api/summarize`) at the application layer and at the Amplify edge using AWS WAF rate-based rules.
- **SEC-008**: Remove the current dependency audit finding by resolving all `postcss` instances to `>= 8.5.10`; verify with `pnpm audit --audit-level moderate`.
- **SEC-009**: Store new high-sensitivity runtime secrets in AWS Systems Manager Parameter Store SecureString or AWS Secrets Manager where feasible. Do not add secret values to Terraform state.
- **SEC-010**: Keep any remaining `.env.production` secret injection documented as residual risk if a framework or Auth.js constraint requires it.
- **SEC-011**: Harden S3 with explicit bucket-owner-enforced object ownership, deny-insecure-transport policy, and IAM permissions scoped to the `statements/` prefix.
- **SEC-012**: Add CI controls for dependency audit, full TypeScript checking, workflow least privilege, and action pinning.
- **CON-001**: `pnpm` is pinned to `11.2.2`; all dependency remediation must preserve `packageManager`.
- **CON-002**: AWS resources target `ap-southeast-1`, except AWS WAFv2 web ACLs with `scope = "CLOUDFRONT"` for Amplify must be created in `us-east-1`.
- **CON-003**: Terraform must not manage secret values. Terraform may manage non-secret secret names, parameter ARNs, IAM read permissions, and documentation.
- **CON-004**: Avoid adding external databases or Redis solely for rate limiting. Use AWS WAF for production edge enforcement and a small in-process limiter as a defense-in-depth guard.
- **PAT-001**: Keep route handlers thin. Put reusable security helpers in `lib/security/`.
- **PAT-002**: Validate external data at boundaries with Zod schemas from `lib/schemas.ts`.
- **PAT-003**: Add focused Vitest tests in `lib/__tests__/`.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Remove known dependency and CI supply-chain gaps.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Modify `package.json` to add a `pnpm.overrides` entry forcing `"postcss": "8.5.15"` unless a newer non-vulnerable version is already selected by `pnpm update`. Keep `packageManager` as `pnpm@11.2.2`. | | |
| TASK-002 | Run `pnpm install --lockfile-only` from the repository root and verify `pnpm-lock.yaml` no longer contains `postcss@8.4.31`. | | |
| TASK-003 | Run `pnpm audit --audit-level moderate`. Completion requires zero moderate-or-higher vulnerabilities, including the GitHub advisory `GHSA-qx2v-qp2m-jg93` for `postcss < 8.5.10`. | | |
| TASK-004 | Modify `.github/workflows/ci.yaml` to add top-level `permissions: contents: read`. | | |
| TASK-005 | Modify `.github/workflows/ci.yaml` and `.github/workflows/deploy.yaml` to run `pnpm tsc --noEmit` after install and before `pnpm build`. | | |
| TASK-006 | Modify `.github/workflows/ci.yaml` and `.github/workflows/deploy.yaml` to run `pnpm audit --audit-level moderate` after install. | | |
| TASK-007 | Resolve every `uses:` value in `.github/workflows/*.yaml` to a full-length commit SHA. For each current tag, run `git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>` and replace `owner/repo@tag` with `owner/repo@<40-character-sha>`. Add a trailing comment with the original tag, for example `# v5`. | | |
| TASK-008 | Create `.github/dependabot.yml` with weekly `npm` ecosystem updates for `/` and weekly `github-actions` updates for `/`. Limit open pull requests to 5 per ecosystem. | | |

### Implementation Phase 2

- GOAL-002: Add browser security headers and stage CSP without breaking Next.js SSR or Auth.js flows.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Modify `next.config.ts` to set `poweredByHeader: false`. | | |
| TASK-010 | Modify `next.config.ts` to export an async `headers()` function for `source: '/(.*)'` with `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and a restrictive `Permissions-Policy` disabling camera, microphone, geolocation, payment, usb, magnetometer, gyroscope, accelerometer, and browsing-topics. | | |
| TASK-011 | Add `Content-Security-Policy-Report-Only` in `next.config.ts`. Use this production policy: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://*.amazoncognito.com; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; upgrade-insecure-requests`. Keep report-only until TASK-018 passes. | | |
| TASK-012 | Create `customHttp.yml` at the repository root for Amplify Hosting with `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and the same `Permissions-Policy`. Do not put an enforcing CSP in `customHttp.yml` during the report-only phase. | | |
| TASK-013 | Add comments in `next.config.ts` and `customHttp.yml` explaining that `Strict-Transport-Security` is applied by Amplify only in production because local HTTP development must continue to work. | | |
| TASK-014 | Run `pnpm lint`, `pnpm tsc --noEmit`, and `pnpm build`. | | |
| TASK-015 | Start `pnpm dev` and verify the dashboard, sign-in page, upload page, statements page, dark-mode toggle, charts, and AI summary UI still render. | | |
| TASK-016 | Inspect local response headers with `curl -I http://localhost:3000/signin` and `curl -I http://localhost:3000/`. Verify the headers from TASK-010 and TASK-011 exist. | | |
| TASK-017 | Deploy to Amplify and verify response headers on the production URL with `curl -I https://main.d256g033y75nc0.amplifyapp.com/`. Verify HSTS exists in production. | | |
| TASK-018 | Review browser console CSP report-only violations in local and production smoke tests. If violations are only required Next.js inline script/style behavior, keep report-only and document the exact directives. If no violations occur, replace `Content-Security-Policy-Report-Only` with `Content-Security-Policy` in `next.config.ts`. | | |

### Implementation Phase 3

- GOAL-003: Harden unsafe API methods, upload validation, rate limiting, and AI prompt boundaries.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | Create `lib/security/origin.ts` exporting `assertSameOrigin(request: Request): Response | null`. It must allow requests with no `Origin` header, reject requests whose `Origin` host does not match `Host`, `X-Forwarded-Host`, `AUTH_URL`, or optional `APP_ORIGIN`, and return `Response.json({ error: 'Invalid request origin' }, { status: 403 })` on failure. | | |
| TASK-020 | Create `lib/security/rate-limit.ts` exporting `checkRateLimit(key: string, options: { limit: number; windowMs: number }): Response | null`. Use an in-memory Map of counters with window expiry. Return `429` JSON with `Retry-After` when exceeded. | | |
| TASK-021 | Create `lib/security/upload.ts` exporting `MAX_UPLOAD_BYTES = 5 * 1024 * 1024`, `isPdfMagicBytes(buffer: Buffer): boolean`, and `validatePdfUpload(file: File): Promise<{ buffer: Buffer } | { response: Response }>` that checks type, size, and `%PDF-` magic bytes before returning the buffer. | | |
| TASK-022 | Modify `lib/require-session.ts` to add `requireApiSessionWithUser(): Promise<{ session: NonNullable<Awaited<ReturnType<typeof auth>>> } | { response: Response }>` so rate-limit keys can use the authenticated user email without duplicating Auth.js calls. Keep `requireApiSession()` backward compatible. | | |
| TASK-023 | Modify `app/api/parse/route.ts` to call `requireApiSessionWithUser()`, return its `response` on unauthorized requests, call `assertSameOrigin(request)`, call `checkRateLimit('parse:' + session.user.email, { limit: 5, windowMs: 10 * 60 * 1000 })`, and replace inline file validation with `validatePdfUpload(file)`. If `session.user.email` is missing, use `session.user.name ?? 'unknown-user'` as the rate-limit suffix. | | |
| TASK-024 | Modify `app/api/summarize/route.ts` to call `requireApiSessionWithUser()`, return its `response` on unauthorized requests, call `assertSameOrigin(request)`, and call `checkRateLimit('summarize:' + session.user.email, { limit: 20, windowMs: 60 * 60 * 1000 })` before calling Gemini. If `session.user.email` is missing, use `session.user.name ?? 'unknown-user'` as the rate-limit suffix. | | |
| TASK-025 | Modify `app/api/statements/[id]/route.ts` so `DELETE` calls `assertSameOrigin(request)` after session validation. | | |
| TASK-026 | Modify `app/api/summarize/route.ts` system prompt to state that category and merchant names are untrusted data labels, not instructions. | | |
| TASK-027 | Modify `lib/summary-payload.ts` to clamp category and merchant label strings to 120 characters, remove ASCII control characters, and preserve existing aggregate-only output shape. | | |
| TASK-028 | Add `lib/__tests__/security-origin.test.ts` for same-origin accept/reject cases, including Amplify `x-forwarded-host` behavior and configured `AUTH_URL`. | | |
| TASK-029 | Add `lib/__tests__/security-upload.test.ts` for MIME spoof rejection, oversized file rejection, valid PDF magic bytes acceptance, and non-PDF magic bytes rejection. | | |
| TASK-030 | Extend `lib/__tests__/summary-payload.test.ts` or create it if absent. Verify no raw transactions, card fields, statement balances, or long/control-character merchant labels can appear in the Gemini payload. | | |

### Implementation Phase 4

- GOAL-004: Reduce server/client data leakage risk and automate privacy guardrails.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-031 | Add `import 'server-only';` to server-only modules that must never enter a Client Component bundle: `lib/storage.ts`, `lib/gemini.ts`, `lib/parsers/tpbank.ts`, `lib/pdf-dom-polyfill.ts`, `lib/summary-payload.ts`, and `lib/require-session.ts`. | | |
| TASK-032 | Modify `next.config.ts` to enable `experimental.taint = true`. Do not rely on taint as the only protection; keep explicit allowlisted payload shaping. | | |
| TASK-033 | Create `lib/security/logging.ts` with `redactForLog(value: unknown): unknown`. It must mask 13-19 digit sequences, remove `PDF_PASSWORD`, `GEMINI_API_KEY`, `AUTH_SECRET`, `AUTH_GOOGLE_SECRET`, and `AUTH_COGNITO_SECRET` keys, and preserve safe fields such as counts, booleans, storage keys, years, months, and `cardLast4`. | | |
| TASK-034 | Modify `app/api/parse/route.ts`, `app/api/statements/route.ts`, `app/api/statements/[id]/route.ts`, and `app/api/summarize/route.ts` so logged errors pass through `redactForLog()` before `console.error`. | | |
| TASK-035 | Add `lib/__tests__/logging.test.ts` proving full PAN-like digit sequences and known secret keys are redacted while `cardLast4` remains visible. | | |
| TASK-036 | Add `scripts/security-scan-logs.ts` that accepts a local text file path and exits non-zero if it finds PAN-like digit sequences, `PDF_PASSWORD=`, `GEMINI_API_KEY=`, `AUTH_SECRET=`, raw `Card Number`, or `BEGIN PRIVATE KEY`. Add `security:scan-logs` script to `package.json`. | | |
| TASK-037 | Update `docs/DEPLOYMENT.md` CloudWatch verification checklist to include running `pnpm security:scan-logs <exported-log-file>` after production upload and summary smoke tests. | | |

### Implementation Phase 5

- GOAL-005: Move feasible runtime secrets out of build artifacts and document unavoidable residual risk.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-038 | Create `lib/server-secrets.ts` with cached runtime readers for AWS Systems Manager Parameter Store SecureString values. Export `getGeminiApiKey()` and `getPdfPassword()`. Use `@aws-sdk/client-ssm`. Cache each value for the lifetime of the SSR runtime instance. | | |
| TASK-039 | Add `@aws-sdk/client-ssm` to `dependencies` in `package.json` and run `pnpm install`. | | |
| TASK-040 | Modify `terraform/iam.tf` to allow the Amplify compute role `ssm:GetParameter` only for parameter ARNs `/cashight/prod/GEMINI_API_KEY` and `/cashight/prod/PDF_PASSWORD`. If a customer-managed KMS key is used, also allow `kms:Decrypt` for that key ARN only. | | |
| TASK-041 | Modify `terraform/amplify.tf` environment variables to add non-secret names `GEMINI_API_KEY_PARAMETER=/cashight/prod/GEMINI_API_KEY` and `PDF_PASSWORD_PARAMETER=/cashight/prod/PDF_PASSWORD`. Keep actual secret values outside Terraform. | | |
| TASK-042 | Modify `amplify.yml` so the `.env.production` grep no longer includes `GEMINI_API_KEY` or `PDF_PASSWORD`. Keep only variables still required at process start, and add a comment identifying those as residual build-artifact risk. | | |
| TASK-043 | Modify `app/api/summarize/route.ts` and `lib/gemini.ts` so Gemini calls receive the API key from `getGeminiApiKey()` instead of reading `process.env.GEMINI_API_KEY` directly. | | |
| TASK-044 | Modify `app/api/parse/route.ts` so PDF parsing receives `await getPdfPassword()` instead of reading `process.env.PDF_PASSWORD` directly. Preserve the current behavior when no PDF password parameter is configured. | | |
| TASK-045 | Add `docs/DEPLOYMENT.md` instructions to create or update SecureString parameters with `aws ssm put-parameter --type SecureString --name /cashight/prod/GEMINI_API_KEY --value '<value>' --overwrite` and the equivalent `PDF_PASSWORD` command. Explicitly state not to commit or paste real values into Terraform files. | | |
| TASK-046 | Document residual Auth.js secret handling in `docs/DEPLOYMENT.md`: `AUTH_SECRET`, OAuth provider secrets, and Cognito client secret remain in Amplify/Auth.js runtime env until replaced by a tested runtime-secret bootstrap or by removing providers that require process-start secrets. | | |

### Implementation Phase 6

- GOAL-006: Harden AWS storage, IAM, Cognito, WAF, and monitoring.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-047 | Modify `terraform/s3.tf` to add `aws_s3_bucket_ownership_controls.statements` with `object_ownership = "BucketOwnerEnforced"`. | | |
| TASK-048 | Modify `terraform/s3.tf` to add an `aws_s3_bucket_policy.statements` deny statement for `aws:SecureTransport = false` on both the bucket ARN and object ARN. | | |
| TASK-049 | Modify `terraform/iam.tf` `ListBucket` permission to include `condition { test = "StringLike"; variable = "s3:prefix"; values = ["statements/*", "statements/"] }`. | | |
| TASK-050 | Modify `terraform/iam.tf` object permissions so object actions apply only to `"${aws_s3_bucket.statements.arn}/statements/*"`, not the entire bucket. | | |
| TASK-051 | Modify `terraform/cognito.tf` to set `prevent_user_existence_errors = "ENABLED"`, `enable_token_revocation = true`, `access_token_validity = 1`, `id_token_validity = 1`, `refresh_token_validity = 7`, and `token_validity_units { access_token = "hours"; id_token = "hours"; refresh_token = "days" }` on `aws_cognito_user_pool_client.web`. | | |
| TASK-052 | Modify `terraform/cognito.tf` to add optional software-token MFA support with `mfa_configuration = "OPTIONAL"` and `software_token_mfa_configuration { enabled = true }` on `aws_cognito_user_pool.users`. | | |
| TASK-053 | Create `terraform/waf.tf` with `aws_wafv2_web_acl.cashight` using `scope = "CLOUDFRONT"`, default allow action, CloudWatch metrics enabled, AWS managed rule groups `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesKnownBadInputsRuleSet`, and `AWSManagedRulesAmazonIpReputationList`, plus a rate-based rule limiting each IP to 300 requests per 5 minutes. | | |
| TASK-054 | Create `aws_wafv2_web_acl_association.cashight_amplify` in `terraform/waf.tf` associating `aws_wafv2_web_acl.cashight.arn` with `aws_amplify_app.cashight.arn`. | | |
| TASK-055 | If Terraform AWS provider requires a Global provider alias for `scope = "CLOUDFRONT"`, modify `terraform/main.tf` to add `provider "aws" { alias = "global"; region = "us-east-1" }` and attach it to WAF resources. | | |
| TASK-056 | Create `terraform/monitoring.tf` with CloudWatch alarms for Amplify `5xxErrors`, `4xxErrors`, and `Latency` using the `AWS/AmplifyHosting` namespace. Add variables `alarm_email` and `enable_security_alarms`; when enabled, create an SNS topic and email subscription. | | |
| TASK-057 | Run `cd terraform && terraform fmt -recursive`, `terraform init`, `terraform validate`, and `terraform plan`. Completion requires no unintended destroy or replacement of the S3 bucket, Cognito pool, or Amplify app. | | |

### Implementation Phase 7

- GOAL-007: Verify the hardening work locally and in production.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-058 | Run `pnpm lint`. | | |
| TASK-059 | Run `pnpm tsc --noEmit`. | | |
| TASK-060 | Run `pnpm test`. | | |
| TASK-061 | Run `pnpm audit --audit-level moderate`. | | |
| TASK-062 | Run `pnpm build`. | | |
| TASK-063 | Start `pnpm dev` and complete local smoke tests: sign in, upload a valid fixture PDF, reject a non-PDF file renamed as `.pdf`, reject a PDF over 5 MB, generate AI summary, list statements, delete one test statement. | | |
| TASK-064 | Deploy through GitHub Actions and Amplify. Verify the deploy workflow cannot assume AWS credentials from pull request events and only assumes the OIDC role on `push` to `main` or manual dispatch. | | |
| TASK-065 | Verify production headers with `curl -I` for `/`, `/signin`, `/upload`, `/statements`, `/api/statements`, and `/api/summarize`. | | |
| TASK-066 | Verify WAF association by checking the Amplify app firewall status and CloudWatch WAF metrics after normal traffic. | | |
| TASK-067 | Export a recent Amplify SSR CloudWatch log sample and run `pnpm security:scan-logs <exported-log-file>`. Completion requires zero findings. | | |
| TASK-068 | Update this plan's status to `Completed` only after TASK-001 through TASK-067 are complete and production smoke tests pass. | | |

## 3. Alternatives

- **ALT-001**: Enforce strict nonce-based CSP immediately. Rejected for the first pass because Next.js inline runtime behavior, `next-themes`, Auth.js redirects, and Amplify's current Proxy limitation need measured report-only verification before enforcement.
- **ALT-002**: Rely only on `proxy.ts` for CSRF, rate limiting, and auth gating. Rejected because Next.js describes Proxy as an optimistic check, not a full session-management or authorization solution, and this repository already documents Amplify adapter limitations with Next 16 Proxy.
- **ALT-003**: Add Redis or DynamoDB for exact distributed rate limiting. Rejected for this personal app's first security pass because AWS WAF provides production edge throttling and an in-process limiter is sufficient defense in depth for the authenticated SSR route handlers.
- **ALT-004**: Move all Auth.js secrets to runtime SSM immediately. Deferred because Auth.js provider and session secrets are consumed during module initialization; migrating them requires a separate tested bootstrap design.
- **ALT-005**: Replace Amplify Hosting with a custom CloudFront/Lambda/S3 stack for more direct security control. Rejected because Amplify now supports custom headers, CloudWatch monitoring, SSR compute IAM roles, and WAF integration; staying on the existing platform is lower-risk.

## 4. Dependencies

- **DEP-001**: `pnpm@11.2.2`.
- **DEP-002**: Node.js 24 for CI parity.
- **DEP-003**: Terraform CLI `>= 1.10`.
- **DEP-004**: AWS provider support for `aws_wafv2_web_acl`, `aws_wafv2_web_acl_association`, `aws_s3_bucket_ownership_controls`, and Amplify app ARN references.
- **DEP-005**: AWS credentials with permissions for S3, IAM policy updates, Cognito updates, WAFv2, SSM Parameter Store, CloudWatch alarms, SNS, and Amplify Web ACL association.
- **DEP-006**: Production Amplify app ID and branch domain remain `main.d256g033y75nc0.amplifyapp.com` unless replaced by a custom domain.
- **DEP-007**: AWS Systems Manager Parameter Store or AWS Secrets Manager for runtime secret retrieval.

## 5. Files

- **FILE-001**: `package.json` - add `pnpm.overrides`, security scripts, and `@aws-sdk/client-ssm`.
- **FILE-002**: `pnpm-lock.yaml` - update dependency graph after override and SSM client addition.
- **FILE-003**: `next.config.ts` - add security headers, CSP report-only, taint flag, and disable powered-by header.
- **FILE-004**: `customHttp.yml` - add Amplify-hosted production security headers.
- **FILE-005**: `lib/security/origin.ts` - same-origin guard for unsafe API requests.
- **FILE-006**: `lib/security/rate-limit.ts` - in-process rate limiter.
- **FILE-007**: `lib/security/upload.ts` - PDF upload validation.
- **FILE-008**: `lib/security/logging.ts` - structured redaction helper.
- **FILE-009**: `lib/server-secrets.ts` - cached runtime SSM secret access.
- **FILE-010**: `lib/require-session.ts` - add session-returning API auth helper.
- **FILE-011**: `lib/summary-payload.ts` - sanitize aggregate labels and keep PII-free payload shape.
- **FILE-012**: `lib/storage.ts` - add `server-only` and keep storage code server-bound.
- **FILE-013**: `lib/gemini.ts` - receive Gemini API key from runtime secret helper.
- **FILE-014**: `lib/parsers/tpbank.ts` - add `server-only`.
- **FILE-015**: `lib/pdf-dom-polyfill.ts` - add `server-only`.
- **FILE-016**: `app/api/parse/route.ts` - origin guard, rate limit, PDF validation, runtime PDF password, redacted logging.
- **FILE-017**: `app/api/summarize/route.ts` - origin guard, rate limit, runtime Gemini key, prompt boundary hardening, redacted logging.
- **FILE-018**: `app/api/statements/route.ts` - redacted logging.
- **FILE-019**: `app/api/statements/[id]/route.ts` - DELETE origin guard and redacted logging.
- **FILE-020**: `lib/__tests__/security-origin.test.ts` - origin guard tests.
- **FILE-021**: `lib/__tests__/security-upload.test.ts` - upload validation tests.
- **FILE-022**: `lib/__tests__/summary-payload.test.ts` - privacy and sanitization tests.
- **FILE-023**: `lib/__tests__/logging.test.ts` - log redaction tests.
- **FILE-024**: `scripts/security-scan-logs.ts` - local exported-log scanner.
- **FILE-025**: `amplify.yml` - remove feasible secrets from `.env.production` injection.
- **FILE-026**: `terraform/iam.tf` - SSM permissions and narrower S3 IAM permissions.
- **FILE-027**: `terraform/s3.tf` - ownership controls and bucket policy.
- **FILE-028**: `terraform/cognito.tf` - token revocation, shorter token validity, user-existence protection, optional software MFA.
- **FILE-029**: `terraform/waf.tf` - WAF web ACL, managed rules, rate rule, Amplify association.
- **FILE-030**: `terraform/monitoring.tf` - CloudWatch alarms and optional SNS topic.
- **FILE-031**: `terraform/main.tf` - possible Global WAF provider alias and alarm variables.
- **FILE-032**: `.github/workflows/ci.yaml` - permissions, typecheck, audit, action SHA pins.
- **FILE-033**: `.github/workflows/deploy.yaml` - typecheck, audit, action SHA pins.
- **FILE-034**: `.github/workflows/tf-ci.yaml` - action SHA pins.
- **FILE-035**: `.github/dependabot.yml` - dependency and GitHub Actions update automation.
- **FILE-036**: `docs/DEPLOYMENT.md` - SSM setup, residual secret risk, CloudWatch log scan verification, WAF/alarms verification.
- **FILE-037**: `docs/plans/00-INDEX.md` - link this security hardening plan.

## 6. Testing

- **TEST-001**: `pnpm audit --audit-level moderate` returns zero vulnerabilities.
- **TEST-002**: `rg -n "postcss@8\\.4\\.31" pnpm-lock.yaml` returns no matches.
- **TEST-003**: `pnpm lint` passes.
- **TEST-004**: `pnpm tsc --noEmit` passes.
- **TEST-005**: `pnpm test` passes, including new origin, upload, logging, and summary-payload tests.
- **TEST-006**: `pnpm build` passes and still copies the pdfjs worker.
- **TEST-007**: `curl -I` local and production responses include configured security headers.
- **TEST-008**: CSP report-only verification shows either zero violations or documented required Next.js runtime allowances.
- **TEST-009**: Spoofed upload with non-PDF magic bytes returns 415 or 422 before `pdf-parse` runs.
- **TEST-010**: Cross-origin POST to `/api/summarize` and `/api/parse` returns 403.
- **TEST-011**: Repeated authenticated calls exceeding route limits return 429 with `Retry-After`.
- **TEST-012**: `cd terraform && terraform fmt -check -recursive`, `terraform validate`, and `terraform plan` pass without unintended destructive changes.
- **TEST-013**: Production WAF association is visible on the Amplify app and WAF metrics emit after traffic.
- **TEST-014**: Exported CloudWatch SSR logs pass `pnpm security:scan-logs`.
- **TEST-015**: Production smoke test succeeds for sign-in, dashboard load, upload, conflict overwrite, AI summary, statements list, and delete.

## 7. Risks & Assumptions

- **RISK-001**: CSP enforcement may break Next.js inline scripts, theme initialization, or chart rendering. Mitigation: deploy report-only first and enforce only after verified.
- **RISK-002**: WAF managed rules may block legitimate Auth.js callback or upload requests. Mitigation: start with CloudWatch metrics and logs, add scoped exclusions only for verified false positives.
- **RISK-003**: Moving `GEMINI_API_KEY` and `PDF_PASSWORD` to SSM changes runtime failure modes. Mitigation: cache values, return existing 503/422 style errors, and add deployment smoke tests.
- **RISK-004**: In-process rate limiting is per SSR runtime instance and not globally consistent. Mitigation: AWS WAF is the production global rate limit; app limiter is defense in depth.
- **RISK-005**: Pinning GitHub Actions to SHAs reduces automatic security updates if Dependabot is not configured. Mitigation: add Dependabot for GitHub Actions.
- **RISK-006**: Cognito MFA changes may affect sign-in UX. Mitigation: set MFA optional, not required, in this pass.
- **RISK-007**: S3 bucket policy changes can break app writes if conditions are too strict. Mitigation: do not require an encryption request header because bucket default encryption is already configured; only deny insecure transport.
- **ASSUMPTION-001**: The production Amplify app remains in the same AWS account as the WAF web ACL.
- **ASSUMPTION-002**: The app does not need cross-origin browser API access; all browser API calls originate from the same Cashight origin.
- **ASSUMPTION-003**: Current upload size limit of 5 MB remains sufficient for TPBank statement PDFs.
- **ASSUMPTION-004**: The maintainers can create SecureString parameters manually or through an approved secrets workflow without placing values in Terraform state.

## 8. Related Specifications / Further Reading

- [Step 17 - Google authentication](./17-google-auth.md)
- [Step 18 - Cognito authentication](./18-cognito-authentication.md)
- [Step 19 - S3 bucket consolidation](./19-s3-bucket-consolidation.md)
- [Deployment guide](../DEPLOYMENT.md)
- [Next.js `headers` configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers)
- [Next.js Server Actions allowed origins and body size limits](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions)
- [Next.js Proxy guidance](https://nextjs.org/docs/app/getting-started/proxy)
- [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication)
- [Next.js taint API warning](https://nextjs.org/docs/app/api-reference/config/next-config-js/taint)
- [AWS Amplify custom headers](https://docs.aws.amazon.com/amplify/latest/userguide/setting-custom-headers.html)
- [AWS Amplify SSR environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html)
- [AWS Amplify environment variables and secrets warning](https://docs.aws.amazon.com/amplify/latest/userguide/environment-variables.html)
- [AWS Amplify WAF integration](https://docs.aws.amazon.com/amplify/latest/userguide/WAF-integration.html)
- [AWS Amplify WAF constraints](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-waf-configuration.html)
- [AWS Amplify CloudWatch monitoring](https://docs.aws.amazon.com/amplify/latest/userguide/monitoring-with-cloudwatch.html)
- [Amazon S3 security best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [GitHub Actions secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Advisory GHSA-qx2v-qp2m-jg93 / CVE-2026-41305](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
