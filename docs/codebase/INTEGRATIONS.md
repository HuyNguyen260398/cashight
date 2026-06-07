# External Integrations

## Core Sections (Required)

### 1) Integration Inventory

| System | Type | Purpose | Auth model | Criticality | Evidence |
|--------|------|---------|------------|-------------|----------|
| AWS S3 | Object store (API) | Persist parsed statement JSON; LIST/GET/PUT/DELETE | IAM (Amplify compute role in prod; local AWS creds in dev) | High | `lib/storage.ts`, `terraform/s3.tf`, `terraform/iam.tf` |
| Google Gemini (`@google/genai`) | LLM HTTP API | Stream natural-language spending summaries (gemini-2.5-flash) | API key (`GEMINI_API_KEY`) | Medium (feature degrades gracefully to 503) | `lib/gemini.ts`, `app/api/summarize/route.ts` |
| Google OAuth (Auth.js) | OAuth IdP | Single-user sign-in | `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, allowlist on verified email | High (gates entire app) | `auth.ts:20`, `lib/auth-allowlist.ts` |
| AWS Cognito (Auth.js) | OAuth IdP | Second sign-in option | `AUTH_COGNITO_ID`/`SECRET`/`ISSUER`, `client_secret_post` | High | `auth.ts:24`, `terraform/cognito.tf` |
| AWS Amplify Hosting | SSR deploy target | Host the Next.js app in `ap-southeast-1` | GitHub OIDC for CI deploy | High | `amplify.yml`, `terraform/amplify.tf`, `terraform/github-oidc.tf` |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| S3 bucket (`STATEMENTS_BUCKET`) | Sole persistence; one JSON object per statement-month | `lib/storage.ts` | Region mismatch → silent GET failures; unpaginated LIST caps at 1000 keys | `lib/storage.ts:118-139`, `terraform/s3.tf` |

- Key derivation = dedupe: `statements/{cardLast4}/{year}/{year}-{mm}.json` (`lib/storage.ts:76-79`); re-upload overwrites, S3 versioning (Enabled, `terraform/s3.tf`) preserves prior versions. No separate ID generation.
- Encryption: SSE-AES256 at rest; public access fully blocked (`terraform/s3.tf`).

### 3) Secrets and Credentials Handling

- Credential sources: `.env.local` (dev, gitignored), Amplify Console → injected into `.env.production` at build (`amplify.yml:15`), `terraform/*.tfvars` (gitignored). Template: `.env.example`.
- Hardcoding checks: no secrets in source (scan TODO/secrets sections empty). Cognito callback URLs and the Amplify domain are hardcoded in `terraform/cognito.tf` (non-secret config). `terraform/github-token.auto.tfvars` present but gitignored.
- Rotation/lifecycle: `AUTH_SECRET` generated via `npx auth secret`; S3 prior versions expire after 90 days (per `CLAUDE.md`); rotation cadence otherwise [TODO].

### 4) Reliability and Failure Behavior

- Retry/backoff: AWS SDK default retries only; no app-level retry. Parser has a one-shot decrypt-and-retry for password-protected PDFs (`lib/parsers/tpbank.ts:218-228`).
- Timeout policy: API routes set `maxDuration = 30` (`app/api/parse/route.ts:3`, `summarize/route.ts:2`).
- Circuit-breaker/fallback: S3 auth failures classified by `isAuthError()` → 503 with actionable hint instead of 500 (`lib/storage.ts:35-41`, `route.ts:154-158`). Gemini errors peeked before stream returns → 429 (rate limit) / 502, and a missing key → 503 (`app/api/summarize/route.ts:68-101`). The `statementExists` check is best-effort and never blocks upload (`route.ts:136-140`).

### 5) Observability for Integrations

- Logging around external calls: yes — staged, request-id-tagged logs through the parse/save path (`app/api/parse/route.ts`); `console.error` on list/get/delete/summarize failures. Targets CloudWatch (Amplify SSR log group).
- Metrics/tracing: none (no APM/metrics/tracing libraries in `package.json`).
- Missing visibility gaps: no metrics on S3 latency or Gemini token usage; no structured/JSON log format or correlation across requests beyond the per-request id.

### 6) Evidence

- `lib/storage.ts`, `lib/gemini.ts`, `auth.ts`, `lib/auth-allowlist.ts`
- `.env.example`, `amplify.yml`
- `terraform/s3.tf`, `terraform/cognito.tf`, `terraform/iam.tf`, `terraform/amplify.tf`
